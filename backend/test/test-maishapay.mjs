// Test en conditions réelles de l'intégration MaishaPay (J4).
//
// Ce script doit être lancé DEPUIS TA MACHINE (pas depuis
// l'environnement cloud de l'assistant, qui n'a pas accès à
// marchand.maishapay.online). Il suppose que ton serveur NestJS
// tourne déjà avec :
//
//   PAYMENT_PROVIDER = maishapay
//   MAISHAPAY_PUBLIC_KEY = <ta clé publique sandbox>
//   MAISHAPAY_SECRET_KEY = <ta clé secrète sandbox>
//   MAISHAPAY_GATEWAY_MODE = 0        (sandbox)
//   MAISHAPAY_CALLBACK_BASE_URL = <URL PUBLIQUE de ton serveur>
//
// IMPORTANT — le dépôt Mobile Money (collecte v2) est TOUJOURS
// asynchrone chez MaishaPay : la réponse immédiate est "EN ATTENTE"
// et le résultat final arrive plus tard par webhook, sur l'URL
// MAISHAPAY_CALLBACK_BASE_URL. MaishaPay ne peut pas notifier une
// URL localhost : il te faut un tunnel public (ngrok ou équivalent)
// qui pointe vers ton serveur local, par exemple :
//
//   ngrok http 3000
//
// puis mettre l'URL https donnée par ngrok dans
// MAISHAPAY_CALLBACK_BASE_URL (et redémarrer le serveur).
//
// Le retrait (transfert B2C), lui, est SYNCHRONE : la réponse
// immédiate contient déjà le résultat final. C'est donc le test le
// plus simple à valider automatiquement d'un bout à l'autre.
//
// Utilisation (PowerShell), Node 18 ou plus récent :
//   $env:API = "http://10.222.56.1:3000"
//   $env:DEPOSIT_PHONE = "+243997447204"   # numéro Mobile Money de test
//   $env:DEPOSIT_NETWORK = "Airtel Money"  # Airtel Money | M-Pesa | Orange Money
//   $env:CURRENCY = "USD"                  # doit être une devise configurée côté serveur
//   node test-maishapay.mjs
//
// Variables optionnelles : WITHDRAW_PHONE, WITHDRAW_NETWORK,
// DEPOSIT_AMOUNT (défaut 1), WITHDRAW_AMOUNT (défaut 1),
// WAIT_SECONDS (défaut 30, délai d'attente du webhook de dépôt).

const API = process.env.API ?? 'http://localhost:3000';
const CURRENCY = process.env.CURRENCY ?? 'USD';

const DEPOSIT_NETWORK = process.env.DEPOSIT_NETWORK ?? 'Airtel Money';
const DEPOSIT_PHONE = process.env.DEPOSIT_PHONE;
const DEPOSIT_AMOUNT = Number(process.env.DEPOSIT_AMOUNT ?? '1');

const WITHDRAW_NETWORK = process.env.WITHDRAW_NETWORK ?? DEPOSIT_NETWORK;
const WITHDRAW_PHONE = process.env.WITHDRAW_PHONE ?? DEPOSIT_PHONE;
const WITHDRAW_AMOUNT = Number(process.env.WITHDRAW_AMOUNT ?? '1');

const WAIT_SECONDS = Number(process.env.WAIT_SECONDS ?? '30');

