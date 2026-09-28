import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  CollectInput,
  PaymentProvider,
  PayoutInput,
  ProviderResult,
  ProviderWebhookEvent,
} from '../payment-provider.interface';

/**
 * Secret de signature des webhooks simulés. À définir dans .env
 * (PAYMENT_WEBHOOK_SECRET) ; la valeur par défaut ne sert qu'au
 * développement.
 */
function webhookSecret(): string {
  return process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-sandbox-secret';
}

/**
 * Signature attendue pour un événement du fournisseur de test.
 * Exportée pour que les scripts de test puissent signer leurs
 * propres webhooks simulés.
 */
export function signSandboxEvent(
  providerReference: string,
  status: string,
): string {
  return createHmac('sha256', webhookSecret())
    .update(`${providerReference}:${status}`)
    .digest('hex');
}

/**
 * =========================================================
 * FOURNISSEUR DE TEST (SANDBOX)
 * =========================================================
 *
 * Aucun argent réel : il simule un opérateur Mobile Money.
 *
 * Trois modes, choisis par la variable PAYMENT_SANDBOX_MODE :
 *
 * - instant (par défaut) : l'opération réussit tout de suite. C'est
 *   exactement le comportement de l'application avant l'arrivée du
 *   Payment Core : rien ne change pour les écrans existants.
 * - async : l'opération reste EN ATTENTE ; le résultat arrive plus
 *   tard par webhook (comme avec un vrai opérateur).
 * - fail : l'opération est refusée.
 */
@Injectable()
export class SandboxProvider implements PaymentProvider {
  readonly name = 'sandbox';

  async collect(input: CollectInput): Promise<ProviderResult> {
    return this.simulate(input.transactionReference);
  }

  async payout(input: PayoutInput): Promise<ProviderResult> {
    return this.simulate(input.transactionReference);
  }

  async getStatus(providerReference: string): Promise<ProviderResult> {
    // Le fournisseur de test ne garde pas d'historique : une opération
    // en attente le reste tant qu'un webhook n'est pas reçu.
    return {
      status: 'PENDING',
      providerReference,
    };
  }

  parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): ProviderWebhookEvent {
    const payload = (body ?? {}) as Record<string, unknown>;

    const providerReference = payload.providerReference;
    const status = payload.status;

    if (typeof providerReference !== 'string' || providerReference === '') {
      throw new BadRequestException('providerReference manquant.');
    }

    if (status !== 'COMPLETED' && status !== 'FAILED') {
      throw new BadRequestException(
        'status invalide (COMPLETED ou FAILED attendu).',
      );
    }

    const received = headers['x-sandbox-signature'];
    const receivedSignature = Array.isArray(received)
      ? received[0]
      : received;

    const expected = signSandboxEvent(providerReference, status);

    if (
      typeof receivedSignature !== 'string' ||
      !this.sameSignature(receivedSignature, expected)
    ) {
      throw new UnauthorizedException('Signature invalide.');
    }

    return {
      providerReference,
      status,
      failureReason:
        typeof payload.failureReason === 'string'
          ? payload.failureReason
          : undefined,
    };
  }

  private simulate(transactionReference: string): ProviderResult {
    const providerReference = `SBX-${transactionReference}`;
    const mode = process.env.PAYMENT_SANDBOX_MODE ?? 'instant';

    if (mode === 'async') {
      return { status: 'PENDING', providerReference };
    }

    if (mode === 'fail') {
      return {
        status: 'FAILED',
        providerReference,
        failureReason: 'Refus simulé (mode sandbox « fail »).',
      };
    }

    return { status: 'COMPLETED', providerReference };
  }

  /**
   * Comparaison en temps constant, pour ne pas révéler la signature
   * attendue par la durée de la réponse.
   */
  private sameSignature(received: string, expected: string): boolean {
    const a = Buffer.from(received);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
  }
}
