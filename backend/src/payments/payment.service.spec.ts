import { UnauthorizedException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import {
  TransactionStatus,
  TransactionType,
} from '../generated/prisma/enums';
import { PaymentService } from './payment.service';
import {
  SandboxProvider,
  signSandboxEvent,
} from './providers/sandbox.provider';

interface FakeTransaction {
  id: string;
  reference: string;
  type: string;
  status: string;
  amount: Prisma.Decimal;
  fee: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  currencyId: string | null;
  provider: string | null;
  providerReference: string | null;
  receiverWalletId: string | null;
  senderWalletId: string | null;
  counterpartyPhone: string | null;
  network: string | null;
  failureReason: string | null;
}

interface WhereById {
  id: string;
  status?: string;
  providerReference?: null;
}

/**
 * Base de données simulée : suffisamment fidèle pour vérifier le
 * comportement qui compte le plus ici, à savoir que le passage
 * EN ATTENTE -> état final n'est accordé qu'une seule fois.
 */
function createFake() {
  const transactions = new Map<string, FakeTransaction>();
  const balances = new Map<string, Prisma.Decimal>();
  const calls = { deposits: 0, reversals: 0 };

  const balanceKey = (walletId: string, currencyId: string) =>
    `${walletId}:${currencyId}`;

  const prisma = {
    transaction: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = transactions.get(where.id);

        if (!row) {
          throw new Error('introuvable');
        }

        return { ...row, currency: { code: 'USD' } };
      },

      findFirst: async ({
        where,
      }: {
        where: { provider: string; providerReference: string };
      }) =>
        [...transactions.values()].find(
          (row) =>
            row.provider === where.provider &&
            row.providerReference === where.providerReference,
        ) ?? null,

      updateMany: async ({
        where,
        data,
      }: {
        where: WhereById;
        data: Partial<FakeTransaction>;
      }) => {
        const row = transactions.get(where.id);

        if (!row) {
          return { count: 0 };
        }

        if (where.status !== undefined && row.status !== where.status) {
          return { count: 0 };
        }

        if (where.providerReference === null && row.providerReference !== null) {
          return { count: 0 };
        }

        Object.assign(row, data);

        return { count: 1 };
      },
    },

    walletBalance: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { walletId_currencyId: { walletId: string; currencyId: string } };
        create: { balance: Prisma.Decimal };
        update: { balance: { increment: Prisma.Decimal } };
      }) => {
        const key = balanceKey(
          where.walletId_currencyId.walletId,
          where.walletId_currencyId.currencyId,
        );
        const current = balances.get(key);

        balances.set(
          key,
          current
            ? current.add(update.balance.increment)
            : new Prisma.Decimal(create.balance),
        );
      },

      update: async ({
        where,
        data,
      }: {
        where: { walletId_currencyId: { walletId: string; currencyId: string } };
        data: { balance: { increment: Prisma.Decimal } };
      }) => {
        const key = balanceKey(
          where.walletId_currencyId.walletId,
          where.walletId_currencyId.currencyId,
        );

        balances.set(
          key,
          (balances.get(key) ?? new Prisma.Decimal(0)).add(
            data.balance.increment,
          ),
        );
      },

      findUnique: async ({
        where,
      }: {
        where: { walletId_currencyId: { walletId: string; currencyId: string } };
      }) => {
        const balance = balances.get(
          balanceKey(
            where.walletId_currencyId.walletId,
            where.walletId_currencyId.currencyId,
          ),
        );

        return balance ? { balance } : null;
      },
    },

    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma),
  };

  const ledger = {
    recordDeposit: async () => {
      calls.deposits++;
    },
    recordWithdrawalReversal: async () => {
      calls.reversals++;
    },
  };

  const service = new PaymentService(
    prisma as never,
    ledger as never,
    new SandboxProvider(),
  );

  const seed = (
    id: string,
    type: string,
    amount: number,
    fee = 0,
  ): FakeTransaction => {
    const row: FakeTransaction = {
      id,
      reference: `TX-${id}`,
      type,
      status: TransactionStatus.PENDING,
      amount: new Prisma.Decimal(amount),
      fee: new Prisma.Decimal(fee),
      totalAmount: new Prisma.Decimal(amount + fee),
      currencyId: 'usd',
      provider: 'sandbox',
      providerReference: null,
      receiverWalletId: type === TransactionType.DEPOSIT ? 'wallet-1' : null,
      senderWalletId: type === TransactionType.WITHDRAWAL ? 'wallet-1' : null,
      counterpartyPhone: '+243975555555',
      network: 'Airtel Money',
      failureReason: null,
    };

    transactions.set(id, row);

    return row;
  };

  const balanceOf = () =>
    (balances.get(balanceKey('wallet-1', 'usd')) ?? new Prisma.Decimal(0)).toNumber();

  return { service, seed, calls, balanceOf, transactions };
}

function webhook(providerReference: string, status: 'COMPLETED' | 'FAILED') {
  return {
    headers: {
      'x-sandbox-signature': signSandboxEvent(providerReference, status),
    },
    body: { providerReference, status },
  };
}

