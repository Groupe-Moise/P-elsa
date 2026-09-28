// Test du Payment Core (J2).
//
// Ce script s'adapte au mode du fournisseur sandbox actuellement
// lancé côté serveur (variable PAYMENT_SANDBOX_MODE) :
//
// - mode "instant" (par défaut, comportement historique) :
//   le dépôt et le retrait sont acceptés tout de suite.
// - mode "async" : le dépôt reste EN ATTENTE, le script signe et
//   envoie lui-même le webhook de confirmation, puis vérifie que
//   le wallet est crédité.
// - mode "fail" : le dépôt est refusé, rien n'est crédité, et pour
//   le retrait les fonds bloqués sont remboursés.
//
// Pour tester les 3 modes : relancer le serveur avec
//   $env:PAYMENT_SANDBOX_MODE = "async"   (ou "fail")
// entre deux exécutions de ce script (repartir en "instant" ou
// retirer la variable pour revenir au comportement par défaut).
//
// Utilisation (PowerShell), Node 18 ou plus récent :
//   $env:API = "http://10.222.56.1:3000"
//   node test-payment-core.mjs

import { createHmac } from 'node:crypto';

const API = process.env.API ?? 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-sandbox-secret';

function signSandboxEvent(providerReference, status) {
  return createHmac('sha256', WEBHOOK_SECRET)
    .update(`${providerReference}:${status}`)
    .digest('hex');
}

async function call(method, path, token, body, headers) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
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

async function confirmByWebhook(reference, status) {
  const providerReference = `SBX-${reference}`;
  return call('POST', '/payments/webhooks/sandbox', null,
    { providerReference, status },
    { 'x-sandbox-signature': signSandboxEvent(providerReference, status) },
  );
}

const phone = '09' + Math.floor(70000000 + Math.random() * 9999999);
const pin = '482915';

console.log(`--- Inscription du compte de test ${phone} ---`);
const register = await call('POST', '/auth/register', null, {
  firstName: 'Test', lastName: 'PaymentCore', phone, pin,
});

if (register.status >= 300) {
  console.error('Inscription impossible :', register.status, register.json);
  process.exit(1);
}

const token = register.json.accessToken;

console.log('\n=== DÉPÔT ===');
const deposit = await call('POST', '/transactions/deposit', token, {
  amount: 50, network: 'Airtel Money', phone, pin,
});

if (deposit.status >= 300) {
  console.error('Dépôt refusé au niveau HTTP :', deposit.status, deposit.json);
  process.exit(1);
}

const depositStatus = deposit.json?.transaction?.status;
const depositReference = deposit.json?.transaction?.reference;
console.log(`Statut retourné : ${depositStatus}`);

if (depositStatus === 'COMPLETED') {
  console.log('(mode "instant" détecté : comportement historique)');
  check('dépôt crédité tout de suite', Number(deposit.json?.balance) === 50, `solde = ${deposit.json?.balance}`);
} else if (depositStatus === 'PENDING') {
  console.log('(mode "async" détecté : confirmation par webhook)');
  check('dépôt EN ATTENTE, rien crédité pour l\'instant', Number(deposit.json?.balance) === 0, `solde = ${deposit.json?.balance}`);

  console.log('--- Confirmation du dépôt par webhook (COMPLETED) ---');
  const webhook = await confirmByWebhook(depositReference, 'COMPLETED');
  check('webhook accepté', webhook.status < 300, `HTTP ${webhook.status}`);

  console.log('--- Rejeu du même webhook (doit être ignoré) ---');
  const replay = await confirmByWebhook(depositReference, 'COMPLETED');
  check('rejeu détecté (alreadyProcessed)', replay.json?.alreadyProcessed === true);

  const meAfter = await call('GET', '/wallets/me', token);
  check('solde crédité une seule fois (50)', Number(meAfter.json?.balance) === 50, `solde = ${meAfter.json?.balance}`);
} else if (depositStatus === 'FAILED') {
  console.log('(mode "fail" détecté : dépôt refusé par le fournisseur)');
  check('rien n\'est crédité', Number(deposit.json?.balance) === 0, `solde = ${deposit.json?.balance}`);
} else {
  check('statut de transaction reconnu', false, `reçu : ${depositStatus}`);
}

