import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  CollectInput,
  PaymentProvider,
  PayoutInput,
  ProviderResult,
  ProviderStatus,
  ProviderWebhookEvent,
} from '../payment-provider.interface';

/**
 * =========================================================
 * FOURNISSEUR MAISHAPAY (MOBILE MONEY, SANDBOX ET PRODUCTION)
 * =========================================================
 *
 * Implémente PaymentProvider en s'appuyant sur l'API REST de
 * MaishaPay (https://www.maishapay.net/api_docs/), collection
 * v2 pour les dépôts et B2C Transfer pour les retraits.
 *
 * PARTICULARITÉS IMPORTANTES DE CETTE API, QUI GUIDENT LE CODE
 * CI-DESSOUS :
 *
 * - La collecte Mobile Money (dépôt) est TOUJOURS asynchrone :
 *   la réponse immédiate est PENDING (202), le résultat final
 *   (SUCCESS/FAILED) arrive plus tard par webhook, sur l'URL
 *   fournie dans paymentChannel.callbackUrl.
 *
 * - Le transfert B2C (retrait) est, lui, SYNCHRONE : la réponse
 *   immédiate contient déjà le résultat final (SUCCESS/FAILED).
 *   MaishaPay envoie malgré tout, en plus, une notification au
 *   callbackUrl avec les mêmes informations.
 *
 * - AUCUNE SIGNATURE N'EST DOCUMENTÉE SUR LES WEBHOOKS MAISHAPAY.
 *   Contrairement au SandboxProvider (qui vérifie une signature
 *   HMAC), on ne peut donc jamais faire confiance au contenu brut
 *   d'un webhook MaishaPay : parseWebhook() revérifie
 *   systématiquement le statut auprès de MaishaPay elle-même (via
 *   l'endpoint de recherche de transaction, /transaction/rest/v2
 *   /check) avant de renvoyer quoi que ce soit à PaymentService.
 *   C'est d'ailleurs la vérification que la documentation MaishaPay
 *   recommande explicitement de faire.
 *
 * - CONSTAT EN CONDITIONS RÉELLES (sandbox) : le transfert B2C
 *   exécute réellement l'opération AVANT d'essayer de nous notifier
 *   en synchrone sur callbackUrl. Si cette notification échoue côté
 *   MaishaPay (callbackUrl injoignable, tunnel de développement
 *   coupé, etc.), leur API nous renvoie une page d'erreur HTML au
 *   lieu du JSON attendu — alors que l'argent a déjà été transféré.
 *   Pour ne pas laisser la transaction bloquée EN ATTENTE alors que
 *   MaishaPay connaît déjà le résultat, collect() et payout()
 *   tentent une réconciliation automatique : en cas de réponse
 *   illisible, on interroge le Lookup par NOTRE référence marchande
 *   (?useRef=1, cf. requestWithReconciliation) avant d'abandonner.
 *
 * CONFIGURATION (variables d'environnement) :
 *
 * - MAISHAPAY_PUBLIC_KEY, MAISHAPAY_SECRET_KEY : clés API fournies
 *   par MaishaPay (sandbox ou production selon le compte).
 * - MAISHAPAY_GATEWAY_MODE : "1" pour la production, "0" pour le
 *   bac à sable. Par défaut, "0" sauf si NODE_ENV=production.
 * - MAISHAPAY_BASE_URL : URL de base de l'API (par défaut celle de
 *   MaishaPay, à ne changer qu'en cas de besoin exceptionnel).
 * - MAISHAPAY_CALLBACK_BASE_URL : URL PUBLIQUE (joignable depuis
 *   Internet) de ce serveur. MaishaPay ne peut pas notifier un
 *   callbackUrl pointant vers localhost : en développement, il
 *   faut un tunnel (ngrok ou équivalent) et mettre son URL ici.
 *
 * Ces variables ne sont lues qu'au moment de chaque appel (jamais
 * dans le constructeur) : l'application démarre normalement même
 * si MaishaPay n'est pas configuré, tant que PAYMENT_PROVIDER reste
 * sur "sandbox".
 */
@Injectable()
export class MaishaPayProvider implements PaymentProvider {
  readonly name = 'maishapay';

  private readonly logger = new Logger(MaishaPayProvider.name);

  private static readonly COLLECT_MOBILE_MONEY_PATH =
    '/collect/v2/store/mobileMoney';

