import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../database/prisma.service';

/**
 * Nombre d'échecs consécutifs avant le blocage du PIN.
 */
export const MAX_PIN_ATTEMPTS = 5;

/**
 * Durée du blocage, en minutes.
 */
export const PIN_LOCK_MINUTES = 15;

export type PinVerificationResult =
  | {
      valid: true;
    }
  | {
      valid: false;
      locked: boolean;
      message: string;
    };

/**
 * Erreur 429 : le PIN est bloqué temporairement.
 */
export class PinLockedException extends HttpException {
  constructor(minutes: number) {
    super(
      `Trop de tentatives. PIN bloqué, réessayez dans ${minutes} minute${
        minutes > 1 ? 's' : ''
      }.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * =========================================================
 * VÉRIFICATION DU PIN AVEC LIMITATION DES TENTATIVES
 * =========================================================
 *
 * Un PIN à 6 chiffres n'a que 1 000 000 de combinaisons : sans
 * limite, un attaquant peut toutes les essayer.
 *
 * Après MAX_PIN_ATTEMPTS échecs consécutifs, le PIN est bloqué
 * pendant PIN_LOCK_MINUTES minutes. Le compteur est partagé entre
 * la connexion et les opérations (dépôt, retrait, transfert) : un
 * token volé ne donne donc pas plus d'essais.
 *
 * PROTECTION CONTRE LES ESSAIS SIMULTANÉS :
 *
 * Une tentative est RÉSERVÉE dans la base (incrément atomique
 * conditionnel) AVANT de comparer le PIN. Même si 100 requêtes
 * arrivent en même temps, seules MAX_PIN_ATTEMPTS comparaisons
 * ont lieu.
 */
@Injectable()
export class PinAttemptsService {
  /**
   * Hash factice, utilisé quand le numéro n'existe pas, pour que
   * la réponse prenne le même temps que pour un vrai compte.
   */
  private readonly dummyHash = bcrypt.hashSync(
    randomBytes(16).toString('hex'),
    12,
  );

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Faux calcul de vérification (numéro inconnu).
   */
  async simulateVerification(pin: string): Promise<void> {
    await bcrypt.compare(pin, this.dummyHash);
  }

  /**
   * Vérifie le PIN d'un utilisateur.
   *
   * - Retourne { valid: true } si le PIN est correct.
   * - Retourne { valid: false, ... } si le PIN est faux.
   * - Lance une erreur 429 si le PIN est déjà bloqué.
   */
  async verify(
    userId: string,
    pin: string,
  ): Promise<PinVerificationResult> {
    /**
     * 1. Un blocage terminé est levé : le compteur repart de zéro.
     */
    await this.prisma.user.updateMany({
      where: {
        id: userId,
        pinLockedUntil: {
          lte: new Date(),
        },
      },
      data: {
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });

    /**
     * 2. Réservation atomique d'une tentative : elle n'est
     *    accordée que si le PIN n'est pas bloqué et si la limite
     *    n'est pas atteinte.
     */
    const reserved = await this.prisma.user.updateMany({
      where: {
        id: userId,
        pinLockedUntil: null,
        pinFailedAttempts: {
          lt: MAX_PIN_ATTEMPTS,
        },
      },
      data: {
        pinFailedAttempts: {
          increment: 1,
        },
      },
    });

    if (reserved.count !== 1) {
      throw await this.createLockedException(userId);
    }

    /**
     * 3. Comparaison du PIN.
     */
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        pinHash: true,
      },
    });

    const isPinValid = user?.pinHash
      ? await bcrypt.compare(pin, user.pinHash)
      : false;

    if (isPinValid) {
      await this.prisma.user.updateMany({
        where: {
          id: userId,
        },
        data: {
          pinFailedAttempts: 0,
          pinLockedUntil: null,
        },
      });

      return {
        valid: true,
      };
    }

    /**
     * 4. Échec : blocage si la limite est atteinte.
     */
    const lockedNow = await this.prisma.user.updateMany({
      where: {
        id: userId,
        pinLockedUntil: null,
        pinFailedAttempts: {
          gte: MAX_PIN_ATTEMPTS,
        },
      },
      data: {
        pinLockedUntil: new Date(
          Date.now() + PIN_LOCK_MINUTES * 60_000,
        ),
      },
    });

    if (lockedNow.count === 1) {
      return {
        valid: false,
        locked: true,
        message: this.lockedMessage(),
      };
    }

    const state = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        pinFailedAttempts: true,
      },
    });

    const attemptsLeft = Math.max(
      0,
      MAX_PIN_ATTEMPTS - (state?.pinFailedAttempts ?? MAX_PIN_ATTEMPTS),
    );

    if (attemptsLeft === 0) {
      return {
        valid: false,
        locked: true,
        message: this.lockedMessage(),
      };
    }

    return {
      valid: false,
      locked: false,
      message:
        attemptsLeft === 1
          ? 'Il vous reste 1 tentative avant le blocage du PIN.'
          : `Il vous reste ${attemptsLeft} tentatives avant le blocage du PIN.`,
    };
  }

  private lockedMessage(): string {
    return `Trop de tentatives : PIN bloqué pendant ${PIN_LOCK_MINUTES} minutes.`;
  }

  private async createLockedException(
    userId: string,
  ): Promise<HttpException> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        pinLockedUntil: true,
      },
    });

    if (!user) {
      return new UnauthorizedException('Utilisateur introuvable.');
    }

    const remainingMs = user.pinLockedUntil
      ? user.pinLockedUntil.getTime() - Date.now()
      : 0;

    const minutes =
      remainingMs > 0
        ? Math.ceil(remainingMs / 60_000)
        : PIN_LOCK_MINUTES;

    return new PinLockedException(minutes);
  }
}
