import { Prisma } from '../generated/prisma/client';
import { LedgerAccountKind } from '../generated/prisma/enums';
import type { PrismaService } from '../database/prisma.service';
import { LedgerService } from './ledger.service';

interface FakeAccount {
  id: string;
  kind: string;
  walletId: string | null;
  currencyId: string;
}

interface FakeEntry {
  id: string;
  accountId: string;
  transactionId: string | null;
  amount: Prisma.Decimal;
  currencyId: string;
  description: string | null;
}

/**
 * Base de données simulée : suffisamment fidèle pour vérifier
 * que le service enregistre bien des écritures équilibrées et
 * réutilise les comptes déjà créés.
 */
function createFakeDb() {
  const accounts: FakeAccount[] = [];
  const entries: FakeEntry[] = [];
  let nextId = 1;

  const tx = {
    ledgerAccount: {
      findUnique: async ({
        where,
      }: {
        where: { walletId_currencyId: { walletId: string; currencyId: string } };
      }) =>
        accounts.find(
          (a) =>
            a.walletId === where.walletId_currencyId.walletId &&
            a.currencyId === where.walletId_currencyId.currencyId,
        ) ?? null,

      findFirst: async ({
        where,
      }: {
        where: { kind: string; currencyId: string; walletId: null };
      }) =>
        accounts.find(
          (a) =>
            a.kind === where.kind &&
            a.currencyId === where.currencyId &&
            a.walletId === null,
        ) ?? null,

      create: async ({
        data,
      }: {
        data: { kind: string; currencyId: string; walletId?: string };
      }) => {
        const account: FakeAccount = {
          id: `acc-${nextId++}`,
          kind: data.kind,
          walletId: data.walletId ?? null,
          currencyId: data.currencyId,
        };

        accounts.push(account);

        return account;
      },
    },

    ledgerEntry: {
      create: async ({
        data,
      }: {
        data: {
          accountId: string;
          transactionId: string;
          currencyId: string;
          amount: Prisma.Decimal | number | string;
          description: string;
        };
      }) => {
        const entry: FakeEntry = {
          id: `entry-${nextId++}`,
          accountId: data.accountId,
          transactionId: data.transactionId,
          amount: new Prisma.Decimal(data.amount),
          currencyId: data.currencyId,
          description: data.description,
        };

        entries.push(entry);

        return entry;
      },
    },
  };

  return { tx, accounts, entries };
}

function sumByAccount(entries: FakeEntry[], accountId: string): Prisma.Decimal {
  return entries
    .filter((e) => e.accountId === accountId)
    .reduce((total, e) => total.add(e.amount), new Prisma.Decimal(0));
}