if (!DEPOSIT_PHONE) {
  console.error(
    "Renseigne $env:DEPOSIT_PHONE (numéro Mobile Money valable dans le bac à sable MaishaPay, ex. +243997447204).",
  );
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const phone = '09' + Math.floor(70000000 + Math.random() * 9999999);
const pin = '482915';

console.log(`--- Inscription du compte de test ${phone} ---`);
const register = await call('POST', '/auth/register', null, {
  firstName: 'Test', lastName: 'MaishaPay', phone, pin,
});

if (register.status >= 300) {
  console.error('Inscription impossible :', register.status, register.json);
  process.exit(1);
}

const token = register.json.accessToken;

console.log('\n=== DÉPÔT VIA MAISHAPAY (collecte v2, toujours asynchrone) ===');
const deposit = await call('POST', '/transactions/deposit', token, {
  amount: DEPOSIT_AMOUNT,
  network: DEPOSIT_NETWORK,
  phone: DEPOSIT_PHONE,
  pin,
  currencyCode: CURRENCY,
});

if (deposit.status >= 300) {
  console.error('Dépôt refusé au niveau HTTP :', deposit.status, deposit.json);
  console.error(
    'Vérifie MAISHAPAY_PUBLIC_KEY / MAISHAPAY_SECRET_KEY / MAISHAPAY_GATEWAY_MODE côté serveur, et que CURRENCY est bien configurée.',
  );
  process.exit(1);
}

const depositStatus = deposit.json?.transaction?.status;
console.log(`Statut retourné : ${depositStatus}`);
check(
  'le dépôt part bien EN ATTENTE (comportement documenté de la collecte v2 MaishaPay)',
  depositStatus === 'PENDING',
  `reçu : ${depositStatus}`,
);
check('rien n\'est crédité avant confirmation', Number(deposit.json?.balance) === 0, `solde = ${deposit.json?.balance}`);

if (depositStatus === 'PENDING') {
  console.log(
    `\nEn attente de la confirmation MaishaPay (jusqu'à ${WAIT_SECONDS}s).`,
  );
  console.log(
    "Si le bac à sable MaishaPay demande une validation PIN sur le téléphone, fais-le maintenant.",
  );
  console.log(
    "La confirmation n'arrivera que si MAISHAPAY_CALLBACK_BASE_URL pointe vers une URL publique (tunnel ngrok ou équivalent) atteignant réellement ton serveur.",
  );

  let confirmed = false;
  const attempts = Math.max(1, Math.floor(WAIT_SECONDS / 3));

  for (let i = 0; i < attempts; i++) {
    await sleep(3000);
    const me = await call('GET', '/wallets/me', token);
    const balance = Number(me.json?.balance ?? 0);
    process.stdout.write(`  … solde après ${(i + 1) * 3}s : ${balance}\r`);
    if (balance > 0) {
      confirmed = true;
      console.log(`\nOK : dépôt confirmé par webhook, solde = ${balance}`);
      break;
    }
  }

  if (!confirmed) {
    console.log(
      "\nPas de confirmation reçue dans le délai imparti — ce n'est pas forcément un problème de code : " +
      "vérifie le tunnel public, MAISHAPAY_CALLBACK_BASE_URL, et si une validation manuelle était attendue sur le téléphone.",
    );
  }
}

console.log('\n=== RÉCONCILIATION DU LEDGER APRÈS DÉPÔT ===');
const ledgerAfterDeposit = await call('GET', '/ledger/me', token);
check('ledger cohérent', ledgerAfterDeposit.json?.matches === true, JSON.stringify(ledgerAfterDeposit.json));

console.log('\n=== RETRAIT VIA MAISHAPAY (transfert B2C, synchrone) ===');
const balanceBeforeWithdrawal = Number((await call('GET', '/wallets/me', token)).json?.balance ?? 0);

if (balanceBeforeWithdrawal <= 0) {
  console.log(
    "(ignoré : le solde est encore à 0, le dépôt n'a pas été confirmé à temps. " +
    "Relance ce script une fois le dépôt confirmé, ou augmente WAIT_SECONDS.)",
  );
} else {
  const withdrawAmount = Math.min(WITHDRAW_AMOUNT, balanceBeforeWithdrawal);

  const withdrawal = await call('POST', '/transactions/withdrawal', token, {
    amount: withdrawAmount,
    network: WITHDRAW_NETWORK,
    phone: WITHDRAW_PHONE,
    pin,
    currencyCode: CURRENCY,
  });

  if (withdrawal.status >= 300) {
    console.error('Retrait refusé au niveau HTTP :', withdrawal.status, withdrawal.json);
    allOk = false;
  } else {
    const withdrawalStatus = withdrawal.json?.transaction?.status;
    console.log(`Statut retourné : ${withdrawalStatus}`);

    check(
      'le retrait est finalisé immédiatement (le transfert B2C MaishaPay est synchrone)',
      withdrawalStatus === 'COMPLETED' || withdrawalStatus === 'FAILED',
      `reçu : ${withdrawalStatus}`,
    );

    if (withdrawalStatus === 'COMPLETED') {
      check(
        'solde débité (montant + commission)',
        Number(withdrawal.json?.balance) < balanceBeforeWithdrawal,
        `avant = ${balanceBeforeWithdrawal}, après = ${withdrawal.json?.balance}`,
      );
    } else if (withdrawalStatus === 'FAILED') {
      check(
        'fonds bloqués remboursés (solde inchangé)',
        Number(withdrawal.json?.balance) === balanceBeforeWithdrawal,
        `avant = ${balanceBeforeWithdrawal}, après = ${withdrawal.json?.balance}`,
      );
    }

    console.log('\n=== RÉCONCILIATION DU LEDGER APRÈS RETRAIT ===');
    const ledgerAfterWithdrawal = await call('GET', '/ledger/me', token);
    check('ledger cohérent', ledgerAfterWithdrawal.json?.matches === true, JSON.stringify(ledgerAfterWithdrawal.json));
  }
}

console.log(
  allOk
    ? '\nOK : l\'intégration MaishaPay (J4) répond comme attendu sur les points vérifiables automatiquement.'
    : '\nPROBLÈME : au moins une vérification a échoué.',
);
console.log(
  'Rappel : la confirmation du DÉPÔT dépend de ton tunnel public et, éventuellement, d\'une validation manuelle sur le téléphone — ' +
  "ce n'est pas entièrement automatisable depuis ce script.",
);
process.exitCode = allOk ? 0 : 1;
