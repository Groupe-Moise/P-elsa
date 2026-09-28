import {
  ConflictException,
  Injectable,
} from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { IdempotencyStatus } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';

/**
 * Résultat d'une nouvelle tentative avec une clé déjà connue :
 * la réponse d'origine, à renvoyer telle quelle.
 */
export interface IdempotencyReplay {
  replay: true;
  response: unknown;
}

/**
 * Résultat d'une première tentative : l'opération peut s'exécuter.
 * reservationId est null quand aucune clé n'a été fournie (ancienne
 * version de l'application) ; dans ce cas complete() et release()
 * ne font rien.
 */
export interface IdempotencyProceed {
  replay: false;
  reservationId: string | null;
}

export type IdempotencyOutcome =
  | IdempotencyReplay
  | IdempotencyProceed;

/**
 * =========================================================
 * PROTECTION CONTRE LES DOUBLONS (IDEMPOTENCE)
 * =========================================================
 *
 * Si le réseau coupe après qu'une opération a réussi côté
 * serveur mais avant que la réponse arrive à l'application,
 * l'utilisateur peut relancer la même opération. Sans cette
 * protection, elle serait exécutée deux fois.
 *
 * Le client génère une clé unique avant chaque tentative
 * (par exemple un UUID) et la renvoie à l'identique s'il
 * réessaie. Le serveur :
 *
 * 1. Réserve la clé de façon atomique (contrainte unique en
 *    base) avant d'exécuter quoi que ce soit.
 * 2. Si la réservation échoue parce que la clé existe déjà :
 *    - la clé est déjà COMPLETED -> on renvoie la réponse
 *      stockée, sans rien exécuter à nouveau ;
 *    - la clé est encore PENDING -> une autre requête avec
 *      cette même clé est en cours de traitement (429).
 * 3. Après l'opération, la réservation est marquée COMPLETED
 *    avec le résultat, ou supprimée si l'opération échoue
 *    (pour permettre de réessayer avec la même clé).
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async begin(
    userId: string,
    key: string | undefined,
  ): Promise<IdempotencyOutcome> {
    if (!key) {
      return {
        replay: false,
        reservationId: null,
      };
    }

    try {
      const reservation =
        await this.prisma.idempotencyKey.create({
          data: {
            userId,
            key,
          },
        });

      return {
        replay: false,
        reservationId: reservation.id,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.resolveExisting(userId, key);
      }

      throw error;
    }
  }

  async complete(
    reservationId: string | null,
    response: unknown,
  ): Promise<void> {
    if (!reservationId) {
      return;
    }

    await this.prisma.idempotencyKey.update({
      where: {
        id: reservationId,
      },
      data: {
        status: IdempotencyStatus.COMPLETED,
        response: response as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * À appeler quand l'opération échoue (exception métier ou
   * technique) : la réservation est supprimée pour que le
   * client puisse réessayer avec la même clé.
   */
  async release(
    reservationId: string | null,
  ): Promise<void> {
    if (!reservationId) {
      return;
    }

    await this.prisma.idempotencyKey.deleteMany({
      where: {
        id: reservationId,
      },
    });
  }

  private async resolveExisting(
    userId: string,
    key: string,
  ): Promise<IdempotencyOutcome> {
    const existing =
      await this.prisma.idempotencyKey.findUnique({
        where: {
          userId_key: {
            userId,
            key,
          },
        },
      });

    if (existing?.status === IdempotencyStatus.COMPLETED) {
      return {
        replay: true,
        response: existing.response,
      };
    }

    throw new ConflictException(
      'Cette opération est déjà en cours de traitement.',
    );
  }
}
