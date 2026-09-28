import { isWeakPin } from './is-weak-pin';

describe('isWeakPin', () => {
  it.each([
    '000000',
    '111111',
    '123456',
    '234567',
    '456789',
    '654321',
    '987654',
    '121212',
    '123123',
    '112233',
  ])('refuse le PIN trop simple %s', (pin) => {
    expect(isWeakPin(pin)).toBe(true);
  });

  it.each(['482915', '906132', '370581', '135790'])(
    'accepte le PIN %s',
    (pin) => {
      expect(isWeakPin(pin)).toBe(false);
    },
  );

  it('ne juge pas le format (géré ailleurs)', () => {
    expect(isWeakPin('abc')).toBe(false);
    expect(isWeakPin('12345')).toBe(false);
  });
});
