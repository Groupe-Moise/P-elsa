import { applyDecorators } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Devises actuellement prises en charge (RDC, marché de
 * lancement). À étendre au fur et à mesure de l'ajout de
 * nouveaux pays (voir le plan de projet, jalon J6).
 */
export const SUPPORTED_CURRENCY_CODES = ['USD', 'CDF'] as const;

export type SupportedCurrencyCode =
  (typeof SUPPORTED_CURRENCY_CODES)[number];

/**
 * Champ "devise" facultatif d'un DTO de dépôt, retrait ou
 * transfert. Omis, il vaut USD (comportement historique de
 * l'application, avant l'ajout du multi-devises).
 */
export function CurrencyCodeField() {
  return applyDecorators(
    IsOptional(),
    IsIn(SUPPORTED_CURRENCY_CODES, {
      message: `Devise invalide. Devises acceptées : ${SUPPORTED_CURRENCY_CODES.join(', ')}.`,
    }),
  );
}
