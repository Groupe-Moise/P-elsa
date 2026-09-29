import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../core/api/api_client.dart';
import '../../../core/currency/currency_formatter.dart';
import '../../../core/payment/network_detector.dart';
import '../../../core/storage/token_storage.dart';
import '../../../core/widgets/currency_toggle.dart';
import '../../../core/widgets/payment_mode_selector.dart';

class DepositPage extends StatefulWidget {
  const DepositPage({
    super.key,
    this.initialCurrencyCode = 'USD',
  });

  /// Devise pré-sélectionnée à l'ouverture de l'écran (ex. la devise
  /// actuellement affichée sur le dashboard).
  final String initialCurrencyCode;

  @override
  State<DepositPage> createState() => _DepositPageState();
}

class _DepositPageState extends State<DepositPage> {
  final _formKey = GlobalKey<FormState>();

  final _amountController = TextEditingController();
  final _phoneController = TextEditingController();

  final _apiClient = ApiClient();
  final _tokenStorage = TokenStorage();

  PaymentMode _paymentMode = PaymentMode.mobile;

  /// Réseau détecté automatiquement à partir du numéro saisi (voir
  /// `NetworkDetector`). `null` tant qu'aucun préfixe connu ne
  /// correspond.
  String? _detectedNetwork;

  late String _selectedCurrencyCode;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();

