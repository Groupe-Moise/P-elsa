import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

import { normalizePhone } from './normalize-phone';

/**
 * Champ "numéro de téléphone" d'un DTO.
 *
 * Le numéro est converti automatiquement au format international
 * (ex. 097 777 7777 -> +243977777777), en utilisant le champ
 * facultatif "country" du même DTO (RDC par défaut).
 *
 * Un numéro invalide devient une chaîne vide, ce qui déclenche
 * l'erreur de validation ci-dessous.
 */
export function PhoneField() {
  return applyDecorators(
    Transform(({ value, obj }) => {
      if (typeof value !== 'string') {
        return value;
      }

      const rawCountry = (obj as { country?: unknown }).country;

      const country =
        typeof rawCountry === 'string' ? rawCountry : undefined;

      return normalizePhone(value, country) ?? '';
    }),
    IsString({
      message: 'Le numéro de téléphone est obligatoire.',
    }),
    IsNotEmpty({
      message: 'Numéro de téléphone invalide pour ce pays.',
    }),
  );
}

/**
 * Champ facultatif "country" : code pays sur 2 lettres (ex. CD, ZM).
 */
export function CountryField() {
  return applyDecorators(
    Transform(({ value }) => {
      if (typeof value !== 'string') {
        return value;
      }

      const country = value.trim().toUpperCase();

      return country === '' ? undefined : country;
    }),
    IsOptional(),
    IsISO31661Alpha2({
      message: 'Code pays invalide (ex. CD, ZM).',
    }),
  );
}