async function withMode<T>(mode: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.PAYMENT_SANDBOX_MODE;

  process.env.PAYMENT_SANDBOX_MODE = mode;

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.PAYMENT_SANDBOX_MODE;
    } else {
      process.env.PAYMENT_SANDBOX_MODE = previous;
    }
  }
}

describe('PaymentService', () => {
  it('mode instant : un dépôt est crédité tout de suite (comportement historique)', async () => {
    const { service, seed, calls, balanceOf } = createFake();

    seed('1', TransactionType.DEPOSIT, 50);

    const settled = await withMode('instant', () => service.process('1'));

    expect(settled.transaction.status).toBe(TransactionStatus.COMPLETED);
    expect(balanceOf()).toBe(50);
    expect(calls.deposits).toBe(1);
  });

  it('mode async : un dépôt reste en attente, sans rien créditer', async () => {
    const { service, seed, calls, balanceOf, transactions } = createFake();

    seed('1', TransactionType.DEPOSIT, 50);

    const settled = await withMode('async', () => service.process('1'));

    expect(settled.transaction.status).toBe(TransactionStatus.PENDING);
    expect(balanceOf()).toBe(0);
    expect(calls.deposits).toBe(0);
    expect(transactions.get('1')?.providerReference).toBe('SBX-TX-1');
  });

  it('un webhook rejoué deux fois ne crédite qu\'une seule fois', async () => {
    const { service, seed, calls, balanceOf } = createFake();

    seed('1', TransactionType.DEPOSIT, 50);
    await withMode('async', () => service.process('1'));

    const event = webhook('SBX-TX-1', 'COMPLETED');

    const first = await service.handleWebhook('sandbox', event.headers, event.body);
    const second = await service.handleWebhook('sandbox', event.headers, event.body);

    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(true);
    expect(balanceOf()).toBe(50);
    expect(calls.deposits).toBe(1);
  });

  it('deux webhooks simultanés ne créditent qu\'une seule fois', async () => {
    const { service, seed, calls, balanceOf } = createFake();

    seed('1', TransactionType.DEPOSIT, 50);
    await withMode('async', () => service.process('1'));

    const event = webhook('SBX-TX-1', 'COMPLETED');

    await Promise.all([
      service.handleWebhook('sandbox', event.headers, event.body),
      service.handleWebhook('sandbox', event.headers, event.body),
      service.handleWebhook('sandbox', event.headers, event.body),
    ]);

    expect(balanceOf()).toBe(50);
    expect(calls.deposits).toBe(1);
  });

  it('un webhook à la signature invalide est refusé, rien n\'est crédité', async () => {
    const { service, seed, balanceOf } = createFake();

    seed('1', TransactionType.DEPOSIT, 50);
    await withMode('async', () => service.process('1'));

    await expect(
      service.handleWebhook(
        'sandbox',
        { 'x-sandbox-signature': 'signature-falsifiee' },
        { providerReference: 'SBX-TX-1', status: 'COMPLETED' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(balanceOf()).toBe(0);
  });

  it('un dépôt refusé par le fournisseur ne crédite rien', async () => {
    const { service, seed, calls, balanceOf } = createFake();

    seed('1', TransactionType.DEPOSIT, 50);

    const settled = await withMode('fail', () => service.process('1'));

    expect(settled.transaction.status).toBe(TransactionStatus.FAILED);
    expect(balanceOf()).toBe(0);
    expect(calls.deposits).toBe(0);
  });

  it('un retrait refusé rembourse montant + commission, une seule fois même si le webhook est rejoué', async () => {
    const { service, seed, calls, balanceOf } = createFake();

    // Les fonds (100 + 0,5) ont déjà été bloqués : le solde du wallet est à 0.
    seed('1', TransactionType.WITHDRAWAL, 100, 0.5);

    const settled = await withMode('fail', () => service.process('1'));

    expect(settled.transaction.status).toBe(TransactionStatus.FAILED);
    expect(balanceOf()).toBe(100.5);
    expect(calls.reversals).toBe(1);

    const event = webhook('SBX-TX-1', 'FAILED');
    const replay = await service.handleWebhook('sandbox', event.headers, event.body);

    expect(replay.alreadyProcessed).toBe(true);
    expect(balanceOf()).toBe(100.5);
    expect(calls.reversals).toBe(1);
  });

  it('un retrait réussi ne rembourse rien', async () => {
    const { service, seed, calls, balanceOf } = createFake();

    seed('1', TransactionType.WITHDRAWAL, 100, 0.5);

    const settled = await withMode('instant', () => service.process('1'));

    expect(settled.transaction.status).toBe(TransactionStatus.COMPLETED);
    expect(balanceOf()).toBe(0);
    expect(calls.reversals).toBe(0);
  });

  it('un retrait en attente puis confirmé par webhook ne rembourse rien', async () => {
    const { service, seed, calls, balanceOf } = createFake();

    seed('1', TransactionType.WITHDRAWAL, 100, 0.5);
    await withMode('async', () => service.process('1'));

    const event = webhook('SBX-TX-1', 'COMPLETED');
    await service.handleWebhook('sandbox', event.headers, event.body);

    expect(balanceOf()).toBe(0);
    expect(calls.reversals).toBe(0);
  });
});
