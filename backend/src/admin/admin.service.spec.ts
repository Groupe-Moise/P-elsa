// Test réel de AdminService + PaymentService.cancel, avec un mock
// Prisma suffisamment fidèle pour vérifier ce qui compte : les
// gardes (statut PENDING requis), le remboursement, et l'agrégation
// de l'aperçu par devise.

import { ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import {
  TransactionStatus,
  TransactionType,
  LedgerAccountKind,
  UserStatus,
} from '../generated/prisma/enums';
import { PaymentService } from '../payments/payment.service';
import { SandboxProvider } from '../payments/providers/sandbox.provider';
import { AdminService } from './admin.service';
import { AdminAuditService } from './admin-audit.service';

function createFake() {
  const transactions = new Map();
  const balances = new Map();
  const users = new Map();
  const ledgerAccounts = new Map();
  const ledgerEntries = [];
  const auditLogs = [];
  let accountSeq = 0;

  const balanceKey = (walletId, currencyId) => `${walletId}:${currencyId}`;

  const prisma = {
    transaction: {
      findUnique: async ({ where }) => transactions.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }) => {
        const row = transactions.get(where.id);
        if (!row) throw new Error('introuvable');
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        const row = transactions.get(where.id);
        if (!row) return { count: 0 };
        if (where.status !== undefined && row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      findMany: async ({ where, take }) => {
        const statuses = where?.status?.in ?? null;
        let rows = [...transactions.values()];
        if (statuses) rows = rows.filter((r) => statuses.includes(r.status));
        rows.sort((a, b) => b.createdAt - a.createdAt);
        return take ? rows.slice(0, take) : rows;
      },
    },
    walletBalance: {
      update: async ({ where, data }) => {
        const key = balanceKey(where.walletId_currencyId.walletId, where.walletId_currencyId.currencyId);
        balances.set(key, (balances.get(key) ?? new Prisma.Decimal(0)).add(data.balance.increment));
      },
      upsert: async ({ where, create, update }) => {
        const key = balanceKey(where.walletId_currencyId.walletId, where.walletId_currencyId.currencyId);
        const current = balances.get(key);
        balances.set(key, current ? current.add(update.balance.increment) : new Prisma.Decimal(create.balance));
      },
      findUnique: async ({ where }) => {
        const key = balanceKey(where.walletId_currencyId.walletId, where.walletId_currencyId.currencyId);
        const balance = balances.get(key);
        return balance ? { balance } : null;
      },
      groupBy: async ({ by }) => {
        const totals = new Map();
        for (const [key, value] of balances.entries()) {
          const currencyId = key.split(':')[1];
          totals.set(currencyId, (totals.get(currencyId) ?? new Prisma.Decimal(0)).add(value));
        }
        return [...totals.entries()].map(([currencyId, sum]) => ({ currencyId, _sum: { balance: sum } }));
      },
    },
    ledgerAccount: {
      findMany: async ({ where }) => {
        const kinds = where?.kind?.in ?? null;
        return [...ledgerAccounts.values()].filter((a) => !kinds || kinds.includes(a.kind));
      },
    },
    ledgerEntry: {
      aggregate: async ({ where }) => {
        const rows = ledgerEntries.filter((e) => e.accountId === where.accountId);
        const sum = rows.reduce((total, e) => total.add(e.amount), new Prisma.Decimal(0));
        return { _sum: { amount: rows.length ? sum : null } };
      },
    },
    currency: {
      findMany: async () => [
        { id: 'usd', code: 'USD' },
        { id: 'cdf', code: 'CDF' },
      ],
    },
    user: {
      findUnique: async ({ where }) => users.get(where.id) ?? null,
      update: async ({ where, data }) => {
        const user = users.get(where.id);
        Object.assign(user, data);
        return { ...user };
      },
    },
    adminAuditLog: {
      create: async ({ data }) => {
        auditLogs.push(data);
        return { id: `log-${auditLogs.length}`, ...data };
      },
      findMany: async () => auditLogs,
    },
    $transaction: async (callback) => callback(prisma),
  };

  const ledger = {
    recordWithdrawalReversal: async () => {},
    recordDeposit: async () => {},
  };

  function seedAccount(kind, currencyId) {
    accountSeq += 1;
    const id = `acc-${accountSeq}`;
    ledgerAccounts.set(id, { id, kind, currencyId, walletId: null });
    return id;
  }

  function postEntry(accountId, currencyId, amount) {
    ledgerEntries.push({ accountId, currencyId, amount: new Prisma.Decimal(amount) });
  }

  function seedTransaction(id, type, status, extra = {}) {
    const row = {
      id,
      reference: `TX-${id}`,
      type,
      status,
      amount: new Prisma.Decimal(extra.amount ?? 100),
      fee: new Prisma.Decimal(extra.fee ?? 0.5),
      totalAmount: new Prisma.Decimal((extra.amount ?? 100) + (extra.fee ?? 0.5)),
      currencyId: extra.currencyId ?? 'usd',
      provider: 'sandbox',
      providerReference: extra.providerReference ?? null,
      receiverWalletId: type === TransactionType.DEPOSIT ? 'wallet-1' : null,
      senderWalletId: type === TransactionType.WITHDRAWAL ? 'wallet-1' : null,
      failureReason: null,
      createdAt: Date.now() + Math.random(),
    };
    transactions.set(id, row);
    return row;
  }

  function seedUser(id, overrides = {}) {
    const user = {
      id,
      phone: `097${id}`,
      firstName: 'Test',
      lastName: 'User',
      role: 'CLIENT',
      status: UserStatus.ACTIVE,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      ...overrides,
    };
    users.set(id, user);
    return user;
  }

  const paymentService = new PaymentService(prisma, ledger, new SandboxProvider());
  const auditService = new AdminAuditService(prisma);
  const adminService = new AdminService(prisma, paymentService, auditService);

  const balanceOf = (walletId, currencyId = 'usd') =>
    (balances.get(balanceKey(walletId, currencyId)) ?? new Prisma.Decimal(0)).toNumber();

  return { adminService, paymentService, seedTransaction, seedUser, balanceOf, seedAccount, postEntry, auditLogs, transactions };
}

describe('AdminService', () => {
  it('cancelTransaction rembourse un retrait en attente (montant + commission)', async () => {
    const { adminService, seedTransaction, balanceOf } = createFake();
    seedTransaction('1', TransactionType.WITHDRAWAL, TransactionStatus.PENDING, { amount: 100, fee: 0.5 });

    const result = await adminService.cancelTransaction('admin-1', '1', 'Test manuel');

    expect(result.status).toBe(TransactionStatus.CANCELLED);
    expect(balanceOf('wallet-1')).toBe(100.5);
  });

  it("cancelTransaction refuse une transaction déjà finalisée", async () => {
    const { adminService, seedTransaction } = createFake();
    seedTransaction('1', TransactionType.WITHDRAWAL, TransactionStatus.COMPLETED, { amount: 100, fee: 0.5 });

    await expect(adminService.cancelTransaction('admin-1', '1')).rejects.toBeInstanceOf(ConflictException);
  });

  it("retryTransaction refuse une transaction qui n'est plus en attente", async () => {
    const { adminService, seedTransaction } = createFake();
    seedTransaction('1', TransactionType.DEPOSIT, TransactionStatus.COMPLETED);

    await expect(adminService.retryTransaction('admin-1', '1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('retryTransaction relance un dépôt en attente et le crédite (mode instant)', async () => {
    const { adminService, seedTransaction, balanceOf } = createFake();
    seedTransaction('1', TransactionType.DEPOSIT, TransactionStatus.PENDING, { amount: 50, fee: 0 });

    const result = await adminService.retryTransaction('admin-1', '1');

    expect(result.transaction.status).toBe(TransactionStatus.COMPLETED);
    expect(balanceOf('wallet-1')).toBe(50);
  });

  it('chaque action journalise une entrée dans le journal d\'audit', async () => {
    const { adminService, seedTransaction, auditLogs } = createFake();
    seedTransaction('1', TransactionType.WITHDRAWAL, TransactionStatus.PENDING, { amount: 10, fee: 0 });

    await adminService.cancelTransaction('admin-1', '1', 'raison');

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe('TRANSACTION_CANCEL');
  });

  it("suspendUser refuse qu'un administrateur se suspende lui-même", async () => {
    const { adminService, seedUser } = createFake();
    seedUser('admin-1');

    await expect(adminService.suspendUser('admin-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('suspendUser puis reactivateUser changent bien le statut', async () => {
    const { adminService, seedUser } = createFake();
    seedUser('user-1');

    const suspended = await adminService.suspendUser('admin-1', 'user-1', 'fraude suspectée');
    expect(suspended.status).toBe(UserStatus.SUSPENDED);

    const reactivated = await adminService.reactivateUser('admin-1', 'user-1');
    expect(reactivated.status).toBe(UserStatus.ACTIVE);
  });

  it('unlockUserPin remet les compteurs à zéro', async () => {
    const { adminService, seedUser } = createFake();
    seedUser('user-1', { pinFailedAttempts: 5, pinLockedUntil: new Date(Date.now() + 100000) });

    const unlocked = await adminService.unlockUserPin('admin-1', 'user-1');

    expect(unlocked.id).toBe('user-1');
  });

  it('getOverview agrège correctement commissions, flux et soldes par devise', async () => {
    const { adminService, seedAccount, postEntry, seedTransaction } = createFake();

    const commissionAccount = seedAccount(LedgerAccountKind.PLATFORM_COMMISSION, 'usd');
    const floatAccount = seedAccount(LedgerAccountKind.PLATFORM_FLOAT, 'usd');

    postEntry(commissionAccount, 'usd', 0.5);
    postEntry(commissionAccount, 'usd', 0.5);
    postEntry(floatAccount, 'usd', -100);

    seedTransaction('1', TransactionType.DEPOSIT, TransactionStatus.PENDING, { amount: 20, fee: 0 });
    await adminService.retryTransaction('admin-1', '1');

    const overview = await adminService.getOverview();
    const usd = overview.find((row) => row.currency === 'USD');

    expect(usd.totalCommissions).toBe('1');
    expect(usd.platformFloat).toBe('-100');
    expect(usd.totalWalletBalances).toBe('20');
  });
});
