import 'package:flutter/material.dart';

import '../../../core/api/api_client.dart';
import '../../../core/currency/currency_formatter.dart';
import '../../../core/storage/token_storage.dart';
import '../../../core/widgets/operation_success_dialog.dart';
import '../../../core/widgets/pin_dialog.dart';

class TransferPage extends StatefulWidget {
  const TransferPage({
    super.key,
  });

  @override
  State<TransferPage> createState() => _TransferPageState();
}

class _TransferPageState extends State<TransferPage> {
  final _formKey = GlobalKey<FormState>();

  final _phoneController = TextEditingController();
  final _amountController = TextEditingController();

  final _apiClient = ApiClient();
  final _tokenStorage = TokenStorage();

  bool _isLoading = false;
  bool _isLoadingWallet = false;
  bool _isProcessingTransfer = false;

  Map<String, dynamic>? _recipient;
  Map<String, dynamic>? _wallet;

  bool _showSummary = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _searchRecipient() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      _isLoading = true;
      _recipient = null;
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

      final phone = _phoneController.text.trim();

      final recipientResponse = await _apiClient.get(
        '/transactions/transfer/recipient?phone=${Uri.encodeComponent(phone)}',
        token: token,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _recipient = recipientResponse;
        _isLoading = false;
      });

      await _loadSenderWallet(token);
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _recipient = null;
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
        _recipient = null;
        _wallet = null;
        _isLoading = false;
        _isLoadingWallet = false;
        _showSummary = false;
      });

      _showError(
        'Impossible de rechercher ce bénéficiaire.',
      );
    }
  }

  Future<void> _loadSenderWallet(String token) async {
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
    if (_recipient == null) {
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

    final senderCurrency = _senderCurrency();
    final recipientCurrency = _recipientCurrency();

    if (senderCurrency != recipientCurrency) {
      _showError(
        'La devise de votre wallet ($senderCurrency) '
            'est différente de celle du bénéficiaire '
            '($recipientCurrency).',
      );
      return;
    }

    final balance = _senderBalance();

    if (amount > balance) {
      _showError(
        'Solde insuffisant. Votre solde disponible est '
            '${balance.toStringAsFixed(2)} $senderCurrency.',
      );
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      _showSummary = true;
    });
  }

  void _editTransfer() {
    if (_isProcessingTransfer) {
      return;
    }

    setState(() {
      _showSummary = false;
    });
  }

  Future<void> _confirmTransfer() async {
    if (_isProcessingTransfer) {
      return;
    }

    if (_recipient == null) {
      _showError(
        'Le bénéficiaire du transfert est introuvable.',
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
        'Le montant du transfert est invalide.',
      );
      return;
    }

    final receiverUserId = _recipient?['id'];

    if (receiverUserId is! String ||
        receiverUserId.isEmpty) {
      _showError(
        'Impossible d’identifier le bénéficiaire.',
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

    await _executeTransfer(
      receiverUserId: receiverUserId,
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
      title: 'Confirmer le transfert',
      description:
      'Entrez votre PIN pour autoriser l’envoi de '
          '${_formatAmount(_amountValue() ?? 0)} ${_senderCurrency()}.',
    );
  }

  Future<void> _executeTransfer({
    required String receiverUserId,
    required double amount,
    required String pin,
  }) async {
    if (!mounted) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      _isProcessingTransfer = true;
    });

    try {
      final token = await _tokenStorage.readAccessToken();

      if (token == null || token.isEmpty) {
        if (!mounted) {
          return;
        }

        setState(() {
          _isProcessingTransfer = false;
        });

        Navigator.of(context).pushNamedAndRemoveUntil(
          '/login',
              (route) => false,
        );

        return;
      }

      final response = await _apiClient.post(
        '/transactions/transfer',
        token: token,
        body: {
          'receiverUserId': receiverUserId,
          'amount': amount,
          'pin': pin,
        },
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _isProcessingTransfer = false;
      });

      await _showTransferSuccess(response);
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isProcessingTransfer = false;
      });

      _showError(error.message);
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isProcessingTransfer = false;
      });

      _showError(
        'Impossible d’effectuer le transfert.',
      );
    }
  }

  Future<void> _showTransferSuccess(
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

    double? senderBalance;

    if (balances is Map<String, dynamic>) {
      final value = balances['sender'];

      senderBalance = double.tryParse(
        value?.toString() ?? '',
      );
    }

    if (!mounted) {
      return;
    }

    await OperationSuccessDialog.show(
      context,
      title: 'Transfert effectué',
      message:
      '${_formatAmount(_amountValue() ?? 0)} '
          '${_senderCurrency()} ont été envoyés à '
          '${_recipientFullName()}.',
      details: [
        if (reference.isNotEmpty)
          MapEntry('Référence', reference),
        if (senderBalance != null)
          MapEntry(
            'Nouveau solde',
            '${_senderCurrencySymbol()} '
                '${_formatAmount(senderBalance)}',
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

  double _senderBalance() {
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

  String _senderCurrency() {
    return CurrencyFormatter.codeFromWallet(_wallet);
  }

  String _senderCurrencyName() {
    return CurrencyFormatter.nameFromWallet(_wallet);
  }

  String _senderCurrencySymbol() {
    return _currencySymbol(_senderCurrency());
  }

  String _recipientFirstName() {
    final value = _recipient?['firstName'];

    if (value is String && value.isNotEmpty) {
      return value;
    }

    return '';
  }

  String _recipientLastName() {
    final value = _recipient?['lastName'];

    if (value is String && value.isNotEmpty) {
      return value;
    }

    return '';
  }

  String _recipientFullName() {
    final firstName = _recipientFirstName();
    final lastName = _recipientLastName();

    final fullName = '$firstName $lastName'.trim();

    if (fullName.isNotEmpty) {
      return fullName;
    }

    return 'Utilisateur P-Elsa';
  }

  String _recipientPhone() {
    final value = _recipient?['phone'];

    if (value is String && value.isNotEmpty) {
      return value;
    }

    return _phoneController.text.trim();
  }

  Map<String, dynamic>? _recipientWallet() {
    final wallet = _recipient?['wallet'];

    if (wallet is Map<String, dynamic>) {
      return wallet;
    }

    return null;
  }

  String _recipientCurrency() {
    return CurrencyFormatter.codeFromWallet(_recipientWallet());
  }

  String _recipientCurrencyName() {
    return CurrencyFormatter.nameFromWallet(_recipientWallet());
  }

  String _recipientCurrencySymbol() {
    return _currencySymbol(
      _recipientCurrency(),
    );
  }

  String _currencySymbol(String code) {
    return CurrencyFormatter.symbolFor(code);
  }

  String _initials() {
    final firstName = _recipientFirstName();
    final lastName = _recipientLastName();

    String result = '';

    if (firstName.isNotEmpty) {
      result += firstName[0];
    }

    if (lastName.isNotEmpty) {
      result += lastName[0];
    }

    if (result.isEmpty) {
      return 'P';
    }

    return result.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _showSummary
              ? 'Confirmation du transfert'
              : 'Transfert',
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
                  : _buildTransferForm(context),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTransferForm(BuildContext context) {
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
              Icons.send_outlined,
              size: 36,
              color: Theme.of(context)
                  .colorScheme
                  .primary,
            ),
          ),

          const SizedBox(height: 20),

          Text(
            'Envoyer de l’argent',
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
            'Saisissez le numéro du bénéficiaire '
                'et le montant à envoyer.',
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .bodyMedium,
          ),

          const SizedBox(height: 32),

          Text(
            'Bénéficiaire',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),

          const SizedBox(height: 12),

          TextFormField(
            controller: _phoneController,
            enabled: !_isLoading &&
                !_isLoadingWallet &&
                !_isProcessingTransfer,
            keyboardType: TextInputType.phone,
            textInputAction: TextInputAction.search,
            onChanged: (_) {
              if (_recipient != null) {
                setState(() {
                  _recipient = null;
                  _wallet = null;
                  _showSummary = false;
                });
              }
            },
            onFieldSubmitted: (_) {
              if (!_isLoading &&
                  !_isLoadingWallet) {
                _searchRecipient();
              }
            },
            decoration: const InputDecoration(
              labelText: 'Numéro de téléphone',
              hintText: '+243...',
              prefixIcon: Icon(
                Icons.phone_outlined,
              ),
              border: OutlineInputBorder(),
            ),
            validator: (value) {
              final phone = value?.trim() ?? '';

              if (phone.isEmpty) {
                return 'Veuillez saisir le numéro du bénéficiaire.';
              }

              if (phone.length < 9) {
                return 'Veuillez saisir un numéro valide.';
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
                  _isProcessingTransfer
                  ? null
                  : _searchRecipient,
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

          if (_recipient != null) ...[
            const SizedBox(height: 32),
            _buildRecipientCard(context),
          ],

          if (_recipient != null &&
              _wallet != null) ...[
            const SizedBox(height: 24),
            _buildAmountSection(context),
          ],

          const SizedBox(height: 24),

          Text(
            'Aucun argent ne sera envoyé tant que '
                'vous n’aurez pas confirmé le transfert.',
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _buildRecipientCard(
      BuildContext context,
      ) {
    final theme = Theme.of(context);

    final fullName = _recipientFullName();
    final phone = _recipientPhone();
    final currency = _recipientCurrency();
    final currencyName =
    _recipientCurrencyName();
    final currencySymbol =
    _recipientCurrencySymbol();

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
                        'Bénéficiaire trouvé',
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
              icon: Icons.phone_outlined,
              label: 'Téléphone',
              value: phone,
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
                          'bénéficiaire avant de continuer.',
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
    final currency = _senderCurrency();
    final symbol = _senderCurrencySymbol();
    final balance = _senderBalance();
    final currencyName =
    _senderCurrencyName();

    final isDifferentCurrency =
        _senderCurrency() !=
            _recipientCurrency();

    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment:
          CrossAxisAlignment.stretch,
          children: [
            Text(
              'Montant du transfert',
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
                            '${_senderCurrency()}, tandis que '
                            'celui du bénéficiaire est en '
                            '${_recipientCurrency()}. '
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
                    _isProcessingTransfer
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
    final balance = _senderBalance();
    final remainingBalance =
        balance - amount;
    final symbol =
    _senderCurrencySymbol();

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
          'Vérifiez votre transfert',
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
          'Aucun transfert n’a encore été effectué.',
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
                  'Bénéficiaire',
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
                  _recipientFullName(),
                ),

                const SizedBox(height: 14),

                _InfoRow(
                  icon: Icons.phone_outlined,
                  label: 'Téléphone',
                  value:
                  _recipientPhone(),
                ),

                const SizedBox(height: 14),

                _InfoRow(
                  icon: Icons
                      .account_balance_wallet_outlined,
                  label: 'Wallet',
                  value:
                  '${_recipientCurrencySymbol()} '
                      '${_recipientCurrency()}',
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
                  label: 'Montant envoyé',
                  value:
                  '$symbol ${_formatAmount(amount)}',
                ),

                const SizedBox(height: 12),

                _SummaryRow(
                  label: 'Frais de transfert',
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
                  'Solde après transfert',
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
                  'Le transfert sera exécuté uniquement '
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
            _isProcessingTransfer
                ? null
                : _confirmTransfer,
            icon: _isProcessingTransfer
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
              _isProcessingTransfer
                  ? 'Transfert en cours...'
                  : 'Confirmer le transfert',
            ),
          ),
        ),

        const SizedBox(height: 12),

        SizedBox(
          height: 52,
          child: OutlinedButton(
            onPressed:
            _isProcessingTransfer
                ? null
                : _editTransfer,
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