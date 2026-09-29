import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../currency/currency_formatter.dart';

/// Petit sélecteur de devise à deux options (USD / CDF), pensé pour
/// être inséré comme `suffix` d'un champ de montant plutôt que comme
/// un menu déroulant séparé — l'utilisateur choisit sa devise sans
/// quitter le champ où il saisit déjà le montant.
class CurrencyToggle extends StatelessWidget {
  const CurrencyToggle({
    super.key,
    required this.selectedCurrencyCode,
    required this.onChanged,
    this.enabled = true,
  });

  final String selectedCurrencyCode;
  final ValueChanged<String> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final currency in CurrencyFormatter.selectableCurrencies)
            _buildOption(context, currency.key),
        ],
      ),
    );
  }

  Widget _buildOption(BuildContext context, String currencyCode) {
    final isSelected = currencyCode == selectedCurrencyCode;

    return InkWell(
      onTap: enabled && !isSelected
          ? () => onChanged(currencyCode)
          : null,
      borderRadius: BorderRadius.circular(6),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(
          horizontal: 10,
          vertical: 6,
        ),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          currencyCode,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: isSelected
                ? Colors.white
                : (enabled
                ? AppColors.textSecondary
                : AppColors.textTertiary),
          ),
        ),
      ),
    );
  }
}
