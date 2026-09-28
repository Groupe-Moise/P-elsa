import { Transform } from 'class-transformer';

/**
 * Supprime les espaces au début et à la fin d'un texte.
 */
export const Trimmed = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * Transforme un texte vide en "absent" (undefined), pour qu'un champ
 * facultatif laissé vide par l'application ne soit pas validé.
 */
export const EmptyToUndefined = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();

    return trimmed === '' ? undefined : trimmed;
  });
