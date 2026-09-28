import 'package:flutter/material.dart';

import '../../../core/api/api_client.dart';
import '../../../core/storage/token_storage.dart';

class WithdrawalPage extends StatefulWidget {
  const WithdrawalPage({
    super.key,
  });

  @override
  State<WithdrawalPage> createState() => _WithdrawalPageState();
}

class _WithdrawalPageState extends State<WithdrawalPage> {
  final _formKey = GlobalKey<FormState>();

  final _amountController = TextEditingController();
  final _phoneController = TextEditingController();

  final _apiClient = ApiClient();
  final _tokenStorage = TokenStorage();

  String _selectedNetwork = 'Airtel Money';

  bool _isLoading = false;

  @override
  void dispose() {
    _amountController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  double? get _amount {
    return double.tryParse(
      _amountController.text.trim(),
    );
  }

  double get _fee {
    final amount = _amount ?? 0;
    return amount * 0.005;
  }

  double get _totalAmount {
    final amount = _amount ?? 0;
    return amount + _fee;
  }

  Future<void> _submitWithdrawal() async {
    if (_isLoading) {
      return;
    }

    if (!_formKey.currentState!.validate()) {
      return;
    }

    FocusScope.of(context).unfocus();

    final amount = _amount;

    if (amount == null || amount <= 0) {
      return;
    }

    await Future<void>.delayed(
      const Duration(milliseconds: 150),
    );

    if (!mounted) {
      return;
    }

    final pin = await _showPinDialog();

    if (!mounted || pin == null) {
      return;
    }

    await Future<void>.delayed(
      const Duration(milliseconds: 150),
    );

    if (!mounted) {
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
        '/transactions/withdrawal',
        token: token,
        body: <String, dynamic>{
          'amount': amount,
          'pin': pin,
          'network': _selectedNetwork,
          'phone': _phoneController.text.trim(),
          'description':
          'Retrait via $_selectedNetwork vers '
              '${_phoneController.text.trim()}',
        },
      );

      if (!mounted) {
        return;
      }

      final balance = response['balance'];

      Navigator.of(context).pop(
        WithdrawalResult(
          amount: amount,
          fee: _fee,
          totalAmount: _totalAmount,
          network: _selectedNetwork,
          phone: _phoneController.text.trim(),
          balance: balance,
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
        'Impossible d’effectuer le retrait.',
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<String?> _showPinDialog() {
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const _WithdrawalPinDialog(),
    );
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
        title: const Text('Retrait'),
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
                      color: theme.colorScheme.error,
                    ),

                    const SizedBox(height: 16),

                    Text(
                      'Retirer de l’argent',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),

                    const SizedBox(height: 8),

                    Text(
                      'Choisissez le réseau et le numéro qui recevra le retrait.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium,
                    ),

                    const SizedBox(height: 32),

                    Text(
                      'Réseau de paiement',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),

                    const SizedBox(height: 12),

                    DropdownButtonFormField<String>(
                      initialValue: _selectedNetwork,
                      decoration: const InputDecoration(
                        labelText: 'Réseau',
                        prefixIcon: Icon(
                          Icons.phone_android_outlined,
                        ),
                        border: OutlineInputBorder(),
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'Airtel Money',
                          child: Text('Airtel Money'),
                        ),
                        DropdownMenuItem(
                          value: 'M-Pesa',
                          child: Text('M-Pesa'),
                        ),
                        DropdownMenuItem(
                          value: 'Orange Money',
                          child: Text('Orange Money'),
                        ),
                      ],
                      onChanged: _isLoading
                          ? null
                          : (value) {
                        if (value == null) {
                          return;
                        }

                        setState(() {
                          _selectedNetwork = value;
                        });
                      },
                    ),

                    const SizedBox(height: 24),

                    Text(
                      'Numéro bénéficiaire',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),

                    const SizedBox(height: 12),

                    TextFormField(
                      controller: _phoneController,
                      enabled: !_isLoading,
                      keyboardType: TextInputType.phone,
                      textInputAction: TextInputAction.next,
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
                          return 'Veuillez saisir le numéro bénéficiaire.';
                        }

                        if (phone.length < 9) {
                          return 'Veuillez saisir un numéro valide.';
                        }

                        return null;
                      },
                    ),

                    const SizedBox(height: 24),

                    Text(
                      'Montant du retrait',
                      style: theme.textTheme.titleMedium?.copyWith(
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
                      textInputAction: TextInputAction.done,
                      onChanged: (_) {
                        setState(() {});
                      },
                      onFieldSubmitted: (_) {
                        if (!_isLoading) {
                          _submitWithdrawal();
                        }
                      },
                      decoration: const InputDecoration(
                        labelText: 'Montant',
                        hintText: 'Ex. 10',
                        prefixIcon: Icon(
                          Icons.attach_money,
                        ),
                        border: OutlineInputBorder(),
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

                    const SizedBox(height: 24),

                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          children: [
                            _SummaryRow(
                              label: 'Montant envoyé',
                              value: _amount == null
                                  ? '0.00'
                                  : _amount!
                                  .toStringAsFixed(2),
                            ),
                            const SizedBox(height: 8),
                            _SummaryRow(
                              label: 'Frais P-Elsa (0,5 %)',
                              value: _fee.toStringAsFixed(2),
                            ),
                            const Divider(height: 24),
                            _SummaryRow(
                              label: 'Total débité',
                              value:
                              _totalAmount.toStringAsFixed(2),
                              isTotal: true,
                            ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 24),

                    SizedBox(
                      height: 54,
                      child: ElevatedButton(
                        onPressed: _isLoading
                            ? null
                            : _submitWithdrawal,
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
                          'Confirmer le retrait',
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    Text(
                      'Cette version effectue un retrait de test dans le wallet. '
                          'Le paiement réel vers l’opérateur sera connecté dans une étape suivante.',
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

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({
    required this.label,
    required this.value,
    this.isTotal = false,
  });

  final String label;
  final String value;
  final bool isTotal;

  @override
  Widget build(BuildContext context) {
    final textStyle = Theme.of(context)
        .textTheme
        .bodyMedium
        ?.copyWith(
      fontWeight:
      isTotal ? FontWeight.bold : FontWeight.normal,
    );

    return Row(
      mainAxisAlignment:
      MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: textStyle,
        ),
        Text(
          value,
          style: textStyle,
        ),
      ],
    );
  }
}

class _WithdrawalPinDialog extends StatefulWidget {
  const _WithdrawalPinDialog();

  @override
  State<_WithdrawalPinDialog> createState() =>
      _WithdrawalPinDialogState();
}

class _WithdrawalPinDialogState extends State<_WithdrawalPinDialog> {
  final _pinController = TextEditingController();
  final _pinFormKey = GlobalKey<FormState>();

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

    if (!_pinFormKey.currentState!.validate()) {
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

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Confirmer le retrait'),
      content: Form(
        key: _pinFormKey,
        child: TextFormField(
          controller: _pinController,
          autofocus: true,
          obscureText: _isObscured,
          enabled: !_isClosing,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.done,
          maxLength: 6,
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
      ),
      actions: [
        TextButton(
          onPressed: _isClosing
              ? null
              : () {
            FocusScope.of(context).unfocus();
            Navigator.of(context).pop();
          },
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

class WithdrawalResult {
  const WithdrawalResult({
    required this.amount,
    required this.fee,
    required this.totalAmount,
    required this.network,
    required this.phone,
    required this.balance,
  });

  final double amount;
  final double fee;
  final double totalAmount;
  final String network;
  final String phone;
  final dynamic balance;
}