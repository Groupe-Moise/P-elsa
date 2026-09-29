import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { LedgerAccountKind } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';

/**
 * Client Prisma utilisable à l'intérieur d'un this.prisma.$transaction(...).
 */
type PrismaTx = Prisma.TransactionClient;

interface RecordDepositInput {
  transactionId: string;
  walletId: string;
  currencyId: string;
  amount: Prisma.Decimal | number | string;
}

interface RecordWithdrawalInput {
  transactionId: string;
  walletId: string;
  currencyId: string;
  amount: Prisma.Decimal | number | string;
  fee: Prisma.Decimal | number | string;
}

interface RecordWithdrawalReversalInput {
  transactionId: string;
  walletId: string;
  currencyId: string;
  amount: Prisma.Decimal | number | string;
  fee: Prisma.Decimal | number | string;
}

interface RecordTransferInput {
  transactionId: string;
  senderWalletId: string;
  receiverWalletId: string;
  currencyId: string;
  amount: Prisma.Decimal | number | string;
}

interface RecordExchangeInput {
  transactionId: string;
  walletId: string;
  fromCurrencyId: string;
  toCurrencyId: string;
  fromAmount: Prisma.Decimal | number | string;
  toAmount: Prisma.Decimal | number | string;
}

export interface WalletReconciliation {
  walletId: string;
  walletBalance: string;
  ledgerBalance: string;
  matches: boolean;
}

/**
 * =========================================================
 * LEDGER : COMPTABILITÉ À DOUBLE ENTRÉE
 * =========================================================
 *
 * Chaque opération (dépôt, retrait, transfert) enregistre au
 * moins deux écritures dont la somme signée est nulle : un
 * compte est crédité, un autre débité du même montant. C'est
 * ce qui permet de garder les fonds des utilisateurs séparés
 * des fonds P-ELSA (une commission n'est jamais mélangée à un
 * solde de wallet, elle est toujours sur son propre compte),
 * et de prouver à tout moment que rien n'a été créé ni perdu.
 *
 * Le solde de Wallet.balance reste la valeur utilisée pour les
 * vérifications rapides (le débit conditionnel qui empêche la
 * double dépense) : ce service ne le remplace pas, il vérifie
 * qu'il reste cohérent avec le ledger (voir reconcileWallet).
 *
 * Les comptes de plateforme (PLATFORM_COMMISSION,
 * PLATFORM_FLOAT) sont uniques par devise et créés à la
 * demande. Leur identifiant est mis en cache en mémoire pour
 * éviter une recherche à chaque opération ; avec plusieurs
 * instances du serveur en parallèle, une petite duplication
 * est possible à la toute première création d'un compte de
 * plateforme pour une devise donnée, sans conséquence pour les
 * opérations suivantes (voir getOrCreatePlatformAccount).
 */
@Injectable()
export class LedgerService {
  private readonly platformAccountCache = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async recordDeposit(
    tx: PrismaTx,
    input: RecordDepositInput,
  ): Promise<void> {
    const walletAccountId = await this.getOrCreateWalletAccount(
      tx,
      input.walletId,
      input.currencyId,
    );

    const floatAccountId = await this.getOrCreatePlatformAccount(
      tx,
      LedgerAccountKind.PLATFORM_FLOAT,
      input.currencyId,
    );

    await this.postBalancedEntries(tx, input.transactionId, input.currencyId, [
      {
        accountId: walletAccountId,
        amount: input.amount,
        description: 'Dépôt : crédit du wallet',
      },
      {
        accountId: floatAccountId,
        amount: this.negate(input.amount),
        description: 'Dépôt : fonds reçus (compte de flux P-ELSA)',
      },
    ]);
  }

  async recordWithdrawal(
    tx: PrismaTx,
    input: RecordWithdrawalInput,
  ): Promise<void> {
    const walletAccountId = await this.getOrCreateWalletAccount(
      tx,
      input.walletId,
      input.currencyId,
    );

    const floatAccountId = await this.getOrCreatePlatformAccount(
      tx,
      LedgerAccountKind.PLATFORM_FLOAT,
      input.currencyId,
    );

    const commissionAccountId = await this.getOrCreatePlatformAccount(
      tx,
      LedgerAccountKind.PLATFORM_COMMISSION,
      input.currencyId,
    );

    const totalAmount = new Prisma.Decimal(input.amount).add(
      new Prisma.Decimal(input.fee),
    );

    await this.postBalancedEntries(tx, input.transactionId, input.currencyId, [
      {
        accountId: walletAccountId,
        amount: this.negate(totalAmount),
        description: 'Retrait : débit du wallet (montant + commission)',
      },
      {
        accountId: floatAccountId,
        amount: input.amount,
        description: 'Retrait : fonds à verser (compte de flux P-ELSA)',
      },
      {
        accountId: commissionAccountId,
        amount: input.fee,
        description: 'Retrait : commission P-ELSA',
      },
    ]);
  }

