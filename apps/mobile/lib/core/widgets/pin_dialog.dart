import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Boîte de dialogue de confirmation par PIN.
///
/// Auparavant, ce dialogue existait en 3 versions quasi identiques
/// (dans deposit_page.dart, withdrawal_page.dart et
/// transfer_page.dart), avec de petites divergences (formatage des
/// chiffres, texte de confidentialité présent ou non...). Ce widget
/// unique les remplace toutes les trois.
class PinDialog extends StatefulWidget {
  const PinDialog({
    super.key,
    required this.title,
    this.description,
  });

  /// Titre affiché en haut de la boîte de dialogue
  /// (ex. 'Confirmer le dépôt').
  final String title;

  /// Texte optionnel affiché au-dessus du champ PIN, par exemple
  /// pour rappeler le montant de l'opération en cours.
  final String? description;

  /// Ouvre la boîte de dialogue PIN et renvoie le code saisi, ou
  /// `null` si l'utilisateur annule.
  static Future<String?> show(
    BuildContext context, {
    required String title,
    String? description,
  }) {
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (_) => PinDialog(
        title: title,
        description: description,
      ),
    );
  }

  @override
  State<PinDialog> createState() => _PinDialogState();
}

class _PinDialogState extends State<PinDialog> {
  final _formKey = GlobalKey<FormState>();
  final _pinController = TextEditingController();

  bool _isObscured = true;
  bool _isClosing = false;

  @override
  void dispose() {
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_isClosing) {
      return;
    }

    if (!_formKey.currentState!.validate()) {
      return;
    }

    final pin = _pinController.text.trim();

    setState(() {
      _isClosing = true;
    });

    FocusScope.of(context).unfocus();

    await Future<void>.delayed(
      const Duration(milliseconds: 100),
    );

    if (!mounted) {
      return;
    }

    Navigator.of(context).pop(pin);
  }

  void _cancel() {
    if (_isClosing) {
      return;
    }

    FocusScope.of(context).unfocus();
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.description != null) ...[
              Text(widget.description!),
              const SizedBox(height: 20),
            ],
            TextFormField(
              controller: _pinController,
              autofocus: true,
              obscureText: _isObscured,
              enabled: !_isClosing,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              maxLength: 6,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
              ],
              onFieldSubmitted: (_) {
                if (!_isClosing) {
                  _confirm();
                }
              },
              decoration: InputDecoration(
                labelText: 'PIN',
                hintText: '••••••',
                prefixIcon: const Icon(
                  Icons.lock_outline,
                ),
                suffixIcon: IconButton(
                  onPressed: _isClosing
                      ? null
                      : () {
                    setState(() {
                      _isObscured = !_isObscured;
                    });
                  },
                  icon: Icon(
                    _isObscured
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                ),
                border: const OutlineInputBorder(),
                counterText: '',
              ),
              validator: (value) {
                final pin = value?.trim() ?? '';

                if (pin.isEmpty) {
                  return 'Veuillez saisir votre PIN.';
                }

                if (!RegExp(r'^\d{6}$').hasMatch(pin)) {
                  return 'Le PIN doit contenir 6 chiffres.';
                }

                return null;
              },
            ),
            const SizedBox(height: 4),
            Text(
              'Votre PIN reste confidentiel et n’est jamais affiché.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isClosing ? null : _cancel,
          child: const Text('Annuler'),
        ),
        ElevatedButton(
          onPressed: _isClosing ? null : _confirm,
          child: const Text('Confirmer'),
        ),
      ],
    );
  }
}
