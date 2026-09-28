/**
 * =========================================================
 * COMPATIBILITÉ : WALLET MULTI-DEVISES
 * =========================================================
 *
 * Le wallet peut désormais détenir un solde par devise (voir
 * WalletBalance dans schema.prisma). L'application Flutter,
 * elle, ne connaît encore que la forme précédente : un solde
 * et une devise directement sur le wallet.
 *
 * Cette fonction ajoute les champs `balance` et `currency` au
 * niveau racine (calculés à partir de la devise principale,
 * USD), en plus du nouveau tableau `balances`. L'application
 * actuelle continue de fonctionner sans modification ; le
 * tableau `balances` est là pour les futurs écrans qui
 * afficheront toutes les devises.
 *
 * À retirer une fois l'application mise à jour pour lire
 * directement `balances`.
 */

interface WalletBalanceWithCurrency {
  balance: unknown;
  currency: unknown;
  [key: string]: unknown;
}

interface WalletWithBalances {
  balances?: WalletBalanceWithCurrency[];
  [key: string]: unknown;
}

/**
 * Devise utilisée comme solde "principal" pour la
 * rétrocompatibilité, en attendant que l'application gère
 * plusieurs devises à l'écran.
 */
const PRIMARY_CURRENCY_CODE = 'USD';

export function withPrimaryBalance<T extends WalletWithBalances>(
  wallet: T,
): T & { balance: unknown; currency: unknown } {
  const balances = wallet.balances ?? [];

  const primary =
    balances.find(
      (entry) =>
        (entry.currency as { code?: string } | null)?.code ===
        PRIMARY_CURRENCY_CODE,
    ) ?? balances[0];

  return {
    ...wallet,
    balance: primary?.balance ?? '0',
    currency: primary?.currency ?? null,
  };
}
