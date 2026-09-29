import 'package:flutter/material.dart';

import '../../../core/api/api_client.dart';
import '../../../core/currency/currency_formatter.dart';
import '../../../core/storage/token_storage.dart';
import '../../../core/widgets/operation_success_dialog.dart';
import '../../../core/widgets/pin_dialog.dart';
import 'qr_scanner_page.dart';

class PaymentPage extends StatefulWidget {
  const PaymentPage({
    super.key,
  });

  @override
  State<PaymentPage> createState() => _PaymentPageState();
}

class _PaymentPageState extends State<PaymentPage> {
  final _formKey = GlobalKey<FormState>();

  final _merchantCodeController = TextEditingController();
  final _amountController = TextEditingController();

  final _apiClient = ApiClient();
  final _tokenStorage = TokenStorage();

  bool _isLoading = false;
  bool _isLoadingWallet = false;
  bool _isProcessingPayment = false;

  Map<String, dynamic>? _merchant;
  Map<String, dynamic>? _wallet;

  bool _showSummary = false;

  @override
  void dispose() {
    _merchantCodeController.dispose();
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _scanQrCode() async {
    FocusScope.of(context).unfocus();

    final scanned = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => const QrScannerPage(
          title: 'Scanner le QR code du marchand',
        ),
      ),
    );

    if (!mounted || scanned == null || scanned.isEmpty) {
      return;
    }

    setState(() {
      _merchantCodeController.text = scanned;
    });

