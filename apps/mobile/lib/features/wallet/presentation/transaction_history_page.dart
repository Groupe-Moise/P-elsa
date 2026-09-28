import 'package:flutter/material.dart';

import '../../../core/api/api_client.dart';
import '../../../core/storage/token_storage.dart';

class TransactionHistoryPage extends StatefulWidget {
  const TransactionHistoryPage({
    super.key,
  });

  @override
  State<TransactionHistoryPage> createState() =>
      _TransactionHistoryPageState();
}

class _TransactionHistoryPageState
    extends State<TransactionHistoryPage> {
  final _apiClient = ApiClient();
  final _tokenStorage = TokenStorage();

  bool _isLoading = true;
  String? _errorMessage;

  List<Map<String, dynamic>> _transactions = [];

  @override
  void initState() {
    super.initState();
    _loadTransactions();
  }

  Future<void> _loadTransactions() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
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
        '/transactions/me',
        token: token,
      );

      if (!mounted) {
        return;
      }

      final transactions = response['data'];

      if (transactions is List) {
        setState(() {
          _transactions = transactions
              .whereType<Map<String, dynamic>>()
              .toList();
          _isLoading = false;
        });

        return;
      }

      setState(() {
        _transactions = [];
        _isLoading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = error.message;
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage =
        'Impossible de charger votre historique.';
        _isLoading = false;
      });
    }
  }

  String _transactionType(
      Map<String, dynamic> transaction,
      ) {
    final type = transaction['type'];

    switch (type) {
      case 'DEPOSIT':
        return 'Dépôt';

      case 'WITHDRAWAL':
        return 'Retrait';

      case 'TRANSFER':
        final senderUserId =
        transaction['senderUserId'];

        final receiverUserId =
        transaction['receiverUserId'];

        final currentUserId =
        transaction['_currentUserId'];

        if (currentUserId != null &&
            senderUserId == currentUserId) {
          return 'Transfert envoyé';
        }

        if (currentUserId != null &&
            receiverUserId == currentUserId) {
          return 'Transfert reçu';
        }

        return 'Transfert';

      default:
        return type is String && type.isNotEmpty
            ? type
            : 'Transaction';
    }
  }

  IconData _transactionIcon(
      Map<String, dynamic> transaction,
      ) {
    switch (transaction['type']) {
      case 'DEPOSIT':
        return Icons.arrow_downward;

      case 'WITHDRAWAL':
        return Icons.arrow_upward;

      case 'TRANSFER':
        return Icons.swap_horiz;

      default:
        return Icons.receipt_long_outlined;
    }
  }

  bool _isIncoming(
      Map<String, dynamic> transaction,
      ) {
    final type = transaction['type'];

    if (type == 'DEPOSIT') {
      return true;
    }

    if (type == 'WITHDRAWAL') {
      return false;
    }

    if (type == 'TRANSFER') {
      final senderUserId =
      transaction['senderUserId'];

      final receiverUserId =
      transaction['receiverUserId'];

      final currentUserId =
      transaction['_currentUserId'];

      if (currentUserId != null &&
          receiverUserId == currentUserId) {
        return true;
      }

      if (currentUserId != null &&
          senderUserId == currentUserId) {
        return false;
      }
    }

    return false;
  }

  double _parseAmount(dynamic value) {
    if (value == null) {
      return 0;
    }

    return double.tryParse(
      value.toString(),
    ) ??
        0;
  }

  String _formatAmount(dynamic amount) {
    return _parseAmount(amount)
        .toStringAsFixed(2);
  }

  String _formatFee(dynamic fee) {
    return _parseAmount(fee)
        .toStringAsFixed(2);
  }

  String _currencyCode(
      Map<String, dynamic> transaction,
      ) {
    Map<String, dynamic>? wallet;

    if (transaction['type'] == 'DEPOSIT') {
      final receiverWallet =
      transaction['receiverWallet'];

      if (receiverWallet
      is Map<String, dynamic>) {
        wallet = receiverWallet;
      }
    } else {
      final senderWallet =
      transaction['senderWallet'];

      if (senderWallet
      is Map<String, dynamic>) {
        wallet = senderWallet;
      }
    }

    final currency = wallet?['currency'];

    if (currency is Map<String, dynamic>) {
      final code = currency['code'];

      if (code is String && code.isNotEmpty) {
        return code;
      }
    }

    return 'USD';
  }

  String _currencySymbol(
      String currencyCode,
      ) {
    switch (currencyCode) {
      case 'USD':
        return '\$';

      case 'CDF':
        return 'FC';

      case 'ZMW':
        return 'ZK';

      case 'XAF':
        return 'FCFA';

      default:
        return currencyCode;
    }
  }

  String _formatDate(dynamic value) {
    if (value == null) {
      return 'Date inconnue';
    }

    final date = DateTime.tryParse(
      value.toString(),
    );

    if (date == null) {
      return 'Date inconnue';
    }

    final localDate = date.toLocal();

    final day =
    localDate.day.toString().padLeft(2, '0');

    final month =
    localDate.month.toString().padLeft(2, '0');

    final year =
    localDate.year.toString();

    final hour =
    localDate.hour.toString().padLeft(2, '0');

    final minute =
    localDate.minute.toString().padLeft(2, '0');

    return '$day/$month/$year à $hour:$minute';
  }

  String _statusLabel(dynamic status) {
    switch (status) {
      case 'COMPLETED':
        return 'Terminée';

      case 'PENDING':
        return 'En attente';

      case 'FAILED':
        return 'Échouée';

      case 'CANCELLED':
        return 'Annulée';

      default:
        return status is String && status.isNotEmpty
            ? status
            : 'Inconnu';
    }
  }

  Color _statusColor(
      BuildContext context,
      dynamic status,
      ) {
    switch (status) {
      case 'COMPLETED':
        return Colors.green;

      case 'PENDING':
        return Colors.orange;

      case 'FAILED':
      case 'CANCELLED':
        return Theme.of(context)
            .colorScheme
            .error;

      default:
        return Theme.of(context)
            .colorScheme
            .onSurfaceVariant;
    }
  }

  String _reference(
      Map<String, dynamic> transaction,
      ) {
    final reference =
    transaction['reference'];

    if (reference is String &&
        reference.isNotEmpty) {
      return reference;
    }

    return 'Référence inconnue';
  }

  String _description(
      Map<String, dynamic> transaction,
      ) {
    final description =
    transaction['description'];

    if (description is String &&
        description.trim().isNotEmpty) {
      return description.trim();
    }

    switch (transaction['type']) {
      case 'DEPOSIT':
        return 'Dépôt sur le wallet';

      case 'WITHDRAWAL':
        return 'Retrait du wallet';

      case 'TRANSFER':
        return 'Transfert entre utilisateurs';

      default:
        return 'Transaction P-Elsa';
    }
  }

  Future<void> _showTransactionDetails(
      Map<String, dynamic> transaction,
      ) async {
    final currencyCode =
    _currencyCode(transaction);

    final currencySymbol =
    _currencySymbol(currencyCode);

    final amount =
    _formatAmount(transaction['amount']);

    final fee =
    _formatFee(transaction['fee']);

    final totalAmount =
    _formatAmount(transaction['totalAmount']);

    final status =
    transaction['status'];

    final incoming =
    _isIncoming(transaction);

    if (!mounted) {
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) {
        return SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(
              24,
              8,
              24,
              32,
            ),
            child: Column(
              crossAxisAlignment:
              CrossAxisAlignment.stretch,
              children: [
                Text(
                  _transactionType(transaction),
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),

                const SizedBox(height: 8),

                Text(
                  _description(transaction),
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium,
                ),

                const SizedBox(height: 24),

                _DetailRow(
                  label: 'Montant',
                  value:
                  '$currencySymbol $amount',
                ),

                const SizedBox(height: 12),

                _DetailRow(
                  label: 'Frais',
                  value:
                  '$currencySymbol $fee',
                ),

                const SizedBox(height: 12),

                _DetailRow(
                  label: 'Total',
                  value:
                  '$currencySymbol $totalAmount',
                ),

                const SizedBox(height: 12),

                _DetailRow(
                  label: 'Devise',
                  value: currencyCode,
                ),

                const SizedBox(height: 12),

                _DetailRow(
                  label: 'Statut',
                  value: _statusLabel(status),
                  valueColor:
                  _statusColor(context, status),
                ),

                const SizedBox(height: 12),

                _DetailRow(
                  label: 'Date',
                  value: _formatDate(
                    transaction['createdAt'],
                  ),
                ),

                const SizedBox(height: 12),

                _DetailRow(
                  label: 'Référence',
                  value:
                  _reference(transaction),
                ),

                const SizedBox(height: 12),

                _DetailRow(
                  label: 'Sens',
                  value: incoming
                      ? 'Entrant'
                      : 'Sortant',
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildTransactionItem(
      BuildContext context,
      Map<String, dynamic> transaction,
      ) {
    final incoming =
    _isIncoming(transaction);

    final currencyCode =
    _currencyCode(transaction);

    final currencySymbol =
    _currencySymbol(currencyCode);

    final amount =
    _formatAmount(transaction['amount']);

    final status =
    transaction['status'];

    final type =
    _transactionType(transaction);

    final icon =
    _transactionIcon(transaction);

    final amountPrefix =
    incoming ? '+' : '-';

    final statusColor =
    _statusColor(context, status);

    return Card(
      margin: const EdgeInsets.only(
        bottom: 12,
      ),
      child: InkWell(
        onTap: () {
          _showTransactionDetails(
            transaction,
          );
        },
        borderRadius:
        BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: incoming
                      ? Colors.green.withValues(
                    alpha: 0.12,
                  )
                      : Theme.of(context)
                      .colorScheme
                      .error
                      .withValues(
                    alpha: 0.12,
                  ),
                ),
                child: Icon(
                  icon,
                  color: incoming
                      ? Colors.green
                      : Theme.of(context)
                      .colorScheme
                      .error,
                ),
              ),

              const SizedBox(width: 14),

              Expanded(
                child: Column(
                  crossAxisAlignment:
                  CrossAxisAlignment.start,
                  children: [
                    Text(
                      type,
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(
                        fontWeight:
                        FontWeight.w600,
                      ),
                    ),

                    const SizedBox(height: 4),

                    Text(
                      _formatDate(
                        transaction['createdAt'],
                      ),
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall,
                    ),

                    const SizedBox(height: 6),

                    Container(
                      padding:
                      const EdgeInsets
                          .symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration:
                      BoxDecoration(
                        color: statusColor
                            .withValues(
                          alpha: 0.10,
                        ),
                        borderRadius:
                        BorderRadius.circular(
                          20,
                        ),
                      ),
                      child: Text(
                        _statusLabel(status),
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight:
                          FontWeight.w600,
                          color: statusColor,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(width: 12),

              Column(
                crossAxisAlignment:
                CrossAxisAlignment.end,
                children: [
                  Text(
                    '$amountPrefix'
                        '$currencySymbol '
                        '$amount',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(
                      fontWeight:
                      FontWeight.bold,
                    ),
                  ),

                  const SizedBox(height: 4),

                  Text(
                    currencyCode,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return ListView(
        physics:
        const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 250),
          Center(
            child:
            CircularProgressIndicator(),
          ),
        ],
      );
    }

    if (_errorMessage != null) {
      return ListView(
        physics:
        const AlwaysScrollableScrollPhysics(),
        padding:
        const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 150),

          const Icon(
            Icons.error_outline,
            size: 56,
          ),

          const SizedBox(height: 16),

          Text(
            _errorMessage!,
            textAlign: TextAlign.center,
          ),

          const SizedBox(height: 24),

          Center(
            child: ElevatedButton(
              onPressed: _loadTransactions,
              child:
              const Text('Réessayer'),
            ),
          ),
        ],
      );
    }

    if (_transactions.isEmpty) {
      return RefreshIndicator(
        onRefresh: _loadTransactions,
        child: ListView(
          physics:
          const AlwaysScrollableScrollPhysics(),
          children: [
            const SizedBox(height: 180),

            Icon(
              Icons.receipt_long_outlined,
              size: 64,
              color: Theme.of(context)
                  .colorScheme
                  .onSurfaceVariant,
            ),

            const SizedBox(height: 20),

            Text(
              'Aucune transaction',
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(
                fontWeight:
                FontWeight.w600,
              ),
            ),

            const SizedBox(height: 8),

            Text(
              'Vos dépôts, retraits et transferts '
                  'apparaîtront ici.',
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium,
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadTransactions,
      child: ListView.builder(
        physics:
        const AlwaysScrollableScrollPhysics(),
        padding:
        const EdgeInsets.all(24),
        itemCount: _transactions.length,
        itemBuilder: (
            context,
            index,
            ) {
          return _buildTransactionItem(
            context,
            _transactions[index],
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title:
        const Text('Historique'),
      ),
      body: _buildBody(),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.valueColor,
  });

  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment:
      CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: Theme.of(context)
                .textTheme
                .bodyMedium,
          ),
        ),
        const SizedBox(width: 16),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(
              fontWeight:
              FontWeight.w600,
              color: valueColor,
            ),
          ),
        ),
      ],
    );
  }
}