import {
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

import { PinField } from '../../common/pin/pin.decorators';
import { CurrencyCodeField } from '../../common/currency/currency-code.decorator';
import { AmountField } from './amount-field.decorator';

export class CreatePaymentBody {
  /**
   * Code marchand du vendeur, affiché en clair ou scanné via QR code
   * (voir TransactionsService.findPaymentRecipient).
   */
  @IsString()
  @Length(4, 32, {
    message: 'Le code marchand est invalide.',
  })
  merchantCode!: string;

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

  /**
   * Devise de l'opération (ex. USD, CDF). Facultatif : USD par
   * défaut, pour ne rien changer au comportement historique de
   * l'application tant qu'elle n'envoie pas ce champ.
   */
  @CurrencyCodeField()
  currencyCode?: string;
}
