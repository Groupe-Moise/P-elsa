import { applyDecorators } from '@nestjs/common';
import { IsNumber, IsPositive, Max } from 'class-validator';

import { MAX_TRANSACTION_AMOUNT } from './transaction-rules';

/**
 * Champ "montant" : nombre positif, 2 décimales maximum,
 * sous le plafond technique.
 */
export function AmountField() {
  return applyDecorators(
    IsNumber(
      {
        allowNaN: false,
        allowInfinity: false,
        maxDecimalPlaces: 2,
      },
      {
        message: 'Montant invalide (2 décimales maximum).',
      },
    ),
    IsPositive({
      message: 'Le montant doit être supérieur à zéro.',
    }),
    Max(MAX_TRANSACTION_AMOUNT, {
      message: 'Le montant dépasse la limite autorisée.',
    }),
  );
}
