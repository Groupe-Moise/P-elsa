/**
 * =========================================================
 * INTERFACE COMMUNE À TOUS LES FOURNISSEURS DE PAIEMENT
 * =========================================================
 *
 * Le wallet ne parle jamais directement à un fournisseur
 * (MaishaPay, opérateurs Mobile Money, cartes...) : il passe par
 * PaymentService, qui utilise cette interface. Ajouter ou
 * remplacer un fournisseur ne demande donc aucune modification
 * du cœur du wallet.
 */

export type ProviderStatus = 'COMPLETED' | 'PENDING' | 'FAILED';

/**
 * Demande d'encaissement (dépôt) : le fournisseur demande l'argent
 * au numéro Mobile Money de l'utilisateur.
 */
export interface CollectInput {
  /** Référence P-ELSA de la transaction (unique). */
  transactionReference: string;

  /** Montant sous forme de texte, pour éviter toute erreur d'arrondi. */
  amount: string;

  currencyCode: string;
  phone: string;
  network: string;
}

/**
 * Demande de versement (retrait) : le fournisseur envoie l'argent
 * vers le numéro Mobile Money de l'utilisateur.
 */
export type PayoutInput = CollectInput;

export interface ProviderResult {
  status: ProviderStatus;

  /** Référence de l'opération chez le fournisseur. */
  providerReference: string;

  /** Renseigné quand status vaut FAILED. */
  failureReason?: string;
}

/**
 * Résultat définitif annoncé par le fournisseur après coup (webhook).
 */
export interface ProviderWebhookEvent {
  providerReference: string;
  status: 'COMPLETED' | 'FAILED';
  failureReason?: string;
}

export interface PaymentProvider {
  /** Nom unique, enregistré sur chaque transaction (ex. sandbox). */
  readonly name: string;

  collect(input: CollectInput): Promise<ProviderResult>;

  payout(input: PayoutInput): Promise<ProviderResult>;

  /** Interroge le fournisseur sur l'état d'une opération. */
  getStatus(providerReference: string): Promise<ProviderResult>;

  /**
   * Vérifie l'authenticité d'un webhook et le convertit en événement
   * normalisé. Doit lever une erreur si la signature est invalide.
   *
   * Asynchrone : certains fournisseurs (MaishaPay notamment) ne
   * signent pas leurs webhooks. Dans ce cas, l'implémentation ne
   * doit jamais faire confiance au statut transmis dans le corps de
   * la requête : elle doit interroger elle-même getStatus() (ou
   * l'équivalent chez le fournisseur) pour obtenir un statut vérifié
   * avant de le renvoyer ici.
   */
  parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<ProviderWebhookEvent> | ProviderWebhookEvent;
}
