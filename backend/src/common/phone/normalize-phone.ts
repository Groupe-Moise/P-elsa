import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

/**
 * Pays utilisé quand l'utilisateur saisit un numéro local
 * (sans indicatif) et que l'application n'indique pas de pays.
 *
 * CD = République démocratique du Congo (+243).
 */
export const DEFAULT_COUNTRY: CountryCode = 'CD';

/**
 * Convertit un numéro saisi par l'utilisateur au format
 * international E.164 (ex. +243977777777).
 *
 * Exemples pour la RDC (CD) :
 *
 * - 097 777 7777      -> +243977777777
 * - 97 777 7777       -> +243977777777
 * - 081 234 5678      -> +243812345678
 * - +243 97 777 7777  -> +243977777777
 *
 * Le pays sert uniquement pour les numéros sans indicatif.
 * Un numéro qui commence par + est lu tel quel.
 *
 * Retourne null si le numéro n'est pas valide.
 */
export function normalizePhone(
  input: string,
  country?: string,
): string | null {
  const cleaned = input.trim();

  if (cleaned.length === 0) {
    return null;
  }

  const countryCode =
    country && country.trim() !== ''
      ? country.trim().toUpperCase()
      : DEFAULT_COUNTRY;

  try {
    const parsed = parsePhoneNumberFromString(
      cleaned,
      countryCode as CountryCode,
    );

    if (!parsed || !parsed.isValid()) {
      return null;
    }

    return parsed.number;
  } catch {
    return null;
  }
}
