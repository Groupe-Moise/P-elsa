class PinRules {
  PinRules._();

  static final RegExp _sixDigits = RegExp(r'^\d{6}$');
  static final RegExp _oneDigitRepeated = RegExp(r'^(\d)\1{5}$');
  static final RegExp _pairRepeated = RegExp(r'^(\d{2})\1\1$');
  static final RegExp _tripleRepeated = RegExp(r'^(\d{3})\1$');

  /// Indique si un PIN à 6 chiffres est trop facile à deviner :
  ///
  /// - un seul chiffre répété (000000, 111111...)
  /// - une suite croissante ou décroissante (123456, 654321...)
  /// - un bloc répété (121212, 123123...)
  /// - quelques classiques (112233, 159753)
  ///
  /// Ces règles sont les mêmes que celles du serveur, qui reste
  /// l'autorité : ce contrôle sert seulement à prévenir l'utilisateur
  /// tout de suite.
  static bool isWeak(String pin) {
    if (!_sixDigits.hasMatch(pin)) {
      return false;
    }

    if (_oneDigitRepeated.hasMatch(pin)) {
      return true;
    }

    if ('0123456789'.contains(pin) || '9876543210'.contains(pin)) {
      return true;
    }

    if (_pairRepeated.hasMatch(pin) || _tripleRepeated.hasMatch(pin)) {
      return true;
    }

    return const ['112233', '159753'].contains(pin);
  }
}