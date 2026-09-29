/// Utilitaires de formatage monétaire partagés entre les écrans.
///
/// Avant, la même logique (code de devise, symbole, montant à 2
/// décimales) était réécrite séparément dans wallet_page.dart,
/// transfer_page.dart et transaction_history_page.dart. Ce fichier
/// centralise cette logique pour éviter les divergences futures.
class CurrencyFormatter {
  CurrencyFormatter._();

  static const Map<String, String> _symbols = {
    'USD': '\$',
    'CDF': 'FC',
    'ZMW': 'ZK',
    'XAF': 'FCFA',
  };

  /// Devises actuellement proposées à la sélection dans les
  /// formulaires (dépôt, retrait...), dans l'ordre d'affichage.
  /// Doit rester synchronisé avec SUPPORTED_CURRENCY_CODES côté
  /// backend (backend/src/common/currency/currency-code.decorator.ts).
  static const List<MapEntry<String, String>> selectableCurrencies = [
    MapEntry('USD', 'Dollar américain'),
    MapEntry('CDF', 'Franc congolais'),
  ];

  /// Symbole d'affichage pour un code de devise (ex. 'USD' -> '\$').
  /// Si le code n'est pas reconnu, il est renvoyé tel quel.
  static String symbolFor(String currencyCode) {
    return _symbols[currencyCode] ?? currencyCode;
  }

  /// Libellé compact pour un montant : le symbole ('\$') pour l'USD,
  /// le code de la devise (ex. 'CDF') pour les autres, afin d'éviter
  /// d'afficher un symbole peu clair (ex. 'FC') à côté du code déjà
  /// affiché ailleurs.
  static String compactLabel(String currencyCode) {
    return currencyCode == 'USD' ? symbolFor(currencyCode) : currencyCode;
  }

  /// Extrait le code de devise (ex. 'USD') d'un wallet au format
  /// renvoyé par l'API : { ..., 'currency': { 'code': 'USD', ... } }.
  static String codeFromWallet(Map<String, dynamic>? wallet) {
    final currency = wallet?['currency'];

    if (currency is Map<String, dynamic>) {
      final code = currency['code'];

      if (code is String && code.isNotEmpty) {
        return code;
      }
    }

    return 'USD';
  }

  /// Extrait le code de devise (ex. 'CDF') d'une transaction telle que
  /// renvoyée par `/transactions/me` (voir `findByUserId` côté
  /// backend, qui inclut la relation `currency` de la transaction).
  ///
  /// Un wallet peut détenir plusieurs devises à la fois (voir
  /// WalletBalance) : contrairement à `codeFromWallet`, il ne faut
  /// donc PAS lire la devise depuis `senderWallet`/`receiverWallet`
  /// (qui n'ont pas de champ `currency` propre) mais depuis la
  /// relation `currency` de la transaction elle-même, qui est celle
  /// réellement utilisée pour cette opération précise.
  ///
  /// Ne retombe sur 'USD' que pour les rares transactions créées
  /// avant l'ajout du multi-devises (`currencyId` alors vide, voir
  /// le commentaire sur ce champ côté schéma Prisma).
  static String codeFromTransaction(Map<String, dynamic>? transaction) {
    final currency = transaction?['currency'];

    if (currency is Map<String, dynamic>) {
      final code = currency['code'];

      if (code is String && code.isNotEmpty) {
        return code;
      }
    }

    return 'USD';
  }

  /// Extrait le nom complet de la devise (ex. 'Dollar américain')
  /// d'un wallet. Retombe sur le code si le nom est absent.
  static String nameFromWallet(Map<String, dynamic>? wallet) {
    final currency = wallet?['currency'];

    if (currency is Map<String, dynamic>) {
      final name = currency['name'];

      if (name is String && name.isNotEmpty) {
        return name;
      }
    }

    return codeFromWallet(wallet);
  }

  /// Convertit une valeur dynamique (String, num, null...) venant de
  /// l'API en double, avec 0 comme valeur de repli.
  static double parseAmount(dynamic value) {
    if (value == null) {
      return 0;
    }

    return double.tryParse(value.toString()) ?? 0;
  }

  /// Formate un montant (dynamique ou double) avec 2 décimales.
  static String formatAmount(dynamic value) {
    return parseAmount(value).toStringAsFixed(2);
  }
}