console.log('\n=== RÉCONCILIATION DU LEDGER APRÈS DÉPÔT ===');
const ledgerAfterDeposit = await call('GET', '/ledger/me', token);
check('ledger cohérent', ledgerAfterDeposit.json?.matches === true, JSON.stringify(ledgerAfterDeposit.json));

console.log('\n=== RETRAIT ===');
const balanceBeforeWithdrawal = Number((await call('GET', '/wallets/me', token)).json?.balance ?? 0);

const withdrawal = await call('POST', '/transactions/withdrawal', token, {
  amount: 10, network: 'Airtel Money', phone, pin,
});

if (withdrawal.status >= 300) {
  console.log(`Retrait refusé au niveau HTTP (${withdrawal.status}) — normal si le solde est insuffisant en mode "fail"/"async" ci-dessus.`);
  console.log(JSON.stringify(withdrawal.json));
} else {
  const withdrawalStatus = withdrawal.json?.transaction?.status;
  const withdrawalReference = withdrawal.json?.transaction?.reference;
  console.log(`Statut retourné : ${withdrawalStatus}`);

  if (withdrawalStatus === 'COMPLETED') {
    check(
      'retrait accepté : solde débité (montant + commission)',
      Number(withdrawal.json?.balance) < balanceBeforeWithdrawal,
      `avant = ${balanceBeforeWithdrawal}, après = ${withdrawal.json?.balance}`,
    );
  } else if (withdrawalStatus === 'PENDING') {
    console.log('--- Refus du retrait par webhook (FAILED), vérification du remboursement ---');
    const meBefore = await call('GET', '/wallets/me', token);
    const failWebhook = await confirmByWebhook(withdrawalReference, 'FAILED');
    check('webhook accepté', failWebhook.status < 300, `HTTP ${failWebhook.status}`);

    const meAfterRefund = await call('GET', '/wallets/me', token);
    check(
      'fonds bloqués intégralement remboursés',
      Number(meAfterRefund.json?.balance) > Number(meBefore.json?.balance),
      `avant remboursement = ${meBefore.json?.balance}, après = ${meAfterRefund.json?.balance}`,
    );

    console.log('--- Rejeu du même webhook (ne doit rembourser qu\'une fois) ---');
    const replayFail = await confirmByWebhook(withdrawalReference, 'FAILED');
    check('rejeu détecté (alreadyProcessed)', replayFail.json?.alreadyProcessed === true);

    const meAfterReplay = await call('GET', '/wallets/me', token);
    check(
      'solde inchangé après le rejeu',
      Number(meAfterReplay.json?.balance) === Number(meAfterRefund.json?.balance),
      `${meAfterReplay.json?.balance}`,
    );
  } else if (withdrawalStatus === 'FAILED') {
    check(
      'retrait refusé : fonds bloqués remboursés (solde inchangé)',
      Number(withdrawal.json?.balance) === balanceBeforeWithdrawal,
      `avant = ${balanceBeforeWithdrawal}, après = ${withdrawal.json?.balance}`,
    );
  }
}

console.log('\n=== RÉCONCILIATION FINALE DU LEDGER ===');
const ledgerFinal = await call('GET', '/ledger/me', token);
check('ledger cohérent après toutes les opérations', ledgerFinal.json?.matches === true, JSON.stringify(ledgerFinal.json));

console.log('\n--- Webhook avec signature invalide (doit être refusé) ---');
const badSignature = await call('POST', '/payments/webhooks/sandbox', null,
  { providerReference: 'SBX-inconnu', status: 'COMPLETED' },
  { 'x-sandbox-signature': 'signature-falsifiee' },
);
check('signature invalide rejetée (401)', badSignature.status === 401, `HTTP ${badSignature.status}`);

console.log(allOk ? '\nOK : le Payment Core fonctionne comme attendu.' : '\nPROBLÈME : au moins une vérification a échoué.');
process.exitCode = allOk ? 0 : 1;
