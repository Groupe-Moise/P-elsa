// Test de l'administration minimale (J3).
//
// Prérequis : un compte ADMIN existant. Si tu n'en as pas encore,
// passe un compte de test en ADMIN directement en base, par
// exemple avec Prisma Studio (npx prisma studio) ou en SQL :
//   UPDATE users SET role = 'ADMIN' WHERE phone = '+243XXXXXXXXX';
//
// Utilisation (PowerShell), Node 18 ou plus récent :
//   $env:API = "http://10.222.56.1:3000"
//   $env:ADMIN_PHONE = "+243XXXXXXXXX"
//   $env:ADMIN_PIN = "482915"
//   node test-admin.mjs

const API = process.env.API ?? 'http://localhost:3000';
const ADMIN_PHONE = process.env.ADMIN_PHONE;
const ADMIN_PIN = process.env.ADMIN_PIN;

if (!ADMIN_PHONE || !ADMIN_PIN) {
  console.error('Renseigne $env:ADMIN_PHONE et $env:ADMIN_PIN (compte déjà en base avec le rôle ADMIN).');
  process.exit(1);
}

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

let allOk = true;
function check(label, condition, detail) {
  console.log(`${condition ? 'OK' : 'PROBLÈME'} : ${label}${detail ? ' (' + detail + ')' : ''}`);
  if (!condition) allOk = false;
}

console.log(`--- Connexion admin (${ADMIN_PHONE}) ---`);
const adminLogin = await call('POST', '/auth/login', null, { phone: ADMIN_PHONE, pin: ADMIN_PIN });

if (adminLogin.status >= 300) {
  console.error('Connexion admin impossible :', adminLogin.status, adminLogin.json);
  process.exit(1);
}

const adminToken = adminLogin.json.accessToken;
check('le compte connecté a bien le rôle ADMIN', adminLogin.json?.user?.role === 'ADMIN', `rôle = ${adminLogin.json?.user?.role}`);

console.log('\n--- Un client normal ne peut pas accéder aux routes admin ---');
const clientPhone = '09' + Math.floor(70000000 + Math.random() * 9999999);
const clientPin = '482915';
const clientRegister = await call('POST', '/auth/register', null, {
  firstName: 'Test', lastName: 'Admin', phone: clientPhone, pin: clientPin,
});
const clientToken = clientRegister.json.accessToken;
const clientUserId = clientRegister.json.user?.id ?? clientRegister.json.id;

const forbidden = await call('GET', '/admin/overview', clientToken);
check('accès refusé à un non-admin (403)', forbidden.status === 403, `HTTP ${forbidden.status}`);

console.log('\n=== VUE D\'ENSEMBLE (commissions / soldes par devise) ===');
const overview = await call('GET', '/admin/overview', adminToken);
check('overview accessible', overview.status < 300, `HTTP ${overview.status}`);
console.log(JSON.stringify(overview.json, null, 2));

console.log('\n=== OPÉRATIONS EN ATTENTE OU EN ÉCHEC ===');
const pending = await call('GET', '/admin/transactions', adminToken);
check('liste accessible', pending.status < 300, `HTTP ${pending.status}`);
console.log(`${pending.json?.length ?? 0} opération(s) en attente ou en échec.`);

console.log('\n--- Tentative de relance/annulation sur une transaction inexistante ---');
const notFound = await call('POST', '/admin/transactions/00000000-0000-0000-0000-000000000000/retry', adminToken);
check('404 sur une transaction inexistante', notFound.status === 404, `HTTP ${notFound.status}`);

if (pending.json?.length > 0) {
  const target = pending.json[0];
  console.log(`\n--- Test de relance sur une vraie transaction en attente (${target.reference}) ---`);
  const retry = await call('POST', `/admin/transactions/${target.id}/retry`, adminToken);
  check('relance traitée', retry.status < 300, `HTTP ${retry.status}, statut = ${retry.json?.transaction?.status}`);
} else {
  console.log('(aucune transaction en attente actuellement — relance a annulation non testées ici ; relance le serveur avec PAYMENT_SANDBOX_MODE=async, fais un dépôt ou un retrait, puis relance ce script pour les tester.)');
}

console.log('\n=== SUSPENSION / RÉACTIVATION D\'UN COMPTE ===');
const suspend = await call('POST', `/admin/users/${clientUserId}/suspend`, adminToken, { reason: 'Test automatisé' });
check('suspension acceptée', suspend.status < 300 && suspend.json?.status === 'SUSPENDED', `statut = ${suspend.json?.status}`);

console.log('--- Le compte suspendu ne peut plus se connecter ---');
const blockedLogin = await call('POST', '/auth/login', null, { phone: clientPhone, pin: clientPin });
check('connexion refusée pour un compte suspendu', blockedLogin.status >= 400, `HTTP ${blockedLogin.status}`);

const reactivate = await call('POST', `/admin/users/${clientUserId}/reactivate`, adminToken);
check('réactivation acceptée', reactivate.status < 300 && reactivate.json?.status === 'ACTIVE', `statut = ${reactivate.json?.status}`);

console.log('--- Le compte réactivé peut de nouveau se connecter ---');
const workingLogin = await call('POST', '/auth/login', null, { phone: clientPhone, pin: clientPin });
check('connexion de nouveau acceptée', workingLogin.status < 300, `HTTP ${workingLogin.status}`);

console.log('\n=== DÉBLOCAGE DE PIN ===');
console.log('--- Provoque un verrouillage (5 mauvais PIN) ---');
for (let i = 0; i < 5; i++) {
  await call('POST', '/auth/login', null, { phone: clientPhone, pin: '000000' });
}
const lockedLogin = await call('POST', '/auth/login', null, { phone: clientPhone, pin: clientPin });
check('le compte est bien verrouillé après 5 échecs', lockedLogin.status === 429, `HTTP ${lockedLogin.status}`);

const unlock = await call('POST', `/admin/users/${clientUserId}/unlock-pin`, adminToken);
check('déblocage accepté', unlock.status < 300, `HTTP ${unlock.status}`);

const unlockedLogin = await call('POST', '/auth/login', null, { phone: clientPhone, pin: clientPin });
check('connexion de nouveau possible après déblocage', unlockedLogin.status < 300, `HTTP ${unlockedLogin.status}`);

console.log('\n=== JOURNAL D\'AUDIT ===');
const auditLog = await call('GET', '/admin/audit-log', adminToken);
check('journal accessible', auditLog.status < 300, `HTTP ${auditLog.status}`);
check(
  'les actions effectuées ci-dessus apparaissent dans le journal',
  Array.isArray(auditLog.json) &&
    auditLog.json.some((entry) => entry.action === 'USER_SUSPEND') &&
    auditLog.json.some((entry) => entry.action === 'USER_UNLOCK_PIN'),
  `${auditLog.json?.length ?? 0} entrée(s)`,
);

console.log(allOk ? '\nOK : l\'administration minimale (J3) fonctionne comme attendu.' : '\nPROBLÈME : au moins une vérification a échoué.');
process.exitCode = allOk ? 0 : 1;
