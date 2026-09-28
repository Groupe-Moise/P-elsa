/**
 * Indique si un PIN à 6 chiffres est trop facile à deviner :
 *
 * - un seul chiffre répété (000000, 111111...)
 * - une suite croissante ou décroissante (123456, 654321...)
 * - un bloc répété (121212, 123123...)
 * - quelques classiques (112233, 159753)
 *
 * Le format (6 chiffres) est vérifié ailleurs : une valeur qui
 * n'a pas 6 chiffres n'est pas considérée comme "faible" ici.
 */
export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) {
    return false;
  }

  if (/^(\d)\1{5}$/.test(pin)) {
    return true;
  }

  if (
    '0123456789'.includes(pin) ||
    '9876543210'.includes(pin)
  ) {
    return true;
  }

  if (
    /^(\d{2})\1\1$/.test(pin) ||
    /^(\d{3})\1$/.test(pin)
  ) {
    return true;
  }

  return ['112233', '159753'].includes(pin);
}
