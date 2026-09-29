import {
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

import { PinField } from '../../common/pin/pin.decorators';
import { RequiredCurrencyCodeField } from '../../common/currency/currency-code.decorator';
import { AmountField } from '../../transactions/dto/amount-field.decorator';

export class CreateExchangeBody {
  /**
   * Devise SOURCE : celle débitée du wallet.
   */
  @RequiredCurrencyCodeField()
  fromCurrencyCode!: string;

  /**
   * Devise CIBLE : celle créditée sur le wallet, au taux courant
   * pour cette paire (voir ExchangeRate).
   */
  @RequiredCurrencyCodeField()
  toCurrencyCode!: string;

  /**
   * Montant à convertir, exprimé dans la devise SOURCE
   * (fromCurrencyCode).
   */
  @AmountField()
  amount!: number;

  @PinField()
  pin!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, {
    message: 'La description est trop longue (200 caractères maximum).',
  })
  description?: string;

  /**
   * Clé unique générée par l'application avant chaque tentative.
   * En cas de nouvelle tentative après une coupure réseau, la même
   * clé doit être renvoyée : l'opération n'est exécutée qu'une
   * seule fois (voir IdempotencyService).
   */
  @IsOptional()
  @IsString()
  @Length(8, 100, {
    message: 'Clé d\'idempotence invalide.',
  })
  idempotencyKey?: string;
}
