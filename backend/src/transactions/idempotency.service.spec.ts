import { ConflictException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { IdempotencyService } from './idempotency.service';

interface FakeRow {
  id: string;
  userId: string;
  key: string;
  status: 'PENDING' | 'COMPLETED';
  response: unknown;
}

/**
 * Base de données simulée avec la même contrainte unique
 * (userId, key) que le vrai schéma.
 */
function createFakePrisma() {
  const rows: FakeRow[] = [];
  let nextId = 1;

  return {
    prisma: {
      idempotencyKey: {
        create: async ({ data }: { data: { userId: string; key: string } }) => {
          if (rows.some((r) => r.userId === data.userId && r.key === data.key)) {
            throw new Prisma.PrismaClientKnownRequestError(
              'Unique constraint failed',
              { code: 'P2002', clientVersion: 'test' },
            );
          }

          const row: FakeRow = {
            id: `row-${nextId++}`,
            userId: data.userId,
            key: data.key,
            status: 'PENDING',
            response: null,
          };

          rows.push(row);

          return row;
        },

        findUnique: async ({
          where,
        }: {
          where: { userId_key: { userId: string; key: string } };
        }) => {
          const { userId, key } = where.userId_key;

          return (
            rows.find((r) => r.userId === userId && r.key === key) ?? null
          );
        },

        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { status: 'COMPLETED'; response: unknown };
        }) => {
          const row = rows.find((r) => r.id === where.id);

          if (row) {
            row.status = data.status;
            row.response = data.response;
          }

          return row;
        },

        deleteMany: async ({ where }: { where: { id: string } }) => {
          const index = rows.findIndex((r) => r.id === where.id);

          if (index !== -1) {
            rows.splice(index, 1);
          }
        },
      },
    },
    rows,
  };
}

describe('IdempotencyService', () => {
  it('exécute une opération sans clé sans jamais toucher la base', async () => {
    const { prisma } = createFakePrisma();
    const service = new IdempotencyService(prisma as never);

    const outcome = await service.begin('user-1', undefined);

    expect(outcome).toEqual({ replay: false, reservationId: null });

    // ne doit rien lever, même sans réservation
    await service.complete(null, { ok: true });
    await service.release(null);
  });

  it('exécute une première tentative puis rejoue la même réponse', async () => {
    const { prisma } = createFakePrisma();
    const service = new IdempotencyService(prisma as never);

    const first = await service.begin('user-1', 'key-A');
    expect(first.replay).toBe(false);

    if (first.replay) {
      throw new Error('unreachable');
    }

    await service.complete(first.reservationId, { balance: 42 });

    const retry = await service.begin('user-1', 'key-A');

    expect(retry).toEqual({
      replay: true,
      response: { balance: 42 },
    });
  });

  it('permet de réessayer après un échec (réservation relâchée)', async () => {
    const { prisma } = createFakePrisma();
    const service = new IdempotencyService(prisma as never);

    const first = await service.begin('user-1', 'key-B');

    if (first.replay) {
      throw new Error('unreachable');
    }

    await service.release(first.reservationId);

    const retry = await service.begin('user-1', 'key-B');

    expect(retry.replay).toBe(false);
  });

  it('refuse une deuxième tentative concurrente avant la fin de la première', async () => {
    const { prisma } = createFakePrisma();
    const service = new IdempotencyService(prisma as never);

    await service.begin('user-1', 'key-C');

    await expect(
      service.begin('user-1', 'key-C'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('isole les clés par utilisateur', async () => {
    const { prisma } = createFakePrisma();
    const service = new IdempotencyService(prisma as never);

    const first = await service.begin('user-1', 'key-D');

    if (first.replay) {
      throw new Error('unreachable');
    }

    await service.complete(first.reservationId, { ok: 1 });

    const otherUser = await service.begin('user-2', 'key-D');

    expect(otherUser.replay).toBe(false);
  });
});
