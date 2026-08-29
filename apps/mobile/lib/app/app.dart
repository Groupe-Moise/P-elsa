import 'package:flutter/material.dart';

import 'router.dart';
import 'theme/app_theme.dart';

class PElsaApp extends StatelessWidget {
  const PElsaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'P-Elsa',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      initialRoute: AppRouter.home,
      onGenerateRoute: AppRouter.onGenerateRoute,
    );
  }
}