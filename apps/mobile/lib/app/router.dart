import 'package:flutter/material.dart';

class AppRouter {
  AppRouter._();

  static const String home = '/';

  static Route<dynamic> onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
      case home:
        return MaterialPageRoute(
          builder: (_) => const _InitialPage(),
          settings: settings,
        );

      default:
        return MaterialPageRoute(
          builder: (_) => const _InitialPage(),
          settings: settings,
        );
    }
  }
}

class _InitialPage extends StatelessWidget {
  const _InitialPage();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Text('P-Elsa'),
      ),
    );
  }
}