  /**
   * Annule un retrait refusé par le fournisseur : mêmes montants que
   * recordWithdrawal, de signe opposé. Les écritures d'origine ne sont
   * jamais modifiées ni supprimées : on ajoute leur contraire, pour
   * garder l'historique complet.
   */
  async recordWithdrawalReversal(
    tx: PrismaTx,
    input: RecordWithdrawalReversalInput,
  ): Promise<void> {
    const walletAccountId = await this.getOrCreateWalletAccount(
      tx,
      input.walletId,
      input.currencyId,
    );

    const floatAccountId = await this.getOrCreatePlatformAccount(
      tx,
      LedgerAccountKind.PLATFORM_FLOAT,
      input.currencyId,
    );

    const commissionAccountId = await this.getOrCreatePlatformAccount(
      tx,
      LedgerAccountKind.PLATFORM_COMMISSION,
      input.currencyId,
    );

    const totalAmount = new Prisma.Decimal(input.amount).add(
      new Prisma.Decimal(input.fee),
    );

    await this.postBalancedEntries(tx, input.transactionId, input.currencyId, [
      {
        accountId: walletAccountId,
        amount: totalAmount,
        description: 'Retrait refusé : remboursement du wallet (montant + commission)',
      },
      {
        accountId: floatAccountId,
        amount: this.negate(input.amount),
        description: 'Retrait refusé : fonds non versés (compte de flux P-ELSA)',
      },
      {
        accountId: commissionAccountId,
        amount: this.negate(input.fee),
        description: 'Retrait refusé : commission annulée',
      },
    ]);
  }

  async recordTransfer(
    tx: PrismaTx,
    input: RecordTransferInput,
  ): Promise<void> {
    const senderAccountId = await this.getOrCreateWalletAccount(
      tx,
      input.senderWalletId,
      input.currencyId,
    );

    const receiverAccountId = await this.getOrCreateWalletAccount(
      tx,
      input.receiverWalletId,
      input.currencyId,
    );

    await this.postBalancedEntries(tx, input.transactionId, input.currencyId, [
      {
        accountId: senderAccountId,
        amount: this.negate(input.amount),
        description: 'Transfert envoyé',
      },
      {
        accountId: receiverAccountId,
        amount: input.amount,
        description: 'Transfert reçu',
      },
    ]);
  }

  /**
   * Bureau de change : conversion d'un solde d'une devise vers une
   * autre, à l'intérieur du MÊME wallet. Contrairement à un
   * transfert (même devise, deux wallets), il s'agit ici de deux
   * devises différentes sur un seul wallet : `postBalancedEntries`
   * n'équilibre les écritures que par devise, donc chaque devise a
   * son propre jeu d'écritures, équilibré via le compte de réserve
   * de change de P-ELSA (PLATFORM_EXCHANGE) plutôt que directement
   * entre les deux comptes du wallet :
   *
   * - devise source : le wallet est débité, la réserve de change
   *   (dans cette même devise) est créditée du montant reçu.
   * - devise cible : la réserve de change (dans l'autre devise) est
   *   débitée, le wallet est crédité du montant converti.
   */
  async recordExchange(
    tx: PrismaTx,
    input: RecordExchangeInput,
  ): Promise<void> {
    const walletFromAccountId = await this.getOrCreateWalletAccount(
      tx,
      input.walletId,
      input.fromCurrencyId,
    );

    const walletToAccountId = await this.getOrCreateWalletAccount(
      tx,
      input.walletId,
      input.toCurrencyId,
    );

    const exchangeFromAccountId = await this.getOrCreatePlatformAccount(
      tx,
      LedgerAccountKind.PLATFORM_EXCHANGE,
      input.fromCurrencyId,
    );

    const exchangeToAccountId = await this.getOrCreatePlatformAccount(
      tx,
      LedgerAccountKind.PLATFORM_EXCHANGE,
      input.toCurrencyId,
    );

    await this.postBalancedEntries(tx, input.transactionId, input.fromCurrencyId, [
      {
        accountId: walletFromAccountId,
        amount: this.negate(input.fromAmount),
        description: 'Change : débit du wallet (devise source)',
      },
      {
        accountId: exchangeFromAccountId,
        amount: input.fromAmount,
        description: 'Change : devise source reçue (réserve de change P-ELSA)',
      },
    ]);

    await this.postBalancedEntries(tx, input.transactionId, input.toCurrencyId, [
      {
        accountId: exchangeToAccountId,
        amount: this.negate(input.toAmount),
        description: 'Change : devise cible versée (réserve de change P-ELSA)',
      },
      {
        accountId: walletToAccountId,
        amount: input.toAmount,
        description: 'Change : crédit du wallet (devise cible)',
      },
    ]);
  }

