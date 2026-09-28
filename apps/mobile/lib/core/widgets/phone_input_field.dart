import 'package:flutter/material.dart';

import '../phone/country.dart';
import '../phone/phone_formatter.dart';

/// Champ de saisie d'un numéro de téléphone avec choix du pays.
///
/// L'utilisateur choisit son pays puis écrit son numéro local
/// (ex. 97 123 4567). Le numéro international est obtenu avec
/// [PhoneFormatter.toInternational].
class PhoneInputField extends StatelessWidget {
  const PhoneInputField({
    super.key,
    required this.controller,
    required this.country,
    required this.onCountryChanged,
    this.enabled = true,
    this.labelText = 'Numéro de téléphone',
    this.emptyMessage = 'Veuillez saisir votre numéro.',
    this.textInputAction = TextInputAction.next,
  });

  final TextEditingController controller;
  final Country country;
  final ValueChanged<Country> onCountryChanged;
  final bool enabled;
  final String labelText;
  final String emptyMessage;
  final TextInputAction textInputAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 132,
          child: DropdownButtonFormField<Country>(
            initialValue: country,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Pays',
              helperText: country.name,
              border: const OutlineInputBorder(),
            ),
            items: [
              for (final item in Countries.supported)
                DropdownMenuItem<Country>(
                  value: item,
                  child: Text(
                    '${item.flag} ${item.dialCode}',
                  ),
                ),
            ],
            onChanged: enabled
                ? (value) {
              if (value == null) {
                return;
              }

              onCountryChanged(value);
            }
                : null,
          ),
        ),

        const SizedBox(width: 12),

        Expanded(
          child: TextFormField(
            controller: controller,
            enabled: enabled,
            keyboardType: TextInputType.phone,
            textInputAction: textInputAction,
            decoration: InputDecoration(
              labelText: labelText,
              hintText: country.example,
              prefixIcon: const Icon(Icons.phone_outlined),
              border: const OutlineInputBorder(),
            ),
            validator: (value) {
              final input = value?.trim() ?? '';

              if (input.isEmpty) {
                return emptyMessage;
              }

              if (!PhoneFormatter.isPlausible(input)) {
                return 'Veuillez saisir un numéro valide.';
              }

              return null;
            },
          ),
        ),
      ],
    );
  }
}