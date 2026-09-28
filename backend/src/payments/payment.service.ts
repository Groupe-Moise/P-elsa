import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  TransactionStatus,
  TransactionType,
} from '../generated/prisma/enums';
import type {
  PaymentProvider,
  ProviderResult,
} from './payment-provider.interface';
import { SandboxProvider } from './providers/sandbox.provider';
import { MaishaPayProvider } from './providers/maishapay.provider';

/**
 * =========================================================
 * PAYMENT SERVICE : LE CŒUR DES PAIEMENTS
 * =========================================================
 *
 * Toute opération d'argent qui passe par un fournisseur (dépôt et
 * retrait Mobile Money) suit le même parcours :
 *
 * 1. TransactionsService enregistre la transaction EN ATTENTE
 *    (pour un retrait, les fonds sont déjà bloqués : débités du
 *    wallet).
 * 2. process() demande l'opération au fournisseur.
 * 3. Le résultat est appliqué : réussite, échec, ou toujours en
 *    attente (le fournisseur confirmera plus tard par webhook).
 *
 * PROTECTION CONTRE LES DOUBLONS :
 *
 * Le passage de EN ATTENTE à RÉUSSI ou ÉCHOUÉ est atomique : la
 * base ne l'accorde qu'une seule fois. Si un webhook est rejoué,
 * ou si deux arrivent en même temps, les effets sur l'argent
 * (crédit, remboursement) ne sont appliqués qu'une fois.
 *
 * cancel() suit la même règle pour une annulation décidée par un
 * administrateur (voir AdminService) : passage atomique EN
 * ATTENTE -> ANNULÉE, avec le même remboursement qu'un retrait
 * refusé par le fournisseur.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  private readonly providers = new Map<string, PaymentProvider>();

  /**
   * Fournisseur utilisé pour les nouvelles opérations (variable
   * PAYMENT_PROVIDER, sandbox par défaut).
   */
  readonly providerName: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    sandboxProvider: SandboxProvider,
    maishaPayProvider: MaishaPayProvider,
  ) {
    /**
     * maishaPayProvider est filtré s'il est absent (undefined) :
     * cela permet à d'anciens tests ou harnais qui construisent
     * PaymentService avec seulement trois arguments de continuer à
     * fonctionner sans modification.
     */
    for (const provider of [sandboxProvider, maishaPayProvider]) {
      if (provider) {
        this.providers.set(provider.name, provider);
      }
    }

    this.providerName = process.env.PAYMENT_PROVIDER ?? 'sandbox';

    if (!this.providers.has(this.providerName)) {
      throw new Error(
        `Fournisseur de paiement inconnu : ${this.providerName}.`,
      );
    }

    /**
     * Le fournisseur de test crée de l'argent fictif : il ne doit
     * jamais tourner en production.
     */
    if (
      this.providerName === 'sandbox' &&
      process.env.NODE_ENV === 'production'
    ) {
      throw new Error(
        'Le fournisseur de test (sandbox) ne peut pas être utilisé en production.',
      );
    }
  }

  /**
   * Demande l'opération au fournisseur, applique le résultat, puis
   * renvoie la transaction à jour et le solde concerné.
   */
  async process(transactionId: string) {
    const transaction = await this.prisma.transaction.findUniqueOrThrow({
      where: {
        id: transactionId,
      },
      include: {
        currency: true,
      },
    });

    const provider = this.getProvider(transaction.provider);

    const input = {
      transactionReference: transaction.reference,
      amount: transaction.amount.toString(),
      currencyCode: transaction.currency?.code ?? 'USD',
      phone: transaction.counterpartyPhone ?? '',
      network: transaction.network ?? '',
    };

    let result: ProviderResult | null = null;

    try {
      if (transaction.type === TransactionType.DEPOSIT) {
        result = await provider.collect(input);
      } else if (transaction.type === TransactionType.WITHDRAWAL) {
        result = await provider.payout(input);
      }
    } catch (error) {
      /**
       * Erreur technique (fournisseur injoignable...) : on ne sait
       * pas si l'opération a eu lieu. La transaction reste EN
       * ATTENTE, avec ses fonds bloqués, jusqu'à la vérification
       * manuelle ou automatique (administration, réconciliation).
       */
      this.logger.error(
        `Fournisseur ${provider.name} : erreur sur ${transaction.reference}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    if (result) {
      await this.applyResult(transaction.id, result);
    }

    return this.snapshot(transaction.id);
  }

  /**
   * Traite un webhook envoyé par un fournisseur.
   */
  async handleWebhook(
    providerName: string,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ) {
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new NotFoundException('Fournisseur inconnu.');
    }

    /**
     * await fonctionne aussi bien sur une valeur simple que sur une
     * promesse : SandboxProvider (synchrone) et MaishaPayProvider
     * (asynchrone, car il revérifie le statut auprès de MaishaPay
     * avant de faire confiance au webhook) partagent donc ce même
     * appel.
     */
    const event = await provider.parseWebhook(headers, body);

    const transaction = await this.prisma.transaction.findFirst({
      where: {
        provider: providerName,
        providerReference: event.providerReference,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction introuvable.');
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      return {
        received: true,
        alreadyProcessed: true,
        status: transaction.status,
      };
    }

    const applied = await this.applyResult(transaction.id, {
      status: event.status,
      providerReference: event.providerReference,
      failureReason: event.failureReason,
    });

    const current = await this.prisma.transaction.findUniqueOrThrow({
      where: {
        id: transaction.id,
      },
    });

    return {
      received: true,
      alreadyProcessed: !applied,
      status: current.status,
    };
  }

  /**
   * Annule une transaction EN ATTENTE à la demande d'un
   * administrateur (voir AdminService). Un retrait rembourse
   * intégralement les fonds bloqués (montant + commission), avec
   * les écritures inverses dans le ledger ; un dépôt n'a encore
   * rien crédité, il n'y a donc rien à rembourser.
   *
   * Comme applyResult(), le passage EN ATTENTE -> ANNULÉE est
   * atomique : appeler cancel() deux fois (ou en même temps qu'un
   * webhook) ne rembourse jamais deux fois.
   */
  async cancel(transactionId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const transition = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          status: TransactionStatus.PENDING,
        },
        data: {
          status: TransactionStatus.CANCELLED,
          failureReason: reason,
        },
      });

      if (transition.count !== 1) {
        throw new ConflictException(
          "Cette transaction n'est plus en attente : elle a déjà été traitée (réussie, échouée, ou déjà annulée).",
        );
      }

      const transaction = await tx.transaction.findUniqueOrThrow({
        where: {
          id: transactionId,
        },
      });

      if (!transaction.currencyId) {
        throw new Error(
          `Transaction ${transaction.reference} sans devise : impossible de l'annuler.`,
        );
      }

      /**
       * Retrait annulé : les fonds bloqués retournent au wallet
       * (montant + commission), comme pour un refus du
       * fournisseur.
       */
      if (transaction.type === TransactionType.WITHDRAWAL) {
        if (!transaction.senderWalletId) {
          throw new Error('Retrait sans wallet émetteur.');
        }

        await tx.walletBalance.update({
          where: {
            walletId_currencyId: {
              walletId: transaction.senderWalletId,
              currencyId: transaction.currencyId,
            },
          },
          data: {
            balance: {
              increment: transaction.totalAmount,
            },
          },
        });

        await this.ledgerService.recordWithdrawalReversal(tx, {
          transactionId: transaction.id,
          walletId: transaction.senderWalletId,
          currencyId: transaction.currencyId,
          amount: transaction.amount,
          fee: transaction.fee,
        });
      }

      /**
       * Dépôt annulé : rien n'a encore été crédité (voir
       * applyResult), donc rien à rembourser.
       */

      return transaction;
    });
  }

  /**
   * Applique le résultat d'un fournisseur à une transaction EN
   * ATTENTE. Retourne true si ce résultat a été appliqué, false s'il
   * l'avait déjà été (ou si l'opération reste en attente).
   */
  async applyResult(
    transactionId: string,
    result: ProviderResult,
  ): Promise<boolean> {
    if (result.status === 'PENDING') {
      await this.prisma.transaction.updateMany({
        where: {
          id: transactionId,
          status: TransactionStatus.PENDING,
          providerReference: null,
        },
        data: {
          providerReference: result.providerReference,
        },
      });

      return false;
    }

    const finalStatus =
      result.status === 'COMPLETED'
        ? TransactionStatus.COMPLETED
        : TransactionStatus.FAILED;

    return this.prisma.$transaction(async (tx) => {
      /**
       * Passage atomique EN ATTENTE -> état final : un seul appel
       * l'obtient, même si plusieurs arrivent en même temps.
       */
      const transition = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          status: TransactionStatus.PENDING,
        },
        data: {
          status: finalStatus,
          providerReference: result.providerReference,
          failureReason:
            finalStatus === TransactionStatus.FAILED
              ? (result.failureReason ??
                'Opération refusée par le fournisseur.')
              : null,
        },
      });

      if (transition.count !== 1) {
        return false;
      }

      const transaction = await tx.transaction.findUniqueOrThrow({
        where: {
          id: transactionId,
        },
      });

      if (!transaction.currencyId) {
        throw new Error(
          `Transaction ${transaction.reference} sans devise : impossible de la finaliser.`,
        );
      }

      /**
       * Dépôt réussi : l'argent arrive enfin sur le wallet.
       */
      if (
        transaction.type === TransactionType.DEPOSIT &&
        finalStatus === TransactionStatus.COMPLETED
      ) {
        if (!transaction.receiverWalletId) {
          throw new Error('Dépôt sans wallet bénéficiaire.');
        }

        await tx.walletBalance.upsert({
          where: {
            walletId_currencyId: {
              walletId: transaction.receiverWalletId,
              currencyId: transaction.currencyId,
            },
          },
          create: {
            walletId: transaction.receiverWalletId,
            currencyId: transaction.currencyId,
            balance: transaction.amount,
          },
          update: {
            balance: {
              increment: transaction.amount,
            },
          },
        });

        await this.ledgerService.recordDeposit(tx, {
          transactionId: transaction.id,
          walletId: transaction.receiverWalletId,
          currencyId: transaction.currencyId,
          amount: transaction.amount,
        });
      }

      /**
       * Retrait refusé : les fonds bloqués retournent au wallet
       * (montant + commission), avec les écritures inverses dans le
       * ledger.
       */
      if (
        transaction.type === TransactionType.WITHDRAWAL &&
        finalStatus === TransactionStatus.FAILED
      ) {
        if (!transaction.senderWalletId) {
          throw new Error('Retrait sans wallet émetteur.');
        }

        await tx.walletBalance.update({
          where: {
            walletId_currencyId: {
              walletId: transaction.senderWalletId,
              currencyId: transaction.currencyId,
            },
          },
          data: {
            balance: {
              increment: transaction.totalAmount,
            },
          },
        });

        await this.ledgerService.recordWithdrawalReversal(tx, {
          transactionId: transaction.id,
          walletId: transaction.senderWalletId,
          currencyId: transaction.currencyId,
          amount: transaction.amount,
          fee: transaction.fee,
        });
      }

      return true;
    });
  }

  private getProvider(name: string | null): PaymentProvider {
    const provider = this.providers.get(name ?? this.providerName);

    if (!provider) {
      throw new NotFoundException(
        `Fournisseur de paiement inconnu : ${name}.`,
      );
    }

    return provider;
  }

  /**
   * La transaction telle qu'elle est maintenant, avec le solde du
   * wallet concerné dans sa devise.
   */
  private async snapshot(transactionId: string) {
    const transaction = await this.prisma.transaction.findUniqueOrThrow({
      where: {
        id: transactionId,
      },
      include: {
        senderUser: true,
        receiverUser: true,
        senderWallet: true,
        receiverWallet: true,
      },
    });

    const walletId =
      transaction.type === TransactionType.DEPOSIT
        ? transaction.receiverWalletId
        : transaction.senderWalletId;

    const balance =
      walletId && transaction.currencyId
        ? await this.prisma.walletBalance.findUnique({
            where: {
              walletId_currencyId: {
                walletId,
                currencyId: transaction.currencyId,
              },
            },
          })
        : null;

    return {
      transaction,
      balance: balance?.balance ?? new Prisma.Decimal(0),
    };
  }
}