    _selectedCurrencyCode = CurrencyFormatter.selectableCurrencies.any(
      (entry) => entry.key == widget.initialCurrencyCode,
    )
        ? widget.initialCurrencyCode
        : CurrencyFormatter.selectableCurrencies.first.key;
  }

  @override
  void dispose() {
    _amountController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  void _onPhoneChanged(String value) {
    setState(() {
      _detectedNetwork = NetworkDetector.detectFromPhone(value);
    });
  }

  Future<void> _submitDeposit() async {
    if (_isLoading) {
      return;
    }

    if (!_formKey.currentState!.validate()) {
      return;
    }

    final network = _detectedNetwork;

    if (network == null) {
      return;
    }

    FocusScope.of(context).unfocus();

    final amount = double.tryParse(
      _amountController.text.trim(),
    );

    if (amount == null || amount <= 0) {
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final token = await _tokenStorage.readAccessToken();

      if (token == null || token.isEmpty) {
        if (!mounted) {
          return;
        }

        Navigator.of(context).pushNamedAndRemoveUntil(
          '/login',
              (route) => false,
        );

        return;
      }

      final response = await _apiClient.post(
        '/transactions/deposit',
        token: token,
        body: <String, dynamic>{
          'amount': amount,
          'network': network,
          'phone': _phoneController.text.trim(),
          'currencyCode': _selectedCurrencyCode,
          'description':
          'Dépôt via $network depuis '
              '${_phoneController.text.trim()}',
        },
      );

      if (!mounted) {
        return;
      }

      final balance = response['balance'];

      final currencyCode = response['currency'] is String
          ? response['currency'] as String
          : _selectedCurrencyCode;

      Navigator.of(context).pop(
        DepositResult(
          amount: amount,
          network: network,
          phone: _phoneController.text.trim(),
          balance: balance,
          currencyCode: currencyCode,
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      _showError(error.message);
    } catch (_) {
      if (!mounted) {
        return;
      }

      _showError(
        'Impossible d’effectuer le dépôt.',
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
        title: const Text('Dépôt'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 500,
              ),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment:
                  CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 16),

                    Icon(
                      Icons.account_balance_wallet_outlined,
                      size: 64,
                      color: theme.colorScheme.primary,
                    ),

                    const SizedBox(height: 16),

                    Text(
                      'Ajouter de l’argent',
                      textAlign: TextAlign.center,
                      style:
                      theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),

                    const SizedBox(height: 8),

                    Text(
                      'Choisissez un mode de paiement, indiquez le '
                          'numéro et le montant à déposer.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium,
                    ),

                    const SizedBox(height: 32),

                    Text(
                      'Mode de paiement',
                      style:
                      theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),

                    const SizedBox(height: 12),

                    PaymentModeSelector(
                      selectedMode: _paymentMode,
                      onChanged: _isLoading
                          ? (_) {}
                          : (mode) {
                        setState(() {
                          _paymentMode = mode;
                        });
                      },
                    ),

                    if (_paymentMode == PaymentMode.mobile) ...[
                      const SizedBox(height: 24),

                      Text(
                        'Numéro de paiement',
                        style:
                        theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),

                      const SizedBox(height: 12),

                      TextFormField(
                        controller: _phoneController,
                        enabled: !_isLoading,
                        keyboardType: TextInputType.phone,
                        textInputAction: TextInputAction.next,
                        onChanged: _onPhoneChanged,
                        decoration: const InputDecoration(
                          labelText: 'Numéro de téléphone',
                          hintText: '+243...',
                          prefixIcon: Icon(
                            Icons.phone_outlined,
                          ),
                          border: OutlineInputBorder(),
                        ),
                        validator: (value) {
                          final phone =
                              value?.trim() ?? '';

                          if (phone.isEmpty) {
                            return 'Veuillez saisir le numéro de paiement.';
                          }

                          if (phone.length < 9) {
                            return 'Veuillez saisir un numéro valide.';
                          }

                          if (_detectedNetwork == null) {
                            return 'Numéro non reconnu. Vérifiez le '
                                'numéro saisi.';
                          }

                          return null;
                        },
                      ),

                      if (_phoneController.text
                          .trim()
                          .isNotEmpty) ...[
                        const SizedBox(height: 8),
                        _NetworkHint(
                          network: _detectedNetwork,
                        ),
                      ],
                    ],

                    const SizedBox(height: 24),

                    Text(
                      'Montant',
                      style:
                      theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),

                    const SizedBox(height: 12),

                    TextFormField(
                      controller: _amountController,
                      enabled: !_isLoading,
                      keyboardType:
                      const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      textInputAction:
                      TextInputAction.done,
                      onFieldSubmitted: (_) {
                        if (!_isLoading) {
                          _submitDeposit();
                        }
                      },
                      decoration: InputDecoration(
                        labelText: 'Montant',
                        hintText: 'Ex. 50',
                        prefixText:
                        '${CurrencyFormatter.compactLabel(
                          _selectedCurrencyCode,
                        )} ',
                        suffix: CurrencyToggle(
                          selectedCurrencyCode:
                          _selectedCurrencyCode,
                          enabled: !_isLoading,
                          onChanged: (currencyCode) {
                            setState(() {
                              _selectedCurrencyCode =
                                  currencyCode;
                            });
                          },
                        ),
                        border: const OutlineInputBorder(),
                      ),
                      validator: (value) {
                        final text =
                            value?.trim() ?? '';

                        if (text.isEmpty) {
                          return 'Veuillez saisir un montant.';
                        }

                        final amount =
                        double.tryParse(text);

                        if (amount == null) {
                          return 'Veuillez saisir un montant valide.';
                        }

                        if (amount <= 0) {
                          return 'Le montant doit être supérieur à zéro.';
                        }

                        return null;
                      },
                    ),

                    const SizedBox(height: 32),

                    SizedBox(
                      height: 54,
                      child: ElevatedButton(
                        onPressed: _isLoading
                            ? null
                            : _submitDeposit,
                        child: _isLoading
                            ? const SizedBox(
                          width: 24,
                          height: 24,
                          child:
                          CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                            : const Text(
                          'Confirmer le dépôt',
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    Text(
                      'Cette version effectue un dépôt de test dans '
                          'le wallet. Le paiement réel via l’opérateur '
                          'sera connecté dans une étape suivante.',
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

/// Petit indicateur affiché sous le champ de numéro, confirmant le
/// réseau détecté automatiquement (ou signalant qu'aucun réseau
/// connu ne correspond au numéro saisi).
class _NetworkHint extends StatelessWidget {
  const _NetworkHint({
    required this.network,
  });

  final String? network;

  @override
  Widget build(BuildContext context) {
    final isRecognized = network != null;

    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Row(
        children: [
          Icon(
            isRecognized
                ? Icons.check_circle_outline
                : Icons.error_outline,
            size: 16,
            color: isRecognized
                ? AppColors.success
                : AppColors.warning,
          ),

          const SizedBox(width: 6),

          Expanded(
            child: Text(
              isRecognized
                  ? 'Réseau détecté : $network'
                  : 'Réseau non reconnu pour ce numéro.',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(
                color: isRecognized
                    ? AppColors.success
                    : AppColors.warning,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class DepositResult {
  const DepositResult({
    required this.amount,
    required this.network,
    required this.phone,
    required this.balance,
    required this.currencyCode,
  });

  final double amount;
  final String network;
  final String phone;
  final dynamic balance;
  final String currencyCode;
}
