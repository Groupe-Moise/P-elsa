import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

import { CountryField, PhoneField } from '../../common/phone/phone-field.decorator';
import { CurrencyCodeField } from '../../common/currency/currency-code.decorator';
import { PinField } from '../../common/pin/pin.decorators';
import { AmountField } from './amount-field.decorator';
import { MOBILE_MONEY_NETWORKS } from './transaction-rules';

export class CreateWithdrawalBody {
  @AmountField()
  amount!: number;

  @IsIn(MOBILE_MONEY_NETWORKS, {
    message: 'Le réseau de paiement sélectionné est invalide.',
  })
  network!: string;

  /**
   * Numéro Mobile Money, converti automatiquement au format
   * international (ex. 097... -> +243...).
   */
  @PhoneField()
  phone!: string;

  @CountryField()
  country?: string;

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
