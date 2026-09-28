/**
 * Réseaux Mobile Money acceptés pour les dépôts et les retraits.
 */
export const MOBILE_MONEY_NETWORKS = [
  'Airtel Money',
  'M-Pesa',
  'Orange Money',
] as const;

/**
 * Plafond technique par opération, pour éviter les dépassements de
 * la colonne Decimal(20,4). Les vrais plafonds par devise et par
 * jour seront définis plus tard.
 */
export const MAX_TRANSACTION_AMOUNT = 1_000_000_000;
