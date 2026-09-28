import { CountryField, PhoneField } from '../../common/phone/phone-field.decorator';

export class FindRecipientQuery {
  /**
   * Numéro du bénéficiaire, converti automatiquement au format
   * international (ex. 097... -> +243...).
   */
  @PhoneField()
  phone!: string;

  @CountryField()
  country?: string;
}
