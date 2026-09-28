import { normalizePhone } from './normalize-phone';

describe('normalizePhone', () => {
  it.each([
    '+243977777777',
    '+243 97 777 7777',
    '0977777777',
    '097 777 7777',
    '977777777',
    '97 777 7777',
  ])('convertit %s (RDC) en +243977777777', (input) => {
    expect(normalizePhone(input)).toBe('+243977777777');
  });

  it('convertit un numéro de la RDC qui commence par 81', () => {
    expect(normalizePhone('081 234 5678')).toBe('+243812345678');
  });

  it('accepte un numéro d’un autre pays avec indicatif', () => {
    expect(normalizePhone('+260977123456')).toBe('+260977123456');
  });

  it('utilise le pays indiqué pour un numéro local', () => {
    expect(normalizePhone('0977123456', 'ZM')).toBe('+260977123456');
  });

  it('accepte le pays en minuscules', () => {
    expect(normalizePhone('0977123456', 'zm')).toBe('+260977123456');
  });

  it.each(['', '   ', '123', 'abc', '+243', '0000'])(
    'refuse le numéro invalide %p',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );

  it('refuse un code pays inconnu', () => {
    expect(normalizePhone('0977123456', 'XX')).toBeNull();
  });
});