  /**
   * Vérifie que le solde du wallet égale la somme de ses
   * écritures. Ne modifie rien ; sert à l'auto-contrôle
   * (endpoint GET /ledger/me, outils d'administration futurs).
   */
  async reconcileWallet(
    walletId: string,
    currencyId: string,
  ): Promise<WalletReconciliation> {
    const walletBalance = await this.prisma.walletBalance.findUniqueOrThrow({
      where: {
        walletId_currencyId: {
          walletId,
          currencyId,
        },
      },
    });

    const account = await this.prisma.ledgerAccount.findUnique({
      where: {
        walletId_currencyId: {
          walletId,
          currencyId,
        },
      },
    });

    const aggregate = account
      ? await this.prisma.ledgerEntry.aggregate({
          where: {
            accountId: account.id,
          },
          _sum: {
            amount: true,
          },
        })
      : null;

    const ledgerBalance =
      aggregate?._sum.amount ?? new Prisma.Decimal(0);

    return {
      walletId,
      walletBalance: walletBalance.balance.toString(),
      ledgerBalance: ledgerBalance.toString(),
      matches: walletBalance.balance.equals(ledgerBalance),
    };
  }

  private async getOrCreateWalletAccount(
    tx: PrismaTx,
    walletId: string,
    currencyId: string,
  ): Promise<string> {
    const existing = await tx.ledgerAccount.findUnique({
      where: {
        walletId_currencyId: {
          walletId,
          currencyId,
        },
      },
    });

    if (existing) {
      return existing.id;
    }

    const created = await tx.ledgerAccount.create({
      data: {
        kind: LedgerAccountKind.WALLET,
        walletId,
        currencyId,
      },
    });

    return created.id;
  }

  /**
   * Les comptes de plateforme (commission, flux) sont uniques
   * par (kind, devise). Comme walletId est vide pour ces
   * comptes, la contrainte unique sur walletId ne les protège
   * pas d'un doublon : on cherche d'abord, on crée sinon, et on
   * met le résultat en cache pour ne plus refaire la recherche.
   */
  private async getOrCreatePlatformAccount(
    tx: PrismaTx,
    kind:
      | typeof LedgerAccountKind.PLATFORM_COMMISSION
      | typeof LedgerAccountKind.PLATFORM_FLOAT
      | typeof LedgerAccountKind.PLATFORM_EXCHANGE,
    currencyId: string,
  ): Promise<string> {
    const cacheKey = `${kind}:${currencyId}`;
    const cached = this.platformAccountCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const existing = await tx.ledgerAccount.findFirst({
      where: {
        kind,
        currencyId,
        walletId: null,
      },
    });

    if (existing) {
      this.platformAccountCache.set(cacheKey, existing.id);

      return existing.id;
    }

    const created = await tx.ledgerAccount.create({
      data: {
        kind,
        currencyId,
      },
    });

    this.platformAccountCache.set(cacheKey, created.id);

    return created.id;
  }

  /**
   * Enregistre un ensemble d'écritures après avoir vérifié que
   * leur somme est nulle : une erreur ici est un bug de calcul
   * dans le code appelant, jamais une situation normale.
   */
  private async postBalancedEntries(
    tx: PrismaTx,
    transactionId: string,
    currencyId: string,
    lines: Array<{
      accountId: string;
      amount: Prisma.Decimal | number | string;
      description: string;
    }>,
  ): Promise<void> {
    const sum = lines.reduce(
      (total, line) => total.add(new Prisma.Decimal(line.amount)),
      new Prisma.Decimal(0),
    );

    if (!sum.equals(0)) {
      throw new Error(
        `Écritures comptables déséquilibrées (somme = ${sum.toString()}).`,
      );
    }

    for (const line of lines) {
      await tx.ledgerEntry.create({
        data: {
          accountId: line.accountId,
          transactionId,
          currencyId,
          amount: line.amount,
          description: line.description,
        },
      });
    }
  }

  private negate(
    amount: Prisma.Decimal | number | string,
  ): Prisma.Decimal {
    return new Prisma.Decimal(amount).negated();
  }
}
