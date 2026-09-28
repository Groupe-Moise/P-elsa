import { CountryField, PhoneField } from '../../common/phone/phone-field.decorator';
import { PinField } from '../../common/pin/pin.decorators';

export class LoginDto {
  /**
   * Numéro saisi par l'utilisateur, converti automatiquement
   * au format international (ex. 097... -> +243...).
   */
  @PhoneField()
  phone!: string;

  /**
   * Pays du numéro (ex. CD, ZM). Facultatif : sans indicatif
   * international, la RDC est utilisée par défaut.
   */
  @CountryField()
  country?: string;

  @PinField()
  pin!: string;
}
