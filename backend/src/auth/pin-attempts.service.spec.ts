import * as bcrypt from 'bcrypt';

import type { PrismaService } from '../database/prisma.service';
import {
  MAX_PIN_ATTEMPTS,
  PinAttemptsService,
  PinLockedException,
} from './pin-attempts.service';

interface FakeUser {
  id: string;
  pinHash: string;
  pinFailedAttempts: number;
  pinLockedUntil: Date | null;
}

interface Where {
  id: string;
  pinLockedUntil?: null | { lte: Date };
  pinFailedAttempts?: { lt?: number; gte?: number };
}

interface Data {
  pinFailedAttempts?: number | { increment: number };
  pinLockedUntil?: Date | null;
}

const GOOD_PIN = '482915';
const WRONG_PIN = '906132';

/**
 * Base de données simulée : chaque opération est atomique, comme
 * une vraie requête SQL, mais les opérations de plusieurs requêtes
 * simultanées peuvent s'intercaler.
 */
function createFakePrisma(user: FakeUser) {
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  const matches = (where: Where): boolean => {
    if (where.id !== user.id) {
      return false;
    }

    if (where.pinLockedUntil === null && user.pinLockedUntil !== null) {
      return false;
    }

    if (where.pinLockedUntil) {
      if (
        user.pinLockedUntil === null ||
        user.pinLockedUntil.getTime() > where.pinLockedUntil.lte.getTime()
      ) {
        return false;
      }
    }

    const attempts = where.pinFailedAttempts;

    if (attempts?.lt !== undefined && !(user.pinFailedAttempts < attempts.lt)) {
      return false;
    }

    if (attempts?.gte !== undefined && !(user.pinFailedAttempts >= attempts.gte)) {
      return false;
    }

    return true;
  };

  return {
    user: {
      updateMany: async ({ where, data }: { where: Where; data: Data }) => {
        await tick();

        if (!matches(where)) {
          return { count: 0 };
        }

        if (typeof data.pinFailedAttempts === 'number') {
          user.pinFailedAttempts = data.pinFailedAttempts;
        } else if (data.pinFailedAttempts) {
          user.pinFailedAttempts += data.pinFailedAttempts.increment;
        }

        if (data.pinLockedUntil !== undefined) {
          user.pinLockedUntil = data.pinLockedUntil;
        }

        return { count: 1 };
      },

      findUnique: async ({ where }: { where: { id: string } }) => {
        await tick();

        return where.id === user.id ? { ...user } : null;
      },
    },
  };
}

describe('PinAttemptsService', () => {
  let user: FakeUser;
  let service: PinAttemptsService;

  beforeEach(() => {
    user = {
      id: 'user-1',
      pinHash: bcrypt.hashSync(GOOD_PIN, 4),
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    };

    service = new PinAttemptsService(
      createFakePrisma(user) as unknown as PrismaService,
    );
  });

  it('accepte le bon PIN', async () => {
    const result = await service.verify('user-1', GOOD_PIN);

    expect(result.valid).toBe(true);
    expect(user.pinFailedAttempts).toBe(0);
  });

  it('refuse un mauvais PIN et indique les tentatives restantes', async () => {
    const result = await service.verify('user-1', WRONG_PIN);

    expect(result.valid).toBe(false);
    expect(user.pinFailedAttempts).toBe(1);

    if (!result.valid) {
      expect(result.message).toContain('4 tentatives');
    }
  });

  it('remet le compteur à zéro après un succès', async () => {
    await service.verify('user-1', WRONG_PIN);
    await service.verify('user-1', WRONG_PIN);

    expect(user.pinFailedAttempts).toBe(2);

    const result = await service.verify('user-1', GOOD_PIN);

    expect(result.valid).toBe(true);
    expect(user.pinFailedAttempts).toBe(0);
  });

  it('bloque le PIN après 5 échecs, même avec le bon PIN ensuite', async () => {
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
      await service.verify('user-1', WRONG_PIN);
    }

    expect(user.pinLockedUntil).not.toBeNull();

    await expect(
      service.verify('user-1', GOOD_PIN),
    ).rejects.toBeInstanceOf(PinLockedException);
  });

  it('n\'autorise que 5 essais parmi 8 requêtes simultanées', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.verify('user-1', WRONG_PIN),
      ),
    );

    const compared = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter(
      (r) =>
        r.status === 'rejected' &&
        r.reason instanceof PinLockedException,
    );

    expect(compared.length).toBe(MAX_PIN_ATTEMPTS);
    expect(refused.length).toBe(8 - MAX_PIN_ATTEMPTS);
    expect(user.pinFailedAttempts).toBe(MAX_PIN_ATTEMPTS);
    expect(user.pinLockedUntil).not.toBeNull();
  });

  it('lève le blocage quand il est terminé', async () => {
    user.pinFailedAttempts = MAX_PIN_ATTEMPTS;
    user.pinLockedUntil = new Date(Date.now() - 1000);

    const result = await service.verify('user-1', GOOD_PIN);

    expect(result.valid).toBe(true);
    expect(user.pinFailedAttempts).toBe(0);
    expect(user.pinLockedUntil).toBeNull();
  });
});
