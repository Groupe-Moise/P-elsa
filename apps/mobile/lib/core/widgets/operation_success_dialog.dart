import 'package:flutter/material.dart';

/// Boîte de dialogue de confirmation affichée après une opération
/// réussie (dépôt, retrait, transfert).
///
/// Avant, seul le transfert avait ce traitement soigné (icône verte,
/// référence, nouveau solde) ; le dépôt et le retrait se contentaient
/// d'un simple SnackBar en texte brut. Ce widget partagé unifie les
/// trois sur le même modèle.
class OperationSuccessDialog extends StatelessWidget {
  const OperationSuccessDialog({
    super.key,
    required this.title,
    required this.message,
    this.details = const [],
    this.icon = Icons.check_circle_outline,
    this.iconColor = Colors.green,
  });

  /// Titre affiché sous l'icône (ex. 'Dépôt effectué').
  final String title;

  /// Phrase résumant l'opération
  /// (ex. '50.00 USD ont été déposés via Airtel Money.').
  final String message;

  /// Paires libellé/valeur affichées sous le message
  /// (ex. 'Référence' -> 'TX-ABC123', 'Nouveau solde' -> '\$ 120.00').
  final List<MapEntry<String, String>> details;

  /// Icône affichée en tête de la boîte de dialogue. Par défaut, une
  /// coche verte (opération réussie) ; une opération qui reste en
  /// attente (ex. retrait bloqué faute de solde marchand chez le
  /// fournisseur) peut passer une icône et une couleur différentes
  /// pour ne pas donner l'illusion d'un succès.
  final IconData icon;

  final Color iconColor;

  static Future<void> show(
    BuildContext context, {
    required String title,
    required String message,
    List<MapEntry<String, String>> details = const [],
    IconData icon = Icons.check_circle_outline,
    Color iconColor = Colors.green,
  }) {
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => OperationSuccessDialog(
        title: title,
        message: message,
        details: details,
        icon: icon,
        iconColor: iconColor,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      icon: Icon(
        icon,
        color: iconColor,
        size: 56,
      ),
      title: Text(
        title,
        textAlign: TextAlign.center,
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
          ),

          for (final entry in details) ...[
            const SizedBox(height: 16),
            Text(
              entry.key,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 4),
            SelectableText(
              entry.value,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ],
      ),
      actions: [
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: () {
              Navigator.of(context).pop();
            },
            child: const Text('Terminé'),
          ),
        ),
      ],
    );
  }
}
