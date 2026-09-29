import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../core/api/api_client.dart';
import '../../../core/currency/currency_formatter.dart';
import '../../../core/storage/token_storage.dart';
import '../../../core/widgets/currency_toggle.dart';
import '../../../core/widgets/pin_dialog.dart';

class ExchangePage extends StatefulWidget {
  const ExchangePage({
    super.key,
    this.initialCurrencyCode = 'USD',
    this.availableBalances = const {},
  });

  /// Devise SOURCE pré-sélectionnée à l'ouverture de l'écran (ex. la
  /// devise actuellement affichée sur le dashboard).
  final String initialCurrencyCode;

  /// Solde disponible par devise (ex. { 'USD': 120.0, 'CDF': 50000.0 }),
  /// utilisé pour signaler un solde insuffisant dès la saisie du
  /// montant, sans attendre la confirmation.
  final Map<String, double> availableBalances;

  @override
  State<ExchangePage> createState() => _ExchangePageState();
}

class _ExchangePageState extends State<ExchangePage> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();

  final _apiClient = ApiClient();
  final _tokenStorage = TokenStorage();

  late String _fromCurrencyCode;

  bool _isLoading = false;
  bool _isLoadingRate = true;

  /// Taux de change SOURCE -> CIBLE courant (voir `_loadRate`), `null`
  /// tant qu'il n'a pas encore été chargé ou si le chargement a
  /// échoué.
  double? _rate;

  @override
  void initState() {
    super.initState();

    _fromCurrencyCode = CurrencyFormatter.selectableCurrencies.any(
      (entry) => entry.key == widget.initialCurrencyCode,
    )
        ? widget.initialCurrencyCode
        : CurrencyFormatter.selectableCurrencies.first.key;

    _loadRate();
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  /// L'autre devise supportée (voir
  /// CurrencyFormatter.selectableCurrencies, limité à USD et CDF pour
  /// l'instant) : c'est toujours celle vers laquelle on convertit.
  String get _toCurrencyCode {
    return CurrencyFormatter.selectableCurrencies
        .map((entry) => entry.key)
        .firstWhere((code) => code != _fromCurrencyCode);
  }

  double? get _amount {
    return double.tryParse(
      _amountController.text.trim(),
    );
  }

  /// Solde disponible pour la devise SOURCE actuellement sélectionnée.
  double get _availableBalance {
    return widget.availableBalances[_fromCurrencyCode] ?? 0;
  }

  /// Montant qui sera crédité dans la devise cible, calculé en local
  /// à titre indicatif : le montant réellement crédité (arrondi côté
  /// serveur) est celui renvoyé par `POST /exchange` à la
  /// confirmation.
  double? get _convertedAmount {
    final amount = _amount;
    final rate = _rate;

    if (amount == null || rate == null) {
      return null;
    }

    return amount * rate;
  }

  /// Charge le taux SOURCE -> CIBLE courant (voir
  /// `GET /exchange/rate`). Rejoué à chaque changement de devise
  /// source, puisque le sens de la conversion change avec elle.
  Future<void> _loadRate() async {
    setState(() {
      _isLoadingRate = true;
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

      final response = await _apiClient.get(
        '/exchange/rate?from=$_fromCurrencyCode&to=$_toCurrencyCode',
        token: token,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _rate = CurrencyFormatter.parseAmount(response['rate']);
        _isLoadingRate = false;
      });

      _formKey.currentState?.validate();
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _rate = null;
        _isLoadingRate = false;
      });
    }
  }

  void _swapCurrencies() {
    if (_isLoading) {
      return;
    }

    setState(() {
      _fromCurrencyCode = _toCurrencyCode;
    });

    _loadRate();
    _formKey.currentState?.validate();
  }

  Future<void> _submitExchange() async {
    if (_isLoading || _isLoadingRate) {
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

    if (_rate == null) {
      _showError(
        'Le taux de change est momentanément indisponible. Réessayez dans un instant.',
      );

      return;
    }

    await Future<void>.delayed(
      const Duration(milliseconds: 150),
    );

    if (!mounted) {
      return;
    }

    final pin = await PinDialog.show(
      context,
      title: 'Confirmer la conversion',
    );

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

      final fromCurrencyCode = _fromCurrencyCode;
      final toCurrencyCode = _toCurrencyCode;

      final response = await _apiClient.post(
        '/exchange',
        token: token,
        body: <String, dynamic>{
          'fromCurrencyCode': fromCurrencyCode,
          'toCurrencyCode': toCurrencyCode,
          'amount': amount,
          'pin': pin,
          'description':
          'Conversion $fromCurrencyCode -> $toCurrencyCode',
        },
      );

      if (!mounted) {
        return;
      }

      final balances = response['balances'];

      final fromBalance =
      balances is Map ? balances['from'] : null;

      final toBalance =
      balances is Map ? balances['to'] : null;

      Navigator.of(context).pop(
        ExchangeResult(
          fromCurrencyCode: fromCurrencyCode,
          toCurrencyCode: toCurrencyCode,
          amount: amount,
          convertedAmount: CurrencyFormatter.parseAmount(
            response['convertedAmount'],
          ),
          rate: CurrencyFormatter.parseAmount(response['rate']),
          fromBalance: fromBalance,
          toBalance: toBalance,
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
        'Impossible d’effectuer la conversion.',
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

  /// Affiche un taux sans décimales inutiles (ex. "2800" plutôt que
  /// "2800.0000"), mais garde jusqu'à 4 décimales pour un sens comme
  /// CDF -> USD où le taux est très inférieur à 1.
  String _formatRate(double rate) {
    if (rate == rate.roundToDouble()) {
      return rate.toStringAsFixed(0);
    }

    return rate.toStringAsFixed(4);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bureau de change'),
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
                      Icons.currency_exchange,
                      size: 64,
                      color: theme.colorScheme.primary,
                    ),

                    const SizedBox(height: 16),

                    Text(
                      'Convertir de l’argent',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),

                    const SizedBox(height: 8),

                    Text(
                      'Changez un montant entre vos soldes USD et '
                          'CDF, au taux du jour et sans frais.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium,
                    ),

                    const SizedBox(height: 32),

                    Row(
                      mainAxisAlignment:
                      MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Vous convertissez',
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),

                        TextButton.icon(
                          onPressed:
                          _isLoading ? null : _swapCurrencies,
                          icon: const Icon(
                            Icons.swap_vert,
                            size: 18,
                          ),
                          label: Text(
                            'Inverser vers $_toCurrencyCode',
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 4),

                    TextFormField(
                      controller: _amountController,
                      enabled: !_isLoading,
                      keyboardType:
                      const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      textInputAction: TextInputAction.done,
                      // Revalide à chaque frappe : le message "solde
                      // insuffisant" doit apparaître instantanément
                      // dès que le montant saisi dépasse le solde
                      // disponible, sans attendre la confirmation.
                      autovalidateMode:
                      AutovalidateMode.onUserInteraction,
                      onChanged: (_) {
                        setState(() {});
                      },
                      onFieldSubmitted: (_) {
                        if (!_isLoading) {
                          _submitExchange();
                        }
                      },
                      decoration: InputDecoration(
                        labelText: 'Montant',
                        hintText: 'Ex. 50',
                        prefixText:
                        '${CurrencyFormatter.compactLabel(
                          _fromCurrencyCode,
                        )} ',
                        suffix: CurrencyToggle(
                          selectedCurrencyCode: _fromCurrencyCode,
                          enabled: !_isLoading,
                          onChanged: (currencyCode) {
                            if (currencyCode == _fromCurrencyCode) {
                              return;
                            }

                            setState(() {
                              _fromCurrencyCode = currencyCode;
                            });

                            _loadRate();

                            // Le solde disponible dépend de la devise
                            // source : on force une revalidation
                            // immédiate pour que le message "solde
                            // insuffisant" tienne compte du
                            // changement.
                            _formKey.currentState?.validate();
                          },
                        ),
                        border: const OutlineInputBorder(),
                      ),
                      validator: (value) {
                        final text = value?.trim() ?? '';

                        if (text.isEmpty) {
                          return 'Veuillez saisir un montant.';
                        }

                        final amount = double.tryParse(text);

                        if (amount == null) {
                          return 'Veuillez saisir un montant valide.';
                        }

                        if (amount <= 0) {
                          return 'Le montant doit être supérieur à zéro.';
                        }

                        if (amount > _availableBalance) {
                          return 'Solde insuffisant. Disponible : '
                              '${CurrencyFormatter.compactLabel(_fromCurrencyCode)} '
                              '${CurrencyFormatter.formatAmount(_availableBalance)}.';
                        }

                        return null;
                      },
                    ),

                    const SizedBox(height: 24),

                    Card(
                      elevation: 0,
                      color: AppColors.surfaceVariant,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          children: [
                            _SummaryRow(
                              label: 'Taux',
                              value: _isLoadingRate
                                  ? 'Chargement...'
                                  : (_rate == null
                                  ? 'Indisponible'
                                  : '1 ${CurrencyFormatter.compactLabel(_fromCurrencyCode)} '
                                  '= ${_formatRate(_rate!)} '
                                  '${CurrencyFormatter.compactLabel(_toCurrencyCode)}'),
                            ),

                            const Divider(height: 24),

                            _SummaryRow(
                              label: 'Vous recevrez',
                              value: _convertedAmount == null
                                  ? '—'
                                  : '${CurrencyFormatter.compactLabel(_toCurrencyCode)} '
                                  '${CurrencyFormatter.formatAmount(_convertedAmount)}',
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
                        onPressed:
                        (_isLoading || _isLoadingRate || _rate == null)
                            ? null
                            : _submitExchange,
                        child: _isLoading
                            ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                            : const Text(
                          'Confirmer la conversion',
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    Text(
                      'Aucun frais pour l’instant : vous recevez '
                          'exactement le montant converti au taux du '
                          'jour.',
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
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
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

class ExchangeResult {
  const ExchangeResult({
    required this.fromCurrencyCode,
    required this.toCurrencyCode,
    required this.amount,
    required this.convertedAmount,
    required this.rate,
    required this.fromBalance,
    required this.toBalance,
  });

  final String fromCurrencyCode;
  final String toCurrencyCode;
  final double amount;
  final double convertedAmount;
  final double rate;
  final dynamic fromBalance;
  final dynamic toBalance;
}