  private static readonly PAYOUT_MOBILE_MONEY_PATH =
    '/b2c/store/transfert/mobilemoney';

  private static readonly TRANSACTION_LOOKUP_PATH =
    '/transaction/rest/v2/check';

  /**
   * Correspondance entre les libellés utilisés côté P-ELSA (voir
   * TransactionsService, allowedNetworks) et les codes opérateurs
   * attendus par MaishaPay (paymentChannel.provider).
   */
  private static readonly NETWORK_CODES: Record<string, string> = {
    'airtel money': 'AIRTEL',
    airtel: 'AIRTEL',
    'm-pesa': 'MPESA',
    mpesa: 'MPESA',
    'orange money': 'ORANGE',
    orange: 'ORANGE',
    mtn: 'MTN',
    'mtn money': 'MTN',
  };

  async collect(input: CollectInput): Promise<ProviderResult> {
    const response = await this.requestWithReconciliation(
      MaishaPayProvider.COLLECT_MOBILE_MONEY_PATH,
      {
        transactionReference: input.transactionReference,
        gatewayMode: this.gatewayMode,
        publicApiKey: this.publicApiKey,
        secretApiKey: this.secretApiKey,
        order: {
          amount: input.amount,
          currency: input.currencyCode,
          /**
           * Optionnels d'après la documentation, mais l'API MaishaPay
           * plante (erreur 500 PHP) quand ces clés sont totalement
           * absentes plutôt que vides : on les envoie toujours,
           * exactement comme dans leurs propres exemples.
           */
          customerFullName: '',
          customerEmailAdress: '',
        },
        paymentChannel: {
          channel: 'MOBILEMONEY',
          provider: this.mapNetwork(input.network),
          walletID: input.phone,
          callbackUrl: this.callbackUrl,
        },
      },
      input.transactionReference,
    );

    return this.toProviderResult(input.transactionReference, response);
  }

  async payout(input: PayoutInput): Promise<ProviderResult> {
    const response = await this.requestWithReconciliation(
      MaishaPayProvider.PAYOUT_MOBILE_MONEY_PATH,
      {
        transactionReference: input.transactionReference,
        gatewayMode: this.gatewayMode,
        publicApiKey: this.publicApiKey,
        secretApiKey: this.secretApiKey,
        order: {
          motif: 'Retrait P-ELSA',
          amount: input.amount,
          currency: input.currencyCode,
          /**
           * customerFullName est documenté comme optionnel, mais
           * MaishaPay le stocke dans une colonne NOT NULL
           * (recipientFullName) côté transfert B2C : une chaîne vide
           * y est traitée comme null et rejetée par leur base de
           * données (erreur 500 SQLSTATE[23000]). On envoie donc
           * toujours une vraie valeur non vide ici, faute de disposer
           * du nom du bénéficiaire à ce niveau.
           */
          customerFullName: 'Client P-ELSA',
          customerEmailAdress: '',
        },
        paymentChannel: {
          provider: this.mapNetwork(input.network),
          walletID: input.phone,
          callbackUrl: this.callbackUrl,
        },
      },
      input.transactionReference,
    );

    return this.toProviderResult(input.transactionReference, response);
  }

  async getStatus(providerReference: string): Promise<ProviderResult> {
    /**
     * Recherche par identifiant MaishaPay (transactionId numérique
     * renvoyé dans la réponse initiale), pas par référence
     * marchande : on n'ajoute donc pas ?useRef=1.
     */
    const response = await this.request(
      MaishaPayProvider.TRANSACTION_LOOKUP_PATH,
      {
        gatewayMode: this.gatewayMode,
        publicApiKey: this.publicApiKey,
        secretApiKey: this.secretApiKey,
        transactionId: providerReference,
      },
    );

    return this.toProviderResult(providerReference, response);
  }

  /**
   * Recherche par NOTRE référence marchande (?useRef=1), à ne pas
   * confondre avec getStatus() qui recherche par l'identifiant
   * MaishaPay. Utile quand on n'a jamais reçu cet identifiant, par
   * exemple lors de la réconciliation automatique ci-dessous.
   */
  private async lookupByMerchantReference(
    transactionReference: string,
  ): Promise<Record<string, unknown>> {
    return this.request(
      `${MaishaPayProvider.TRANSACTION_LOOKUP_PATH}?useRef=1`,
      {
        gatewayMode: this.gatewayMode,
        publicApiKey: this.publicApiKey,
        secretApiKey: this.secretApiKey,
        transactionId: transactionReference,
      },
    );
  }