    await _searchMerchant();
  }

  Future<void> _searchMerchant() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      _isLoading = true;
      _merchant = null;
      _wallet = null;
      _showSummary = false;
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

      final merchantCode = _merchantCodeController.text.trim();

      final merchantResponse = await _apiClient.get(
        '/transactions/payment/recipient?merchantCode=${Uri.encodeComponent(merchantCode)}',
        token: token,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _merchant = merchantResponse;
        _isLoading = false;
      });

      await _loadPayerWallet(token);
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _merchant = null;
        _wallet = null;
        _isLoading = false;
        _isLoadingWallet = false;
        _showSummary = false;
      });

      _showError(error.message);
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _merchant = null;
        _wallet = null;
        _isLoading = false;
        _isLoadingWallet = false;
        _showSummary = false;
      });

      _showError(
        'Impossible de rechercher ce marchand.',
      );
    }
  }

  Future<void> _loadPayerWallet(String token) async {
    if (!mounted) {
      return;
    }

    setState(() {
      _isLoadingWallet = true;
    });

    try {
      final response = await _apiClient.get(
        '/wallets/me',
        token: token,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _wallet = response;
        _isLoadingWallet = false;
      });
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _wallet = null;
        _isLoadingWallet = false;
      });

      _showError(
        'Impossible de charger votre solde : ${error.message}',
      );
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _wallet = null;
        _isLoadingWallet = false;
      });

      _showError(
        'Impossible de charger votre solde.',
      );
    }
  }

  void _continueToSummary() {
    if (_merchant == null) {
      return;
    }

    if (_wallet == null) {
      _showError(
        'Votre wallet n’a pas pu être chargé.',
      );
      return;
    }

    if (!_formKey.currentState!.validate()) {
      return;
    }

    final amount = _amountValue();

    if (amount == null || amount <= 0) {
      _showError(
        'Veuillez saisir un montant valide.',
      );
      return;
    }

    final payerCurrency = _payerCurrency();
    final merchantCurrency = _merchantCurrency();

    if (payerCurrency != merchantCurrency) {
      _showError(
        'La devise de votre wallet ($payerCurrency) '
            'est différente de celle du marchand '
            '($merchantCurrency).',
      );
      return;
    }

    final balance = _payerBalance();

    if (amount > balance) {
      _showError(
        'Solde insuffisant. Votre solde disponible est '
            '${balance.toStringAsFixed(2)} $payerCurrency.',
      );
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      _showSummary = true;
    });
  }

  void _editPayment() {
    if (_isProcessingPayment) {
      return;
    }

    setState(() {
      _showSummary = false;
    });
  }

  Future<void> _confirmPayment() async {
    if (_isProcessingPayment) {
      return;
    }

    if (_merchant == null) {
      _showError(
        'Le marchand est introuvable.',
      );
      return;
    }

    if (_wallet == null) {
      _showError(
        'Votre wallet est introuvable.',
      );
      return;
    }

    final amount = _amountValue();

    if (amount == null || amount <= 0) {
      _showError(
        'Le montant du paiement est invalide.',
      );
      return;
    }

    final merchantCode = _merchant?['merchantCode'];

    if (merchantCode is! String || merchantCode.isEmpty) {
      _showError(
        'Impossible d’identifier le marchand.',
      );
      return;
    }

    // On ferme explicitement le clavier avant d'ouvrir
    // le dialogue PIN afin d'éviter une collision entre
    // l'animation du clavier et celle du dialogue.
    FocusScope.of(context).unfocus();

    await Future<void>.delayed(
      const Duration(milliseconds: 150),
    );

    if (!mounted) {
      return;
    }

    final pin = await _showPinDialog();

    if (!mounted || pin == null || pin.isEmpty) {
      return;
    }

    // On laisse Flutter terminer complètement la fermeture
    // du dialogue PIN avant de lancer la requête réseau.
    await Future<void>.delayed(
      const Duration(milliseconds: 150),
    );

    if (!mounted) {
      return;
    }

    await _executePayment(
      merchantCode: merchantCode,
      amount: amount,
      pin: pin,
    );
  }

  Future<String?> _showPinDialog() async {
    if (!mounted) {
      return null;
    }

    return PinDialog.show(
      context,
      title: 'Confirmer le paiement',
      description:
      'Entrez votre PIN pour autoriser le paiement de '
          '${_formatAmount(_amountValue() ?? 0)} ${_payerCurrency()}.',
    );
  }

  Future<void> _executePayment({
    required String merchantCode,
    required double amount,
    required String pin,
  }) async {
    if (!mounted) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      _isProcessingPayment = true;
    });

    try {
      final token = await _tokenStorage.readAccessToken();

      if (token == null || token.isEmpty) {
        if (!mounted) {
          return;
        }

        setState(() {
          _isProcessingPayment = false;
        });

        Navigator.of(context).pushNamedAndRemoveUntil(
          '/login',
              (route) => false,
        );

        return;
      }

      final response = await _apiClient.post(
        '/transactions/payment',
        token: token,
        body: {
          'merchantCode': merchantCode,
          'amount': amount,
          'pin': pin,
        },
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _isProcessingPayment = false;
      });

      await _showPaymentSuccess(response);
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isProcessingPayment = false;
      });

      _showError(error.message);
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isProcessingPayment = false;
      });

      _showError(
        'Impossible d’effectuer le paiement.',
      );
    }
  }

  Future<void> _showPaymentSuccess(
      Map<String, dynamic> response,
      ) async {
    final transaction = response['transaction'];

    String reference = '';

    if (transaction is Map<String, dynamic>) {
      final value = transaction['reference'];

      if (value is String) {
        reference = value;
      }
    }

    final balances = response['balances'];

    double? payerBalance;

    if (balances is Map<String, dynamic>) {
      final value = balances['payer'];

      payerBalance = double.tryParse(
        value?.toString() ?? '',
      );
    }

    if (!mounted) {
      return;
    }

    await OperationSuccessDialog.show(
      context,
      title: 'Paiement effectué',
      message:
      '${_formatAmount(_amountValue() ?? 0)} '
          '${_payerCurrency()} ont été payés à '
          '${_merchantFullName()}.',
      details: [
        if (reference.isNotEmpty)
          MapEntry('Référence', reference),
        if (payerBalance != null)
          MapEntry(
            'Nouveau solde',
            '${_payerCurrencySymbol()} '
                '${_formatAmount(payerBalance)}',
          ),
      ],
    );

    if (!mounted) {
      return;
    }

    Navigator.of(context).pop(true);
  }

  void _showError(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
        ),
      );
  }

  double? _amountValue() {
    final normalized = _amountController.text
        .trim()
        .replaceAll(',', '.');

    return double.tryParse(normalized);
  }

  double _payerBalance() {
    final balance = _wallet?['balance'];

    if (balance == null) {
      return 0;
    }

    return double.tryParse(
      balance.toString(),
    ) ??
        0;
  }

  String _formatAmount(double amount) {
    return CurrencyFormatter.formatAmount(amount);
  }

  String _payerCurrency() {
    return CurrencyFormatter.codeFromWallet(_wallet);
  }

  String _payerCurrencyName() {
    return CurrencyFormatter.nameFromWallet(_wallet);
  }

  String _payerCurrencySymbol() {
    return _currencySymbol(_payerCurrency());
  }

  String _merchantFirstName() {
    final value = _merchant?['firstName'];

    if (value is String && value.isNotEmpty) {
      return value;
    }

    return '';
  }

  String _merchantLastName() {
    final value = _merchant?['lastName'];

    if (value is String && value.isNotEmpty) {
      return value;
    }

    return '';
  }

  String _merchantFullName() {
    final firstName = _merchantFirstName();
    final lastName = _merchantLastName();

    final fullName = '$firstName $lastName'.trim();

    if (fullName.isNotEmpty) {
      return fullName;
    }

    return 'Marchand P-Elsa';
  }

  String _merchantCode() {
    final value = _merchant?['merchantCode'];

    if (value is String && value.isNotEmpty) {
      return value;
    }

    return _merchantCodeController.text.trim();
  }

  Map<String, dynamic>? _merchantWallet() {
    final wallet = _merchant?['wallet'];

    if (wallet is Map<String, dynamic>) {
      return wallet;
    }

    return null;
  }

  String _merchantCurrency() {
    return CurrencyFormatter.codeFromWallet(_merchantWallet());
  }

  String _merchantCurrencyName() {
    return CurrencyFormatter.nameFromWallet(_merchantWallet());
  }

  String _merchantCurrencySymbol() {
    return _currencySymbol(
      _merchantCurrency(),
    );
  }

  String _currencySymbol(String code) {
    return CurrencyFormatter.symbolFor(code);
  }

  String _initials() {
    final firstName = _merchantFirstName();
    final lastName = _merchantLastName();

    String result = '';

    if (firstName.isNotEmpty) {
      result += firstName[0];
    }

    if (lastName.isNotEmpty) {
      result += lastName[0];
    }

    if (result.isEmpty) {
      return 'M';
    }

    return result.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _showSummary
              ? 'Confirmation du paiement'
              : 'Paiement',
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 500,
              ),
              child: _showSummary
                  ? _buildSummary(context)
                  : _buildPaymentForm(context),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPaymentForm(BuildContext context) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment:
        CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 16),

          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Theme.of(context)
                  .colorScheme
                  .primary
                  .withValues(
                alpha: 0.12,
              ),
            ),
            child: Icon(
              Icons.storefront_outlined,
              size: 36,
              color: Theme.of(context)
                  .colorScheme
                  .primary,
            ),
          ),

          const SizedBox(height: 20),

          Text(
            'Payer un marchand',
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),

          const SizedBox(height: 8),

          Text(
            'Scannez le QR code du marchand ou saisissez '
                'son code, puis indiquez le montant à payer.',
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .bodyMedium,
          ),

          const SizedBox(height: 32),

          Text(
            'Marchand',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),

          const SizedBox(height: 12),

          SizedBox(
            height: 52,
            child: OutlinedButton.icon(
              onPressed:
              _isLoading ||
                  _isLoadingWallet ||
                  _isProcessingPayment
                  ? null
                  : _scanQrCode,
              icon: const Icon(
                Icons.qr_code_scanner,
              ),
              label: const Text(
                'Scanner un QR code',
              ),
            ),
          ),

          const SizedBox(height: 16),

          TextFormField(
            controller: _merchantCodeController,
            enabled: !_isLoading &&
                !_isLoadingWallet &&
                !_isProcessingPayment,
            textCapitalization: TextCapitalization.characters,
            textInputAction: TextInputAction.search,
            onChanged: (_) {
              if (_merchant != null) {
                setState(() {
                  _merchant = null;
                  _wallet = null;
                  _showSummary = false;
                });
              }
            },
            onFieldSubmitted: (_) {
              if (!_isLoading &&
                  !_isLoadingWallet) {
                _searchMerchant();
              }
            },
            decoration: const InputDecoration(
              labelText: 'Code marchand',
              hintText: 'PE-XXXXXXXX',
              prefixIcon: Icon(
                Icons.storefront_outlined,
              ),
              border: OutlineInputBorder(),
            ),
            validator: (value) {
              final code = value?.trim() ?? '';

              if (code.isEmpty) {
                return 'Veuillez saisir ou scanner le code du marchand.';
              }

              if (code.length < 4) {
                return 'Veuillez saisir un code valide.';
              }

              return null;
            },
          ),

          const SizedBox(height: 16),

          SizedBox(
            height: 52,
            child: ElevatedButton.icon(
              onPressed:
              _isLoading ||
                  _isLoadingWallet ||
                  _isProcessingPayment
                  ? null
                  : _searchMerchant,
              icon: _isLoading
                  ? const SizedBox(
                width: 20,
                height: 20,
                child:
                CircularProgressIndicator(
                  strokeWidth: 2,
                ),
              )
                  : const Icon(
                Icons.search,
              ),
              label: Text(
                _isLoading
                    ? 'Recherche...'
                    : 'Rechercher',
              ),
            ),
          ),

          if (_merchant != null) ...[
            const SizedBox(height: 32),
            _buildMerchantCard(context),
          ],

          if (_merchant != null &&
              _wallet != null) ...[
            const SizedBox(height: 24),
            _buildAmountSection(context),
          ],

          const SizedBox(height: 24),

          Text(
            'Aucun argent ne sera envoyé tant que '
                'vous n’aurez pas confirmé le paiement.',
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _buildMerchantCard(
      BuildContext context,
      ) {
    final theme = Theme.of(context);

    final fullName = _merchantFullName();
    final code = _merchantCode();
    final currency = _merchantCurrency();
    final currencyName =
    _merchantCurrencyName();
    final currencySymbol =
    _merchantCurrencySymbol();

    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment:
          CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: theme
                        .colorScheme
                        .primary
                        .withValues(
                      alpha: 0.12,
                    ),
                  ),
                  child: Center(
                    child: Text(
                      _initials(),
                      style: theme
                          .textTheme
                          .titleMedium
                          ?.copyWith(
                        fontWeight:
                        FontWeight.bold,
                        color: theme
                            .colorScheme
                            .primary,
                      ),
                    ),
                  ),
                ),

                const SizedBox(width: 16),

                Expanded(
                  child: Column(
                    crossAxisAlignment:
                    CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Marchand trouvé',
                        style: theme
                            .textTheme
                            .bodySmall,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        fullName,
                        style: theme
                            .textTheme
                            .titleLarge
                            ?.copyWith(
                          fontWeight:
                          FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),

                const Icon(
                  Icons.verified_outlined,
                  color: Colors.green,
                  size: 28,
                ),
              ],
            ),

            const SizedBox(height: 24),

            const Divider(),

            const SizedBox(height: 16),

            _InfoRow(
              icon: Icons.storefront_outlined,
              label: 'Code marchand',
              value: code,
            ),

            const SizedBox(height: 14),

            _InfoRow(
              icon: Icons
                  .account_balance_wallet_outlined,
              label: 'Devise du wallet',
              value:
              '$currencySymbol  $currency',
            ),

            const SizedBox(height: 14),

            _InfoRow(
              icon: Icons.payments_outlined,
              label: 'Monnaie',
              value: currencyName,
            ),

            const SizedBox(height: 20),

            Container(
              padding:
              const EdgeInsets.all(14),
              decoration: BoxDecoration(
                borderRadius:
                BorderRadius.circular(12),
                color: theme
                    .colorScheme
                    .primary
                    .withValues(
                  alpha: 0.06,
                ),
              ),
              child: Row(
                crossAxisAlignment:
                CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.info_outline,
                    size: 20,
                    color: theme
                        .colorScheme
                        .primary,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Vérifiez attentivement le '
                          'marchand avant de continuer.',
                      style: theme
                          .textTheme
                          .bodySmall,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAmountSection(
      BuildContext context,
      ) {
    final currency = _payerCurrency();
    final symbol = _payerCurrencySymbol();
    final balance = _payerBalance();
    final currencyName =
    _payerCurrencyName();

    final isDifferentCurrency =
        _payerCurrency() !=
            _merchantCurrency();

    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment:
          CrossAxisAlignment.stretch,
          children: [
            Text(
              'Montant du paiement',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(
                fontWeight:
                FontWeight.w600,
              ),
            ),

            const SizedBox(height: 8),

            Text(
              'Solde disponible : '
                  '${_formatAmount(balance)} '
                  '$currency',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium,
            ),

            const SizedBox(height: 4),

            Text(
              currencyName,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall,
            ),

            const SizedBox(height: 20),

            TextFormField(
              controller: _amountController,
              keyboardType:
              const TextInputType.numberWithOptions(
                decimal: true,
              ),
              textInputAction:
              TextInputAction.done,
              // Revalide à chaque frappe (dès que le champ a été
              // touché une première fois) : le message "solde
              // insuffisant" doit apparaître instantanément dès que
              // le montant saisi dépasse le solde disponible, sans
              // attendre le bouton "Continuer".
              autovalidateMode:
              AutovalidateMode.onUserInteraction,
              decoration: InputDecoration(
                labelText: 'Montant',
                hintText: '0.00',
                prefixIcon: const Icon(
                  Icons.payments_outlined,
                ),
                prefixText: '$symbol  ',
                border:
                const OutlineInputBorder(),
              ),
              onChanged: (_) {
                if (_showSummary) {
                  setState(() {
                    _showSummary = false;
                  });
                }
              },
              validator: (value) {
                final amount = double.tryParse(
                  (value ?? '')
                      .trim()
                      .replaceAll(',', '.'),
                );

                if (value == null ||
                    value.trim().isEmpty) {
                  return 'Veuillez saisir un montant.';
                }

                if (amount == null) {
                  return 'Veuillez saisir un montant valide.';
                }

                if (amount <= 0) {
                  return 'Le montant doit être supérieur à 0.';
                }

                if (amount > balance) {
                  return 'Solde insuffisant. Disponible : '
                      '${_formatAmount(balance)} $currency.';
                }

                if (isDifferentCurrency) {
                  return 'Les devises des deux wallets sont différentes.';
                }

                return null;
              },
            ),

            const SizedBox(height: 20),

            if (isDifferentCurrency)
              Container(
                padding:
                const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  borderRadius:
                  BorderRadius.circular(12),
                  color: Colors.orange.withValues(
                    alpha: 0.10,
                  ),
                ),
                child: Row(
                  crossAxisAlignment:
                  CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons
                          .warning_amber_outlined,
                      size: 22,
                      color: Colors.orange,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Votre wallet est en '
                            '${_payerCurrency()}, tandis que '
                            'celui du marchand est en '
                            '${_merchantCurrency()}. '
                            'La conversion de devises sera ajoutée '
                            'dans une prochaine étape.',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall,
                      ),
                    ),
                  ],
                ),
              ),

            const SizedBox(height: 20),

            SizedBox(
              height: 52,
              child: ElevatedButton(
                onPressed:
                _isLoadingWallet ||
                    _isProcessingPayment
                    ? null
                    : _continueToSummary,
                child: const Text(
                  'Continuer',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummary(
      BuildContext context,
      ) {
    final amount = _amountValue() ?? 0;
    final balance = _payerBalance();
    final remainingBalance =
        balance - amount;
    final symbol =
    _payerCurrencySymbol();

    return Column(
      crossAxisAlignment:
      CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 16),

        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: Theme.of(context)
                .colorScheme
                .primary
                .withValues(
              alpha: 0.12,
            ),
          ),
          child: Icon(
            Icons.receipt_long_outlined,
            size: 36,
            color: Theme.of(context)
                .colorScheme
                .primary,
          ),
        ),

        const SizedBox(height: 20),

        Text(
          'Vérifiez votre paiement',
          textAlign: TextAlign.center,
          style: Theme.of(context)
              .textTheme
              .headlineSmall
              ?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),

        const SizedBox(height: 8),

        Text(
          'Aucun paiement n’a encore été effectué.',
          textAlign: TextAlign.center,
          style: Theme.of(context)
              .textTheme
              .bodyMedium,
        ),

        const SizedBox(height: 32),

        Card(
          elevation: 0,
          child: Padding(
            padding:
            const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment:
              CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Marchand',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(
                    fontWeight:
                    FontWeight.w600,
                  ),
                ),

                const SizedBox(height: 16),

                _InfoRow(
                  icon: Icons.person_outline,
                  label: 'Nom',
                  value:
                  _merchantFullName(),
                ),

                const SizedBox(height: 14),

                _InfoRow(
                  icon: Icons.storefront_outlined,
                  label: 'Code marchand',
                  value:
                  _merchantCode(),
                ),

                const SizedBox(height: 14),

                _InfoRow(
                  icon: Icons
                      .account_balance_wallet_outlined,
                  label: 'Wallet',
                  value:
                  '${_merchantCurrencySymbol()} '
                      '${_merchantCurrency()}',
                ),
              ],
            ),
          ),
        ),

        const SizedBox(height: 16),

        Card(
          elevation: 0,
          child: Padding(
            padding:
            const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment:
              CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Détails',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(
                    fontWeight:
                    FontWeight.w600,
                  ),
                ),

                const SizedBox(height: 16),

                _SummaryRow(
                  label: 'Montant payé',
                  value:
                  '$symbol ${_formatAmount(amount)}',
                ),

                const SizedBox(height: 12),

                _SummaryRow(
                  label: 'Frais de paiement',
                  value: '$symbol 0.00',
                ),

                const Divider(
                  height: 28,
                ),

                _SummaryRow(
                  label: 'Total débité',
                  value:
                  '$symbol ${_formatAmount(amount)}',
                  isBold: true,
                ),

                const SizedBox(height: 12),

                _SummaryRow(
                  label:
                  'Solde après paiement',
                  value:
                  '$symbol ${_formatAmount(remainingBalance)}',
                ),
              ],
            ),
          ),
        ),

        const SizedBox(height: 24),

        Container(
          padding:
          const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius:
            BorderRadius.circular(12),
            color: Theme.of(context)
                .colorScheme
                .primary
                .withValues(
              alpha: 0.06,
            ),
          ),
          child: Row(
            crossAxisAlignment:
            CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.lock_outline,
                size: 22,
                color: Theme.of(context)
                    .colorScheme
                    .primary,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Le paiement sera exécuté uniquement '
                      'après la saisie et la validation de votre PIN.',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall,
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 24),

        SizedBox(
          height: 52,
          child: ElevatedButton.icon(
            onPressed:
            _isProcessingPayment
                ? null
                : _confirmPayment,
            icon: _isProcessingPayment
                ? const SizedBox(
              width: 20,
              height: 20,
              child:
              CircularProgressIndicator(
                strokeWidth: 2,
              ),
            )
                : const Icon(
              Icons.lock_outline,
            ),
            label: Text(
              _isProcessingPayment
                  ? 'Paiement en cours...'
                  : 'Confirmer le paiement',
            ),
          ),
        ),

        const SizedBox(height: 12),

        SizedBox(
          height: 52,
          child: OutlinedButton(
            onPressed:
            _isProcessingPayment
                ? null
                : _editPayment,
            child: const Text(
              'Modifier',
            ),
          ),
        ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(
          icon,
          size: 22,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment:
            CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall,
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(
                  fontWeight:
                  FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({
    required this.label,
    required this.value,
    this.isBold = false,
  });

  final String label;
  final String value;
  final bool isBold;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context)
        .textTheme
        .bodyMedium
        ?.copyWith(
      fontWeight: isBold
          ? FontWeight.bold
          : FontWeight.normal,
    );

    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: style,
          ),
        ),
        const SizedBox(width: 16),
        Text(
          value,
          style: style,
        ),
      ],
    );
  }
}
