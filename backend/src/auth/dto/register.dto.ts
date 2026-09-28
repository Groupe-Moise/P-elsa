import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

import { CountryField, PhoneField } from '../../common/phone/phone-field.decorator';
import { IsNotWeakPin, PinField } from '../../common/pin/pin.decorators';
import { EmptyToUndefined, Trimmed } from '../../common/text/text-transforms';

export class RegisterDto {
  @PhoneField()
  phone!: string;

  @CountryField()
  country?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  @MaxLength(254, { message: 'Adresse e-mail trop longue.' })
  email?: string;

  @Trimmed()
  @IsString({ message: 'Le prénom est obligatoire.' })
  @Length(1, 60, {
    message: 'Le prénom est obligatoire (60 caractères maximum).',
  })
  firstName!: string;

  @Trimmed()
  @IsString({ message: 'Le nom est obligatoire.' })
  @Length(1, 60, {
    message: 'Le nom est obligatoire (60 caractères maximum).',
  })
  lastName!: string;

  @PinField()
  @IsNotWeakPin()
  pin!: string;
}
