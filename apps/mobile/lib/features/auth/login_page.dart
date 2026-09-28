import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/phone/country.dart';
import '../../core/phone/phone_formatter.dart';
import '../../core/widgets/phone_input_field.dart';
import 'auth_service.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
  });

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();

  // Valeurs de test pré-remplies UNIQUEMENT en mode debug :
  // une version publiée démarre avec des champs vides.
  final _phoneController = TextEditingController(
    text: kDebugMode ? '0998288462' : '',
  );

  final _pinController = TextEditingController(
    text: kDebugMode ? '123456' : '',
  );

  Country _country = Countries.defaultCountry;

  final _authService = AuthService();

  bool _isLoading = false;
  bool _obscurePin = true;

  @override
  void dispose() {
    _phoneController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      _isLoading = true;
    });

    try {
      await _authService.login(
        phone: PhoneFormatter.toInternational(
          _country,
          _phoneController.text,
        ),
        pin: _pinController.text.trim(),
      );

      if (!mounted) {
        return;
      }

      Navigator.of(context).pushReplacementNamed('/wallet');
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      _showError(error.message);
    } on AuthException catch (error) {
      if (!mounted) {
        return;
      }

      _showError(error.message);
    } catch (_) {
      if (!mounted) {
        return;
      }

      _showError(
        'Impossible de contacter le serveur P-Elsa.',
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 420,
              ),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 32),

                    Text(
                      'P-Elsa',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),

                    const SizedBox(height: 8),

                    Text(
                      'Votre portefeuille, simplement.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium,
                    ),

                    const SizedBox(height: 48),

                    Text(
                      'Connexion',
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),

                    const SizedBox(height: 24),

                    PhoneInputField(
                      controller: _phoneController,
                      country: _country,
                      onCountryChanged: (country) {
                        setState(() {
                          _country = country;
                        });
                      },
                    ),

                    const SizedBox(height: 16),

                    TextFormField(
                      controller: _pinController,
                      obscureText: _obscurePin,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      maxLength: 6,
                      onFieldSubmitted: (_) {
                        if (!_isLoading) {
                          _login();
                        }
                      },
                      decoration: InputDecoration(
                        labelText: 'PIN',
                        hintText: '••••••',
                        prefixIcon: const Icon(
                          Icons.lock_outline,
                        ),
                        suffixIcon: IconButton(
                          onPressed: () {
                            setState(() {
                              _obscurePin = !_obscurePin;
                            });
                          },
                          icon: Icon(
                            _obscurePin
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

                        if (pin.length != 6) {
                          return 'Le PIN doit contenir 6 chiffres.';
                        }

                        return null;
                      },
                    ),

                    const SizedBox(height: 24),

                    SizedBox(
                      height: 52,
                      child: ElevatedButton(
                        onPressed: _isLoading ? null : _login,
                        child: _isLoading
                            ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                            : const Text(
                          'Se connecter',
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    TextButton(
                      onPressed: _isLoading
                          ? null
                          : () {
                        Navigator.of(context).pushNamed('/register');
                      },
                      child: const Text(
                        'Pas encore de compte ? Créer un compte',
                      ),
                    ),

                    if (kDebugMode) ...[
                      const SizedBox(height: 24),

                      Text(
                        'Compte de test : +243998288462 / 123456',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall,
                      ),
                    ],

                    const SizedBox(height: 32),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}