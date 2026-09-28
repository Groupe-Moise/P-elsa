import 'country.dart';

class PhoneFormatter {
  PhoneFormatter._();

  static final RegExp _separators = RegExp(r'[\s\-\.\(\)]');

  static final RegExp _allowedCharacters = RegExp(
    r'^[0-9+\s\-\.\(\)]+$',
  );

  static final RegExp _nonDigits = RegExp(r'[^0-9]');

  /// Contrôle léger fait dans l'application (caractères autorisés
  /// et nombre de chiffres). La validation complète est faite par
  /// le serveur, pays par pays.
  static bool isPlausible(String input) {
    final value = input.trim();

    if (!_allowedCharacters.hasMatch(value)) {
      return false;
    }

    final digits = value.replaceAll(_nonDigits, '');

    return digits.length >= 6 && digits.length <= 15;
  }

  /// Convertit ce que l'utilisateur a saisi en numéro international.
  ///
  /// Exemples pour la RDC (+243) :
  ///
  /// - 97 777 7777      -> +243977777777
  /// - 0977777777       -> +243977777777
  /// - 243977777777     -> +243977777777
  /// - +243977777777    -> +243977777777
  ///
  /// Un numéro qui commence par + (ou 00) est conservé tel quel :
  /// cela permet de saisir le numéro d'un autre pays.
  static String toInternational(
    Country country,
    String input,
  ) {
    var value = input.trim().replaceAll(_separators, '');

    if (value.startsWith('+')) {
      return value;
    }

    if (value.startsWith('00')) {
      return '+${value.substring(2)}';
    }

    // Indicatif saisi sans le + (ex. 243977777777). Un numéro local
    // fait au plus 10 chiffres : au-delà, l'indicatif est déjà là.
    final dialDigits = country.dialCode.substring(1);

    if (value.startsWith(dialDigits) &&
        value.length >= dialDigits.length + 9) {
      return '+$value';
    }

    if (country.trunkPrefix.isNotEmpty &&
        value.startsWith(country.trunkPrefix)) {
      value = value.substring(country.trunkPrefix.length);
    }

    return '${country.dialCode}$value';
  }
}