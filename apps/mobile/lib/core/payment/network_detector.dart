/// Détection automatique de l'opérateur mobile à partir des trois
/// premiers chiffres d'un numéro de téléphone (RDC).
///
/// La liste des préfixes est actuellement codée en dur ici. Le
/// souhait à terme est de permettre à l'administrateur de gérer ces
/// préfixes depuis un back-office plutôt que de les modifier dans le
/// code de l'application ; ce fichier centralise déjà toute la
/// logique de détection pour que ce changement (lire les préfixes
/// depuis une API au lieu de cette constante) reste localisé ici le
/// jour où le back-office existera.
class NetworkDetector {
  NetworkDetector._();

  /// Préfixes connus par réseau (à faire évoluer via un back-office
  /// plus tard).
  static const Map<String, List<String>> _prefixesByNetwork = {
    'M-Pesa': ['081', '082', '083'],
    'Airtel Money': ['099', '097', '098', '096'],
    'Orange Money': ['080', '084', '085'],
  };

  /// Liste des réseaux gérés, dans l'ordre où ils doivent être
  /// présentés (ex. dans un texte d'aide listant les réseaux
  /// supportés).
  static const List<String> networks = [
    'Airtel Money',
    'M-Pesa',
    'Orange Money',
  ];

  /// Détecte le réseau mobile correspondant à `phone`, ou `null` si
  /// aucun préfixe connu ne correspond (numéro trop court, préfixe
  /// non reconnu, etc.).
  ///
  /// Accepte les numéros avec ou sans indicatif international
  /// (+243/243), avec ou sans espaces/tirets.
  static String? detectFromPhone(String phone) {
    final normalized = _normalize(phone);

    if (normalized.length < 3) {
      return null;
    }

    final prefix = normalized.substring(0, 3);

    for (final entry in _prefixesByNetwork.entries) {
      if (entry.value.contains(prefix)) {
        return entry.key;
      }
    }

    return null;
  }

  /// Ne garde que les chiffres, puis retire l'indicatif international
  /// (+243 ou 243) pour ne conserver que le numéro local commençant
  /// par le préfixe réseau (ex. « 081xxxxxxx »).
  static String _normalize(String phone) {
    var digits = phone.replaceAll(RegExp(r'[^0-9]'), '');

    if (digits.startsWith('243')) {
      digits = digits.substring(3);
    }

    if (digits.isNotEmpty && !digits.startsWith('0')) {
      digits = '0$digits';
    }

    return digits;
  }
}
