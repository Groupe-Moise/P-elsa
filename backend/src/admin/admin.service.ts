import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  LedgerAccountKind,
  TransactionStatus,
  UserStatus,
} from '../generated/prisma/enums';
import { PaymentService } from '../payments/payment.service';
import { AdminAuditService } from './admin-audit.service';

/**
 * =========================================================
 * ADMINISTRATION MINIMALE (J3)
 * =========================================================
 *
 * Toute route ici est réservée au rôle ADMIN (voir
 * AdminController). Ce service ne fait jamais bouger d'argent
 * lui-même : pour une transaction, il délègue à PaymentService
 * (déjà responsable de chaque mouvement de fonds), et se contente
 * de vérifier, journaliser, et présenter les données utiles à un
 * administrateur.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
    private readonly auditService: AdminAuditService,
  ) {}

  /**
   * Opérations en attente ou en échec, les plus récentes
   * d'abord — de quoi repérer ce qui a besoin d'une relance ou
   * d'une annulation.
   */
  async listOperations(status?: string) {
    const statuses = this.parseStatusFilter(status);

    return this.prisma.transaction.findMany({
      where: {
        status: {
          in: statuses,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 200,
      include: {
        currency: true,
        senderUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        receiverUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });
  }

  /**
   * Redemande l'opération au fournisseur de paiement. N'a
   * d'effet que sur une transaction encore EN ATTENTE (sinon,
   * le fournisseur a déjà répondu, ou l'opération a été
   * annulée) : PaymentService.process() est sans risque de
   * double effet dans tous les cas (passage atomique EN
   * ATTENTE -> état final), mais on évite ici un appel inutile
   * au fournisseur.
   */
  async retryTransaction(adminUserId: string, transactionId: string) {
    const transaction = await this.getTransactionOrThrow(transactionId);

    if (transaction.status !== TransactionStatus.PENDING) {
      throw new ConflictException(
        `Cette transaction n'est plus en attente (statut actuel : ${transaction.status}).`,
      );
    }

    const result = await this.paymentService.process(transactionId);

    await this.auditService.record(
      adminUserId,
      'TRANSACTION_RETRY',
      'transaction',
      transactionId,
      {
        reference: transaction.reference,
        newStatus: result.transaction.status,
      },
    );

    return result;
  }

  /**
   * Annule une transaction EN ATTENTE (voir
   * PaymentService.cancel : rembourse intégralement un retrait,
   * ne touche à rien pour un dépôt puisque rien n'a encore été
   * crédité).
   */
  async cancelTransaction(
    adminUserId: string,
    transactionId: string,
    reason?: string,
  ) {
    const transaction = await this.getTransactionOrThrow(transactionId);

    const cancelled = await this.paymentService.cancel(
      transactionId,
      reason?.trim() || 'Annulée par un administrateur.',
    );

    await this.auditService.record(
      adminUserId,
      'TRANSACTION_CANCEL',
      'transaction',
      transactionId,
      {
        reference: transaction.reference,
        reason: reason?.trim() || null,
      },
    );

    return cancelled;
  }

  /**
   * Vue d'ensemble par devise : total des soldes de wallets,
   * total des commissions perçues, fonds de flux côté
   * opérateur. Calculée à partir du ledger, la même source de
   * vérité que la réconciliation (GET /ledger/me).
   */
  async getOverview() {
    const [currencies, platformAccounts, walletTotals] = await Promise.all([
      this.prisma.currency.findMany({
        orderBy: {
          code: 'asc',
        },
      }),
      this.prisma.ledgerAccount.findMany({
        where: {
          kind: {
            in: [
              LedgerAccountKind.PLATFORM_COMMISSION,
              LedgerAccountKind.PLATFORM_FLOAT,
            ],
          },
        },
      }),
      this.prisma.walletBalance.groupBy({
        by: ['currencyId'],
        _sum: {
          balance: true,
        },
      }),
    ]);

    return Promise.all(
      currencies.map(async (currency) => {
        const commissionAccount = platformAccounts.find(
          (account) =>
            account.currencyId === currency.id &&
            account.kind === LedgerAccountKind.PLATFORM_COMMISSION,
        );

        const floatAccount = platformAccounts.find(
          (account) =>
            account.currencyId === currency.id &&
            account.kind === LedgerAccountKind.PLATFORM_FLOAT,
        );

        const [totalCommissions, platformFloat] = await Promise.all([
          this.sumLedgerAccount(commissionAccount?.id),
          this.sumLedgerAccount(floatAccount?.id),
        ]);

        const walletTotal =
          walletTotals.find((row) => row.currencyId === currency.id)?._sum
            .balance ?? new Prisma.Decimal(0);

        return {
          currency: currency.code,
          totalWalletBalances: walletTotal.toString(),
          totalCommissions: totalCommissions.toString(),
          platformFloat: platformFloat.toString(),
        };
      }),
    );
  }

  /**
   * Suspend un compte : connexion et opérations immédiatement
   * refusées (voir AuthService, qui exige status = ACTIVE).
   */
  async suspendUser(
    adminUserId: string,
    userId: string,
    reason?: string,
  ) {
    if (adminUserId === userId) {
      throw new BadRequestException(
        'Un administrateur ne peut pas suspendre son propre compte.',
      );
    }

    const user = await this.getUserOrThrow(userId);

    const updated = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        status: UserStatus.SUSPENDED,
      },
    });

    await this.auditService.record(
      adminUserId,
      'USER_SUSPEND',
      'user',
      userId,
      {
        phone: user.phone,
        previousStatus: user.status,
        reason: reason?.trim() || null,
      },
    );

    return this.toPublicUser(updated);
  }

  /**
   * Réactive un compte suspendu.
   */
  async reactivateUser(adminUserId: string, userId: string) {
    const user = await this.getUserOrThrow(userId);

    const updated = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        status: UserStatus.ACTIVE,
      },
    });

    await this.auditService.record(
      adminUserId,
      'USER_REACTIVATE',
      'user',
      userId,
      {
        phone: user.phone,
        previousStatus: user.status,
      },
    );

    return this.toPublicUser(updated);
  }

  /**
   * Débloque un PIN verrouillé après trop d'échecs (voir
   * PinAttemptsService, qui pose pinFailedAttempts et
   * pinLockedUntil).
   */
  async unlockUserPin(adminUserId: string, userId: string) {
    const user = await this.getUserOrThrow(userId);

    const updated = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });

    await this.auditService.record(
      adminUserId,
      'USER_UNLOCK_PIN',
      'user',
      userId,
      {
        phone: user.phone,
        wasLocked: user.pinLockedUntil !== null,
      },
    );

    return this.toPublicUser(updated);
  }

  async getAuditLog(limit?: number) {
    return this.auditService.list(limit);
  }

  private async getTransactionOrThrow(transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: {
        id: transactionId,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction introuvable.');
    }

    return transaction;
  }

  private async getUserOrThrow(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    return user;
  }

  private async sumLedgerAccount(
    accountId: string | undefined,
  ): Promise<InstanceType<typeof Prisma.Decimal>> {
    if (!accountId) {
      return new Prisma.Decimal(0);
    }

    const aggregate = await this.prisma.ledgerEntry.aggregate({
      where: {
        accountId,
      },
      _sum: {
        amount: true,
      },
    });

    return aggregate._sum.amount ?? new Prisma.Decimal(0);
  }

  private parseStatusFilter(status?: string): TransactionStatus[] {
    if (!status) {
      return [TransactionStatus.PENDING, TransactionStatus.FAILED];
    }

    const upper = status.toUpperCase();

    if (
      upper !== TransactionStatus.PENDING &&
      upper !== TransactionStatus.FAILED &&
      upper !== TransactionStatus.COMPLETED &&
      upper !== TransactionStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'Statut invalide (PENDING, FAILED, COMPLETED ou CANCELLED attendu).',
      );
    }

    return [upper as TransactionStatus];
  }

  private toPublicUser(user: {
    id: string;
    phone: string;
    firstName: string;
    lastName: string;
    role: string;
    status: string;
  }) {
    return {
      id: user.id,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
    };
  }
}
