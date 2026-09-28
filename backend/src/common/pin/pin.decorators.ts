import { applyDecorators } from '@nestjs/common';
import {
  IsString,
  Matches,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

import { isWeakPin } from './is-weak-pin';

/**
 * Champ "PIN" : exactement 6 chiffres.
 */
export function PinField() {
  return applyDecorators(
    IsString({
      message: 'Le PIN est obligatoire.',
    }),
    Matches(/^\d{6}$/, {
      message: 'Le PIN doit contenir exactement 6 chiffres.',
    }),
  );
}

/**
 * Refuse les PIN trop simples (000000, 123456...).
 *
 * À utiliser uniquement quand l'utilisateur CHOISIT son PIN
 * (inscription). Surtout pas à la connexion : les comptes
 * existants doivent pouvoir se connecter.
 */
export function IsNotWeakPin(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotWeakPin',
      target: object.constructor,
      propertyName,
      options: {
        message:
          'Ce PIN est trop simple. Évitez les suites (123456) et les chiffres répétés (000000).',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && !isWeakPin(value);
        },
      },
    });
  };
}
