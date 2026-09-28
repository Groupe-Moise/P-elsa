import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api/api_client.dart';
import '../../core/phone/country.dart';
import '../../core/phone/phone_formatter.dart';
import '../../core/pin/pin_rules.dart';
import '../../core/widgets/phone_input_field.dart';
import 'auth_service.dart';

class RegisterPage extends StatefulWidget {
  const RegisterPage({
    super.key,
  });

  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final _formKey = GlobalKey<FormState>();

  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _pinController = TextEditingController();
  final _confirmPinController = TextEditingController();

  final _authService = AuthService();

  Country _country = Countries.defaultCountry;

  bool _isLoading = false;
  bool _obscurePin = true;

  @override
  void dispose() {
    _firstNameController.dispose();
    _lastNameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _pinController.dispose();
    _confirmPinController.dispose();
    super.dispose();
  }

  Future<void> _register() async {
    if (_isLoading) {
      return;
    }

    if (!_formKey.currentState!.validate()) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      _isLoading = true;
    });

    try {
      await _authService.register(
        firstName: _firstNameController.text.trim(),
        lastName: _lastNameController.text.trim(),
        phone: PhoneFormatter.toInternational(
          _country,
          _phoneController.text,
        ),
        email: _emailController.text,
        pin: _pinController.text.trim(),
      );

      if (!mounted) {
        return;
      }

      Navigator.of(context).pushNamedAndRemoveUntil(
        '/wallet',
            (route) => false,
      );
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
      appBar: AppBar(
        title: const Text('Créer un compte'),
      ),
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
                    Text(
                      'Bienvenue sur P-Elsa',
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),

                    const SizedBox(height: 8),

                    Text(
                      'Quelques informations suffisent pour '
                          'ouvrir votre portefeuille.',
                      style: theme.textTheme.bodyMedium,
                    ),

                    const SizedBox(height: 24),

                    TextFormField(
                      controller: _firstNameController,
                      textCapitalization: TextCapitalization.words,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Prénom',
                        prefixIcon: Icon(Icons.person_outline),
                        border: OutlineInputBorder(),
                      ),
                      validator: (value) {
                        final name = value?.trim() ?? '';

                        if (name.isEmpty) {
                          return 'Veuillez saisir votre prénom.';
                        }

                        if (name.length > 60) {
                          return 'Le prénom est trop long '
                              '(60 caractères maximum).';
                        }

                        return null;
                      },
                    ),

                    const SizedBox(height: 16),

                    TextFormField(
                      controller: _lastNameController,
                      textCapitalization: TextCapitalization.words,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Nom',
                        prefixIcon: Icon(Icons.person_outline),
                        border: OutlineInputBorder(),
                      ),
                      validator: (value) {
                        final name = value?.trim() ?? '';

                        if (name.isEmpty) {
                          return 'Veuillez saisir votre nom.';
                        }

                        if (name.length > 60) {
                          return 'Le nom est trop long '
                              '(60 caractères maximum).';
                        }

                        return null;
                      },
                    ),

                    const SizedBox(height: 16),

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
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'E-mail (facultatif)',
                        prefixIcon: Icon(Icons.email_outlined),
                        border: OutlineInputBorder(),
                      ),
                      validator: (value) {
                        final email = value?.trim() ?? '';

                        if (email.isEmpty) {
                          return null;
                        }

                        if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                            .hasMatch(email)) {
                          return 'Veuillez saisir une adresse '
                              'e-mail valide.';
                        }

                        return null;
                      },
                    ),

                    const SizedBox(height: 16),

                    TextFormField(
                      controller: _pinController,
                      obscureText: _obscurePin,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.next,
                      maxLength: 6,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                      ],
                      decoration: InputDecoration(
                        labelText: 'Choisissez un PIN (6 chiffres)',
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
                          return 'Veuillez choisir un PIN.';
                        }

                        if (pin.length != 6) {
                          return 'Le PIN doit contenir 6 chiffres.';
                        }

                        if (PinRules.isWeak(pin)) {
                          return 'Ce PIN est trop simple. Évitez les '
                              'suites (123456) et les chiffres '
                              'répétés (000000).';
                        }

                        return null;
                      },
                    ),

                    const SizedBox(height: 16),

                    TextFormField(
                      controller: _confirmPinController,
                      obscureText: _obscurePin,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      maxLength: 6,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                      ],
                      onFieldSubmitted: (_) {
                        if (!_isLoading) {
                          _register();
                        }
                      },
                      decoration: const InputDecoration(
                        labelText: 'Confirmez le PIN',
                        hintText: '••••••',
                        prefixIcon: Icon(
                          Icons.lock_outline,
                        ),
                        border: OutlineInputBorder(),
                        counterText: '',
                      ),
                      validator: (value) {
                        final confirmation = value?.trim() ?? '';

                        if (confirmation.isEmpty) {
                          return 'Veuillez confirmer votre PIN.';
                        }

                        if (confirmation != _pinController.text.trim()) {
                          return 'Les deux PIN ne sont pas identiques.';
                        }

                        return null;
                      },
                    ),

                    const SizedBox(height: 24),

                    SizedBox(
                      height: 52,
                      child: ElevatedButton(
                        onPressed: _isLoading ? null : _register,
                        child: _isLoading
                            ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                            : const Text(
                          'Créer mon compte',
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    Text(
                      'Votre PIN protège toutes vos opérations. '
                          'Ne le partagez avec personne.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall,
                    ),

                    const SizedBox(height: 24),
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