import 'package:flutter/material.dart';

import '../../../core/api/api_client.dart';
import '../../../core/storage/token_storage.dart';
import 'deposit_page.dart';
import 'transaction_history_page.dart';
import 'transfer_page.dart';
import 'withdrawal_page.dart';

class WalletPage extends StatefulWidget {
  const WalletPage({
    super.key,
  });

  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  final _apiClient = ApiClient();
  final _tokenStorage = TokenStorage();

  bool _isLoading = true;
  String? _errorMessage;

  Map<String, dynamic>? _wallet;
  Map<String, dynamic>? _user;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  Future<void> _loadWallet() async {
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

        Navigator.of(context).pushReplacementNamed('/login');
        return;
      }

      final response = await _apiClient.get(
        '/wallets/me',
        token: token,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _wallet = response;
        _user = response['user'] is Map<String, dynamic>
            ? response['user'] as Map<String, dynamic>
            : null;
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
        'Impossible de charger votre wallet.';
        _isLoading = false;
      });
    }
  }

  Future<void> _logout() async {
    await _tokenStorage.deleteAccessToken();

    if (!mounted) {
      return;
    }

    Navigator.of(context).pushNamedAndRemoveUntil(
      '/login',
          (route) => false,
    );
  }

  Future<void> _openDeposit() async {
    final result =
    await Navigator.of(context).push<DepositResult>(
      MaterialPageRoute(
        builder: (_) => const DepositPage(),
      ),
    );

    if (!mounted || result == null) {
      return;
    }

    await _loadWallet();

    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            'Dépôt de ${result.amount.toStringAsFixed(2)} '
                'via ${result.network} effectué avec succès.',
          ),
        ),
      );
  }

  Future<void> _openWithdrawal() async {
    final result =
    await Navigator.of(context).push<WithdrawalResult>(
      MaterialPageRoute(
        builder: (_) => const WithdrawalPage(),
      ),
    );

    if (!mounted || result == null) {
      return;
    }

    await _loadWallet();

    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            'Retrait de ${result.amount.toStringAsFixed(2)} '
                'vers ${result.phone} effectué avec succès. '
                'Frais : ${result.fee.toStringAsFixed(2)}.',
          ),
        ),
      );
  }

  Future<void> _openTransfer() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => const TransferPage(),
      ),
    );

    if (!mounted) {
      return;
    }

    await _loadWallet();
  }

  Future<void> _openTransactionHistory() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => const TransactionHistoryPage(),
      ),
    );
  }

  String _formatBalance(dynamic balance) {
    if (balance == null) {
      return '0.00';
    }

    final value = double.tryParse(
      balance.toString(),
    );

    if (value == null) {
      return '0.00';
    }

    return value.toStringAsFixed(2);
  }

  String _currencyCode() {
    final currency = _wallet?['currency'];

    if (currency is Map<String, dynamic>) {
      final code = currency['code'];

      if (code is String && code.isNotEmpty) {
        return code;
      }
    }

    return 'USD';
  }

  String _currencySymbol() {
    switch (_currencyCode()) {
      case 'USD':
        return '\$';

      case 'CDF':
        return 'FC';

      case 'ZMW':
        return 'ZK';

      case 'XAF':
        return 'FCFA';

      default:
        return _currencyCode();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mon Wallet'),
        actions: [
          IconButton(
            tooltip: 'Déconnexion',
            onPressed: _logout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadWallet,
        child: _buildBody(),
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
            child: CircularProgressIndicator(),
          ),
        ],
      );
    }

    if (_errorMessage != null) {
      return ListView(
        physics:
        const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
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
              onPressed: _loadWallet,
              child: const Text('Réessayer'),
            ),
          ),
        ],
      );
    }

    final firstName = _user?['firstName'];

    final displayName =
    firstName is String && firstName.isNotEmpty
        ? firstName
        : 'Utilisateur';

    return ListView(
      physics:
      const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          'Bonjour, $displayName',
          style: Theme.of(context)
              .textTheme
              .headlineSmall
              ?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),

        const SizedBox(height: 24),

        Card(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment:
              CrossAxisAlignment.start,
              children: [
                Text(
                  'Solde disponible',
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium,
                ),

                const SizedBox(height: 12),

                Row(
                  crossAxisAlignment:
                  CrossAxisAlignment.end,
                  children: [
                    Text(
                      _currencySymbol(),
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),

                    const SizedBox(width: 8),

                    Text(
                      _formatBalance(
                        _wallet?['balance'],
                      ),
                      style: Theme.of(context)
                          .textTheme
                          .displaySmall
                          ?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 8),

                Text(
                  _currencyCode(),
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall,
                ),
              ],
            ),
          ),
        ),

        const SizedBox(height: 24),

        const Text(
          'Actions',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),

        const SizedBox(height: 12),

        Row(
          children: [
            Expanded(
              child: _ActionCard(
                icon: Icons.add_circle_outline,
                label: 'Dépôt',
                onTap: _openDeposit,
              ),
            ),

            const SizedBox(width: 12),

            Expanded(
              child: _ActionCard(
                icon: Icons.arrow_upward,
                label: 'Retrait',
                onTap: _openWithdrawal,
              ),
            ),
          ],
        ),

        const SizedBox(height: 12),

        Row(
          children: [
            Expanded(
              child: _ActionCard(
                icon: Icons.send_outlined,
                label: 'Transfert',
                onTap: _openTransfer,
              ),
            ),

            const SizedBox(width: 12),

            Expanded(
              child: _ActionCard(
                icon: Icons.history,
                label: 'Historique',
                onTap: _openTransactionHistory,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius:
        BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            vertical: 20,
            horizontal: 12,
          ),
          child: Column(
            children: [
              Icon(
                icon,
                size: 30,
              ),
              const SizedBox(height: 8),
              Text(label),
            ],
          ),
        ),
      ),
    );
  }
}