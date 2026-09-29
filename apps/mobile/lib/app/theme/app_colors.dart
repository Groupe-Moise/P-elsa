import 'package:flutter/material.dart';

class AppColors {
  AppColors._();

  static const Color primary = Color(0xFFD32F2F);
  static const Color primaryDark = Color(0xFFB71C1C);
  static const Color primaryLight = Color(0xFFEF5350);

  // Teinte très claire de la couleur de marque, utilisée pour les
  // fonds d'icônes, badges et zones d'information (au lieu de
  // recalculer `primary.withValues(alpha: ...)` à chaque écran).
  static const Color primaryContainer = Color(0xFFFDECEA);
  static const Color onPrimaryContainer = Color(0xFFB71C1C);

  static const Color background = Color(0xFFF7F7F7);
  static const Color surface = Colors.white;
  static const Color surfaceVariant = Color(0xFFF1F1F1);

  static const Color textPrimary = Color(0xFF212121);
  static const Color textSecondary = Color(0xFF757575);
  static const Color textTertiary = Color(0xFF9E9E9E);

  static const Color border = Color(0xFFE0E0E0);
  static const Color divider = Color(0xFFEEEEEE);

  static const Color success = Color(0xFF2E7D32);
  static const Color successContainer = Color(0xFFE8F5E9);

  static const Color warning = Color(0xFFF9A825);
  static const Color warningContainer = Color(0xFFFFF8E1);

  static const Color error = Color(0xFFC62828);
  static const Color errorContainer = Color(0xFFFDEAEA);

  // Ombre douce utilisée sur les éléments qu'on veut faire ressortir
  // (ex. la carte de solde), en complément des cartes bordées "plates".
  static const Color shadow = Color(0x1F000000);
}
