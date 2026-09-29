import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';

/// Mode de paiement choisi pour un dépôt ou un retrait.
enum PaymentMode {
  mobile,
  card,
}

/// Sélecteur du mode de paiement (Mobile Money ou Carte bancaire).
///
/// Le mode « Carte » est affiché (pour que l'utilisateur sache que
/// l'option existera) mais désactivé avec un badge « Bientôt
/// disponible » tant que le backend ne prend pas en charge les
/// paiements par carte.
class PaymentModeSelector extends StatelessWidget {
  const PaymentModeSelector({
    super.key,
    required this.selectedMode,
    required this.onChanged,
  });

  final PaymentMode selectedMode;
  final ValueChanged<PaymentMode> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _ModeOption(
            icon: Icons.phone_android_outlined,
            label: 'Mobile',
            isSelected: selectedMode == PaymentMode.mobile,
            onTap: () => onChanged(PaymentMode.mobile),
          ),
        ),

        const SizedBox(width: 12),

        const Expanded(
          child: _ModeOption(
            icon: Icons.credit_card_outlined,
            label: 'Carte',
            badge: 'Bientôt disponible',
            isSelected: false,
            onTap: null,
          ),
        ),
      ],
    );
  }
}

class _ModeOption extends StatelessWidget {
  const _ModeOption({
    required this.icon,
    required this.label,
    required this.isSelected,
    required this.onTap,
    this.badge,
  });

  final IconData icon;
  final String label;
  final bool isSelected;
  final VoidCallback? onTap;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final isDisabled = onTap == null;

    final foregroundColor = isDisabled
        ? AppColors.textTertiary
        : (isSelected
        ? AppColors.onPrimaryContainer
        : AppColors.textSecondary);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(
          vertical: 16,
          horizontal: 12,
        ),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          color: isSelected
              ? AppColors.primaryContainer
              : AppColors.surfaceVariant,
          border: Border.all(
            color: isSelected
                ? AppColors.primary
                : Colors.transparent,
            width: 1.5,
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              color: foregroundColor,
            ),

            const SizedBox(height: 6),

            Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: foregroundColor,
              ),
            ),

            if (badge != null) ...[
              const SizedBox(height: 4),
              Text(
                badge!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 10,
                  color: AppColors.textTertiary,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