describe('LedgerService', () => {
  it('équilibre un dépôt : wallet crédité, compte de flux débité du même montant', async () => {
    const { tx, accounts, entries } = createFakeDb();
    const service = new LedgerService({} as PrismaService);

    await service.recordDeposit(tx as never, {
      transactionId: 'tx-1',
      walletId: 'wallet-1',
      currencyId: 'usd',
      amount: 50,
    });

    const walletAccount = accounts.find((a) => a.walletId === 'wallet-1')!;
    const floatAccount = accounts.find(
      (a) => a.kind === LedgerAccountKind.PLATFORM_FLOAT,
    )!;

    expect(sumByAccount(entries, walletAccount.id).toNumber()).toBe(50);
    expect(sumByAccount(entries, floatAccount.id).toNumber()).toBe(-50);

    const total = entries.reduce(
      (sum, e) => sum.add(e.amount),
      new Prisma.Decimal(0),
    );
    expect(total.toNumber()).toBe(0);
  });

  it('équilibre un retrait : la commission va sur un compte séparé du wallet', async () => {
    const { tx, accounts, entries } = createFakeDb();
    const service = new LedgerService({} as PrismaService);

    await service.recordWithdrawal(tx as never, {
      transactionId: 'tx-2',
      walletId: 'wallet-1',
      currencyId: 'usd',
      amount: 100,
      fee: 0.5,
    });

    const walletAccount = accounts.find((a) => a.walletId === 'wallet-1')!;
    const floatAccount = accounts.find(
      (a) => a.kind === LedgerAccountKind.PLATFORM_FLOAT,
    )!;
    const commissionAccount = accounts.find(
      (a) => a.kind === LedgerAccountKind.PLATFORM_COMMISSION,
    )!;

    expect(sumByAccount(entries, walletAccount.id).toNumber()).toBe(-100.5);
    expect(sumByAccount(entries, floatAccount.id).toNumber()).toBe(100);
    expect(sumByAccount(entries, commissionAccount.id).toNumber()).toBe(0.5);
  });

  it('équilibre un transfert entre deux wallets, sans compte de plateforme', async () => {
    const { tx, accounts, entries } = createFakeDb();
    const service = new LedgerService({} as PrismaService);

    await service.recordTransfer(tx as never, {
      transactionId: 'tx-3',
      senderWalletId: 'wallet-1',
      receiverWalletId: 'wallet-2',
      currencyId: 'usd',
      amount: 20,
    });

    const senderAccount = accounts.find((a) => a.walletId === 'wallet-1')!;
    const receiverAccount = accounts.find((a) => a.walletId === 'wallet-2')!;

    expect(sumByAccount(entries, senderAccount.id).toNumber()).toBe(-20);
    expect(sumByAccount(entries, receiverAccount.id).toNumber()).toBe(20);
    expect(accounts).toHaveLength(2);
  });

  it('réutilise le même compte de plateforme entre deux opérations', async () => {
    const { tx, accounts } = createFakeDb();
    const service = new LedgerService({} as PrismaService);

    await service.recordDeposit(tx as never, {
      transactionId: 'tx-4',
      walletId: 'wallet-1',
      currencyId: 'usd',
      amount: 10,
    });

    await service.recordDeposit(tx as never, {
      transactionId: 'tx-5',
      walletId: 'wallet-2',
      currencyId: 'usd',
      amount: 10,
    });

    const floatAccounts = accounts.filter(
      (a) => a.kind === LedgerAccountKind.PLATFORM_FLOAT,
    );

    expect(floatAccounts).toHaveLength(1);
  });

  it('réutilise le même compte wallet pour deux opérations successives', async () => {
    const { tx, accounts } = createFakeDb();
    const service = new LedgerService({} as PrismaService);

    await service.recordDeposit(tx as never, {
      transactionId: 'tx-6',
      walletId: 'wallet-1',
      currencyId: 'usd',
      amount: 10,
    });

    await service.recordWithdrawal(tx as never, {
      transactionId: 'tx-7',
      walletId: 'wallet-1',
      currencyId: 'usd',
      amount: 5,
      fee: 0.1,
    });

    const walletAccounts = accounts.filter((a) => a.walletId === 'wallet-1');
    expect(walletAccounts).toHaveLength(1);
  });

  it('annule un retrait refusé : remboursement complet, commission comprise', async () => {
    const { tx, accounts, entries } = createFakeDb();
    const service = new LedgerService({} as PrismaService);

    await service.recordWithdrawal(tx as never, {
      transactionId: 'tx-8',
      walletId: 'wallet-1',
      currencyId: 'usd',
      amount: 100,
      fee: 0.5,
    });

    await service.recordWithdrawalReversal(tx as never, {
      transactionId: 'tx-8',
      walletId: 'wallet-1',
      currencyId: 'usd',
      amount: 100,
      fee: 0.5,
    });

    for (const account of accounts) {
      expect(sumByAccount(entries, account.id).toNumber()).toBe(0);
    }

    // L'historique est conservé : 3 écritures d'origine + 3 écritures inverses.
    expect(entries).toHaveLength(6);
  });
});
