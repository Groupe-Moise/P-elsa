/// Pays pris en charge pour la saisie des numéros de téléphone.
///
/// Pour ajouter un pays : ajouter une constante dans [Countries],
/// puis l'inscrire dans [Countries.supported].
class Country {
  const Country({
    required this.name,
    required this.isoCode,
    required this.dialCode,
    required this.flag,
    required this.trunkPrefix,
    required this.example,
  });

  /// Nom affiché (ex. RDC).
  final String name;

  /// Code pays sur 2 lettres (ex. CD).
  final String isoCode;

  /// Indicatif international (ex. +243).
  final String dialCode;

  /// Drapeau (emoji).
  final String flag;

  /// Chiffre que les utilisateurs écrivent devant le numéro local
  /// et qui ne fait pas partie du numéro international (ex. 0).
  /// Vide si le pays n'en utilise pas.
  final String trunkPrefix;

  /// Exemple de numéro local, affiché comme indication.
  final String example;

  @override
  bool operator ==(Object other) {
    return other is Country && other.isoCode == isoCode;
  }

  @override
  int get hashCode => isoCode.hashCode;
}

class Countries {
  Countries._();

  static const Country drCongo = Country(
    name: 'RDC',
    isoCode: 'CD',
    dialCode: '+243',
    flag: '🇨🇩',
    trunkPrefix: '0',
    example: '97 123 4567',
  );

  static const Country zambia = Country(
    name: 'Zambie',
    isoCode: 'ZM',
    dialCode: '+260',
    flag: '🇿🇲',
    trunkPrefix: '0',
    example: '97 123 4567',
  );

  static const List<Country> supported = [
    drCongo,
    zambia,
  ];

  static const Country defaultCountry = drCongo;
}