  /**
   * Enveloppe request() pour collect() et payout() : constaté en
   * conditions réelles, une réponse illisible de MaishaPay (page de
   * débogage HTML au lieu du JSON attendu) ne veut pas forcément dire
   * que l'opération a échoué — notamment quand c'est leur tentative
   * de NOUS notifier en synchrone qui plante après avoir déjà exécuté
   * l'opération (voir la note en tête de fichier). Plutôt que de
   * laisser la transaction bloquée EN ATTENTE en attendant une
   * réconciliation manuelle, on interroge nous-mêmes le Lookup par
   * référence marchande avant d'abandonner.
   *
   * Si cette réconciliation elle-même échoue (MaishaPay injoignable,
   * réponse illisible aussi sur le Lookup...), on ne sait toujours
   * rien de plus fiable que l'erreur d'origine : elle est donc
   * renvoyée telle quelle, et la transaction reste EN ATTENTE comme
   * avant ce correctif — jamais de faux positif.
   */
  private async requestWithReconciliation(
    path: string,
    body: Record<string, unknown>,
    transactionReference: string,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.request(path, body);
    } catch (error) {
      this.logger.warn(
        `Réponse illisible de MaishaPay sur ${path} pour ${transactionReference} : tentative de réconciliation via Transaction Lookup (référence marchande) avant d'abandonner.`,
      );

      try {
        const reconciled =
          await this.lookupByMerchantReference(transactionReference);

        this.logger.log(
          `Réconciliation réussie pour ${transactionReference} : MaishaPay renvoie transactionStatus=${String(reconciled.transactionStatus)}.`,
        );

        return reconciled;
      } catch (reconciliationError) {
        this.logger.error(
          `Réconciliation impossible pour ${transactionReference} après l'échec initial : ${
            reconciliationError instanceof Error
              ? reconciliationError.message
              : String(reconciliationError)
          }`,
        );

        throw error;
      }
    }
  }

  /**
   * MaishaPay ne signe pas ses webhooks (aucune vérification
   * documentée). On ne fait donc jamais confiance au statut transmis
   * dans le corps de la requête : on revérifie systématiquement
   * auprès de MaishaPay elle-même, via l'endpoint de recherche de
   * transaction, avant de renvoyer un événement à PaymentService.
   */
  async parseWebhook(
    _headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<ProviderWebhookEvent> {
    const payload = (body ?? {}) as Record<string, unknown>;
    const rawTransactionId = payload.transactionId;

    if (
      rawTransactionId === undefined ||
      rawTransactionId === null ||
      rawTransactionId === ''
    ) {
      throw new BadRequestException(
        'transactionId manquant dans la notification MaishaPay.',
      );
    }

    const providerReference = String(rawTransactionId);

    this.logger.log(
      `Webhook MaishaPay reçu pour ${providerReference} : revérification via Transaction Lookup avant de faire confiance à quoi que ce soit.`,
    );

    const verified = await this.getStatus(providerReference);

    if (verified.status === 'PENDING') {
      /**
       * MaishaPay a notifié une transaction, mais sa propre
       * vérification la montre toujours EN ATTENTE (cas documenté :
       * délai côté opérateur). On refuse cette notification plutôt
       * que de finaliser sur une base non fiable ; MaishaPay renverra
       * une nouvelle notification une fois le statut réellement
       * tranché.
       */
      throw new ConflictException(
        `Transaction ${providerReference} toujours EN ATTENTE selon la vérification MaishaPay : notification ignorée pour le moment.`,
      );
    }

    return {
      providerReference: verified.providerReference,
      status: verified.status,
      failureReason: verified.failureReason,
    };
  }

  /**
   * Traduit une réponse brute de l'API MaishaPay (collecte, retrait,
   * ou lookup — les trois partagent le même vocabulaire de statut)
   * vers le format commun ProviderResult.
   */
  private toProviderResult(
    fallbackReference: string,
    response: Record<string, unknown>,
  ): ProviderResult {
    const rawTransactionId = response?.transactionId;
    const providerReference =
      rawTransactionId !== undefined && rawTransactionId !== null
        ? String(rawTransactionId)
        : fallbackReference;

    /**
     * Réponse inattendue (pas de transactionId du tout) : soit une
     * réponse d'erreur métier renvoyée AVANT la création de la
     * transaction chez MaishaPay (ex. { status_code: 403, title:
     * "Insufficient Balance", errors: {...} } quand le compte
     * marchand n'a pas assez de solde pour un retrait), soit une
     * réponse vraiment inattendue. On refuse plutôt que de risquer un
     * faux positif, mais on essaie d'abord d'en tirer un message
     * exploitable (voir extractBusinessErrorMessage).
     */
    if (rawTransactionId === undefined || rawTransactionId === null) {
      const description =
        this.extractBusinessErrorMessage(response) ??
        (typeof response?.transactionDescription === 'string'
          ? response.transactionDescription
          : 'Réponse inattendue de MaishaPay (paramètres invalides ?).');

      return {
        status: 'FAILED',
        providerReference,
        failureReason: description,
        awaitingFloat: this.isInsufficientFloatResponse(response),
      };
    }

    const status = this.mapStatus(response.transactionStatus);

    return {
      status,
      providerReference,
      failureReason:
        status === 'FAILED'
          ? (typeof response.transactionDescription === 'string'
              ? response.transactionDescription
              : 'Opération refusée par MaishaPay.')
          : undefined,
    };
  }

  /**
   * MaishaPay renvoie, pour une requête refusée AVANT même la
   * création d'une transaction chez eux (ex. solde marchand
   * insuffisant pour un retrait), une forme différente de celle
   * utilisée pour un résultat définitif (transactionStatus /
   * transactionDescription) : { status_code, title, errors: { <champ>
   * : "<message>" } }. On en tire le message le plus lisible possible
   * pour failureReason (ex. "Insufficient Balance : Solde
   * insuffisant. Disponible: 0.00000000, Requis: 10350"), plutôt que
   * le message générique utilisé auparavant faute de mieux.
   */
  private extractBusinessErrorMessage(
    response: Record<string, unknown>,
  ): string | undefined {
    const title =
      typeof response?.title === 'string' ? response.title : undefined;

    const errors = response?.errors;
    const firstErrorMessage =
      errors && typeof errors === 'object'
        ? Object.values(errors as Record<string, unknown>).find(
            (value): value is string => typeof value === 'string',
          )
        : undefined;

    if (title && firstErrorMessage) {
      return `${title} : ${firstErrorMessage}`;
    }

    return title ?? firstErrorMessage;
  }

  /**
   * Détecte la réponse MaishaPay renvoyée quand le compte marchand
   * utilisé pour les retraits (float B2C) n'a pas assez de solde pour
   * exécuter l'opération : { status_code: 403, title: "Insufficient
   * Balance", errors: {...} }. Ce n'est pas un refus lié au client :
   * la transaction doit rester EN ATTENTE côté P-ELSA (fonds
   * toujours bloqués), pas être traitée comme un échec définitif
   * remboursé (voir PaymentService.applyResult).
   */
  private isInsufficientFloatResponse(
    response: Record<string, unknown>,
  ): boolean {
    const title =
      typeof response?.title === 'string'
        ? response.title.toLowerCase()
        : '';

    return title.includes('insufficient balance');
  }

  private mapStatus(value: unknown): ProviderStatus {
    const normalized =
      typeof value === 'string' ? value.trim().toUpperCase() : '';

    if (
      normalized === 'SUCCESS' ||
      normalized === 'APPROVED' ||
      normalized === 'COMPLETED'
    ) {
      return 'COMPLETED';
    }

    if (normalized === 'FAILED' || normalized === 'DECLINED') {
      return 'FAILED';
    }

    /**
     * PENDING, valeur inconnue, ou absente : on reste prudent et on
     * considère l'opération toujours en cours plutôt que de la
     * finaliser à tort.
     */
    return 'PENDING';
  }

  /**
   * Convertit le libellé de réseau utilisé côté P-ELSA (voir
   * TransactionsService) vers le code opérateur attendu par
   * MaishaPay (AIRTEL, ORANGE, MTN, MPESA...).
   */
  private mapNetwork(network: string): string {
    const normalized = network.trim().toLowerCase();
    const mapped = MaishaPayProvider.NETWORK_CODES[normalized];

    if (mapped) {
      return mapped;
    }

    /**
     * Déjà un code MaishaPay valide (ex. appelé directement avec
     * "AIRTEL") : on le laisse passer tel quel.
     */
    const upper = network.trim().toUpperCase();
    if (Object.values(MaishaPayProvider.NETWORK_CODES).includes(upper)) {
      return upper;
    }

    throw new BadRequestException(
      `Réseau Mobile Money non pris en charge par MaishaPay : "${network}".`,
    );
  }

  /**
   * Requête HTTP vers l'API MaishaPay, avec un délai d'attente pour
   * ne jamais bloquer indéfiniment le traitement d'une transaction.
   */
  private async request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();

      try {
        return text ? JSON.parse(text) : {};
      } catch {
        /**
         * Réponse non-JSON (page de débogage PHP renvoyée par
         * MaishaPay en cas d'erreur serveur, par exemple une
         * contrainte de base de données violée par des paramètres
         * documentés comme optionnels mais en réalité obligatoires
         * côté MaishaPay). On journalise un extrait exploitable
         * plutôt que de planter sur un texte illisible.
         */
        this.logger.error(
          `Réponse MaishaPay illisible (HTTP ${response.status}) sur ${path}.`,
        );

        /**
         * DIAGNOSTIC TEMPORAIRE : un deuxième cas de réponse illisible
         * (différent de celui déjà corrigé pour customerFullName) est
         * apparu sur ce même endpoint. On écrit le corps complet de la
         * réponse dans un fichier local pour l'inspecter directement,
         * comme la dernière fois — à retirer une fois la vraie cause
         * identifiée.
         */
        try {
          const debugPath = join(
            process.cwd(),
            `maishapay-error-${Date.now()}.html`,
          );
          writeFileSync(debugPath, text, 'utf8');
          this.logger.error(`Corps complet écrit dans ${debugPath}`);
        } catch (writeError) {
          this.logger.error(
            `Impossible d'écrire le fichier de diagnostic : ${(writeError as Error).message}`,
          );
        }

        throw new Error(
          `Réponse MaishaPay illisible (HTTP ${response.status}) : ${this.extractErrorHint(text)}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * MaishaPay renvoie parfois, au lieu du JSON attendu, sa propre page
   * de débogage PHP/Symfony (HTTP 500). Cette page contient presque
   * toujours le vrai message d'erreur dans son <title>, ou dans un
   * élément portant la classe "exception-message" : on essaie de
   * l'extraire pour ne pas se retrouver avec uniquement le script de
   * mise en forme de la page (qui, lui, ne dit rien d'utile). À
   * défaut, on retombe sur un extrait plus large du texte brut.
   */
  private extractErrorHint(text: string): string {
    const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
    const messageMatch = text.match(
      /exception-message[^>]*>\s*([^<]+)/i,
    );

    const hints = [titleMatch?.[1]?.trim(), messageMatch?.[1]?.trim()].filter(
      (hint): hint is string => Boolean(hint),
    );

    if (hints.length > 0) {
      return hints.join(' — ');
    }

    return text.slice(0, 1000);
  }

  private get baseUrl(): string {
    return (
      process.env.MAISHAPAY_BASE_URL ?? 'https://marchand.maishapay.online/api'
    );
  }

  private get gatewayMode(): '0' | '1' {
    if (process.env.MAISHAPAY_GATEWAY_MODE === '1') return '1';
    if (process.env.MAISHAPAY_GATEWAY_MODE === '0') return '0';

    return process.env.NODE_ENV === 'production' ? '1' : '0';
  }

  private get publicApiKey(): string {
    const value = process.env.MAISHAPAY_PUBLIC_KEY;

    if (!value) {
      throw new Error(
        "MAISHAPAY_PUBLIC_KEY manquant : impossible d'appeler MaishaPay.",
      );
    }

    return value;
  }

  private get secretApiKey(): string {
    const value = process.env.MAISHAPAY_SECRET_KEY;

    if (!value) {
      throw new Error(
        "MAISHAPAY_SECRET_KEY manquant : impossible d'appeler MaishaPay.",
      );
    }

    return value;
  }

  private get callbackUrl(): string {
    const base = process.env.MAISHAPAY_CALLBACK_BASE_URL;

    if (!base) {
      throw new Error(
        "MAISHAPAY_CALLBACK_BASE_URL manquant : MaishaPay a besoin d'une URL publique pour notifier ce serveur (voir le fichier .env.example).",
      );
    }

    return `${base.replace(/\/$/, '')}/payments/webhooks/maishapay`;
  }
}
