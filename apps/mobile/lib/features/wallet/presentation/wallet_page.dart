import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../core/api/api_client.dart';
import '../../../core/currency/currency_formatter.dart';
import '../../../core/storage/token_storage.dart';
import '../../../core/widgets/operation_success_dialog.dart';
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

  bool _isBalanceHidden = false;

  /// Devise de la dernière opération effectuée (dépôt/retrait), utilisée
  /// uniquement pour pré-remplir le sélecteur de devise des formulaires.
  /// L'affichage du dashboard, lui, montre toujours toutes les devises
  /// empilées sur une même carte.
  int _selectedBalanceIndex = 0;

  Map<String, dynamic>? _wallet;
  Map<String, dynamic>? _user;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  /// Recharge le wallet. Si `preferredCurrencyCode` est fourni (ex.
  /// juste après un dépôt dans une devise donnée), cette devise devient
  /// la devise pré-sélectionnée pour la prochaine opération ; sinon on
  /// revient à la première devise du wallet.
  Future<void> _loadWallet({
    String? preferredCurrencyCode,
  }) async {
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

      _selectBalanceForCurrency(preferredCurrencyCode);
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
    final balances = _balances();

    final currentCurrencyCode = CurrencyFormatter.codeFromWallet(
      balances[_selectedBalanceIndex],
    );

    final result =
    await Navigator.of(context).push<DepositResult>(
      MaterialPageRoute(
        builder: (_) => DepositPage(
          initialCurrencyCode: currentCurrencyCode,
        ),
      ),
    );

    if (!mounted || result == null) {
      return;
    }

    await _loadWallet(
      preferredCurrencyCode: result.currencyCode,
    );

    if (!mounted) {
      return;
    }

    final currencySymbol = CurrencyFormatter.symbolFor(
      result.currencyCode,
    );

    await OperationSuccessDialog.show(
      context,
      title: 'Dépôt effectué',
      message:
      '${CurrencyFormatter.formatAmount(result.amount)} '
          '${result.currencyCode} ont été déposés via '
          '${result.network}.',
      details: [
        MapEntry(
          'Nouveau solde',
          '$currencySymbol '
              '${CurrencyFormatter.formatAmount(result.balance)}',
        ),
      ],
    );
  }

  Future<void> _openWithdrawal() async {
    final balances = _balances();

    final currentCurrencyCode = CurrencyFormatter.codeFromWallet(
      balances[_selectedBalanceIndex],
    );

    final result =
    await Navigator.of(context).push<WithdrawalResult>(
      MaterialPageRoute(
        builder: (_) => WithdrawalPage(
          initialCurrencyCode: currentCurrencyCode,
          availableBalances: _availableBalances(balances),
        ),
      ),
    );

    if (!mounted || result == null) {
      return;
    }

    await _loadWallet(
      preferredCurrencyCode: result.currencyCode,
    );

    if (!mounted) {
      return;
    }

    final currencySymbol = CurrencyFormatter.symbolFor(
      result.currencyCode,
    );

    final details = [
      MapEntry(
        'Frais',
        '$currencySymbol '
            '${CurrencyFormatter.formatAmount(result.fee)}',
      ),
      MapEntry(
        'Nouveau solde',
        '$currencySymbol '
            '${CurrencyFormatter.formatAmount(result.balance)}',
      ),
    ];

    /// Le retrait peut rester en attente faute de solde marchand
    /// suffisant chez le fournisseur pour ce réseau : les fonds sont
    /// bloqués (le nouveau solde ci-dessus en tient déjà compte), mais
    /// le versement n'est pas encore finalisé. On l'indique clairement
    /// plutôt que d'afficher une confirmation trompeuse.
    if (result.pending) {
      await OperationSuccessDialog.show(
        context,
        title: 'Retrait en attente',
        message:
        '${CurrencyFormatter.formatAmount(result.amount)} '
            '${result.currencyCode} vers ${result.phone} via '
            '${result.network} sont en attente de traitement. '
            'Vous serez informé dès que le retrait sera finalisé.',
        details: details,
        icon: Icons.hourglass_top_outlined,
        iconColor: AppColors.warning,
      );

      return;
    }

    await OperationSuccessDialog.show(
      context,
      title: 'Retrait effectué',
      message:
      '${CurrencyFormatter.formatAmount(result.amount)} '
          '${result.currencyCode} ont été envoyés vers '
          '${result.phone} via ${result.network}.',
      details: details,
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

  /// Renvoie un solde par devise, à partir du tableau `balances`
  /// renvoyé par `/wallets/me` (voir wallet.mapper.ts côté backend).
  /// Si ce tableau est absent (ancienne réponse API), on retombe sur
  /// le solde unique placé à la racine, pour ne rien casser.
  List<Map<String, dynamic>> _balances() {
    final balances = _wallet?['balances'];

    if (balances is List) {
      final parsed = balances
          .whereType<Map<String, dynamic>>()
          .toList();

      if (parsed.isNotEmpty) {
        return parsed;
      }
    }

    return [
      {
        'balance': _wallet?['balance'],
        'currency': _wallet?['currency'],
      },
    ];
  }

  /// Convertit la liste de `_balances()` en une table simple
  /// { code devise -> solde } pour les écrans qui doivent valider un
  /// montant saisi par rapport au solde disponible (ex. retrait) sans
  /// avoir à connaître le format brut renvoyé par l'API.
  Map<String, double> _availableBalances(
      List<Map<String, dynamic>> balances,
      ) {
    return {
      for (final entry in balances)
        CurrencyFormatter.codeFromWallet(entry):
        CurrencyFormatter.parseAmount(entry['balance']),
    };
  }

  /// Retient `currencyCode` (celle de l'opération qui vient d'être
  /// effectuée) comme devise pré-sélectionnée pour la prochaine
  /// opération, ou revient à la première devise si `currencyCode` est
  /// absent ou introuvable.
  void _selectBalanceForCurrency(String? currencyCode) {
    final balances = _balances();

    var index = 0;

    if (currencyCode != null) {
      final match = balances.indexWhere(
            (entry) =>
        CurrencyFormatter.codeFromWallet(entry) == currencyCode,
      );

      if (match != -1) {
        index = match;
      }
    }

    setState(() {
      _selectedBalanceIndex = index;
    });
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

    final balances = _balances();

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

        const SizedBox(height: 4),

        Text(
          'Voici un aperçu de votre compte.',
          style: Theme.of(context).textTheme.bodyMedium,
        ),

        const SizedBox(height: 24),

        _buildBalancesCard(context, balances),

        const SizedBox(height: 28),

        Text(
          'Actions',
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(
            color: AppColors.textPrimary,
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
                iconColor: AppColors.success,
                backgroundColor: AppColors.successContainer,
              ),
            ),

            const SizedBox(width: 12),

            Expanded(
              child: _ActionCard(
                icon: Icons.arrow_upward,
                label: 'Retrait',
                onTap: _openWithdrawal,
                iconColor: AppColors.error,
                backgroundColor: AppColors.errorContainer,
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
                iconColor: AppColors.primary,
                backgroundColor: AppColors.primaryContainer,
              ),
            ),

            const SizedBox(width: 12),

            Expanded(
              child: _ActionCard(
                icon: Icons.history,
                label: 'Historique',
                onTap: _openTransactionHistory,
                iconColor: AppColors.textSecondary,
                backgroundColor: AppColors.surfaceVariant,
              ),
            ),
          ],
        ),

        const SizedBox(height: 12),

        // Actions pas encore développées (aperçu de mise en page
        // uniquement) : affichées comme les autres, mais estompées
        // et marquées "Bientôt" — au clic, un simple message plutôt
        // qu'une navigation, le temps de leur implémentation.
        Row(
          children: [
            Expanded(
              child: _ActionCard(
                icon: Icons.person_outline,
                label: 'Profil',
                onTap: () => _showComingSoon('Profil'),
                iconColor: AppColors.textSecondary,
                backgroundColor: AppColors.surfaceVariant,
                comingSoon: true,
              ),
            ),

            const SizedBox(width: 12),

            Expanded(
              child: _ActionCard(
                icon: Icons.credit_card_outlined,
                label: 'Paiement',
                onTap: () => _showComingSoon('Paiement'),
                iconColor: AppColors.textSecondary,
                backgroundColor: AppColors.surfaceVariant,
                comingSoon: true,
              ),
            ),
          ],
        ),

        const SizedBox(height: 12),

        Row(
          children: [
            Expanded(
              child: _ActionCard(
                icon: Icons.notifications_outlined,
                label: 'Notifications',
                onTap: () => _showComingSoon('Notifications'),
                iconColor: AppColors.textSecondary,
                backgroundColor: AppColors.surfaceVariant,
                comingSoon: true,
              ),
            ),

            const SizedBox(width: 12),

            Expanded(
              child: _ActionCard(
                icon: Icons.settings_outlined,
                label: 'Paramètres',
                onTap: () => _showComingSoon('Paramètres'),
                iconColor: AppColors.textSecondary,
                backgroundColor: AppColors.surfaceVariant,
                comingSoon: true,
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// Message affiché au clic sur une action pas encore développée
  /// (voir les `_ActionCard` avec `comingSoon: true` ci-dessus).
  void _showComingSoon(String label) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text('$label : bientôt disponible.'),
        ),
      );
  }

  /// Carte unique regroupant le solde de chaque devise du wallet, l'une
  /// au-dessus de l'autre (ex. USD en haut, CDF en dessous), plutôt
  /// qu'un carrousel à faire défiler. La carte garde toute la largeur
  /// disponible ; c'est sa hauteur (padding et espacements verticaux)
  /// qui est resserrée pour ne pas être trop imposante.
  Widget _buildBalancesCard(
      BuildContext context,
      List<Map<String, dynamic>> balances,
      ) {
    final orderedBalances = _sortedBalances(balances);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 16,
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.primary,
            AppColors.primaryDark,
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.28),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Solde disponible',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.85),
                  fontWeight: FontWeight.w500,
                ),
              ),

              InkWell(
                onTap: () {
                  setState(() {
                    _isBalanceHidden = !_isBalanceHidden;
                  });
                },
                borderRadius: BorderRadius.circular(20),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Icon(
                    _isBalanceHidden
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
                    color: Colors.white.withValues(alpha: 0.85),
                    size: 20,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 10),

          for (var i = 0; i < orderedBalances.length; i++) ...[
            if (i > 0) ...[
              const SizedBox(height: 8),
              Divider(
                color: Colors.white.withValues(alpha: 0.18),
                height: 1,
              ),
              const SizedBox(height: 8),
            ],
            _buildBalanceRow(context, orderedBalances[i]),
          ],
        ],
      ),
    );
  }

  /// Trie les soldes pour un affichage stable et prévisible : USD en
  /// premier, puis CDF (voir `CurrencyFormatter.selectableCurrencies`),
  /// puis toute autre devise éventuelle dans son ordre d'origine.
  List<Map<String, dynamic>> _sortedBalances(
      List<Map<String, dynamic>> balances,
      ) {
    final order = <String, int>{
      for (var i = 0;
      i < CurrencyFormatter.selectableCurrencies.length;
      i++)
        CurrencyFormatter.selectableCurrencies[i].key: i,
    };

    final sorted = List<Map<String, dynamic>>.from(balances);

    sorted.sort((a, b) {
      final indexA = order[CurrencyFormatter.codeFromWallet(a)] ??
          order.length;
      final indexB = order[CurrencyFormatter.codeFromWallet(b)] ??
          order.length;

      return indexA.compareTo(indexB);
    });

    return sorted;
  }

  /// Une ligne de la carte de solde : le symbole du dollar ($) pour
  /// l'USD, ou le code de la devise (ex. « CDF ») pour les autres,
  /// suivi du montant. Pas de libellé redondant en dessous.
  Widget _buildBalanceRow(
      BuildContext context,
      Map<String, dynamic> entry,
      ) {
    final balance = entry['balance'];
    final currencyCode = CurrencyFormatter.codeFromWallet(entry);

    final displaySymbol = currencyCode == 'USD'
        ? CurrencyFormatter.symbolFor(currencyCode)
        : currencyCode;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          displaySymbol,
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(
            color: Colors.white,
            fontWeight: FontWeight.w600,
          ),
        ),

        const SizedBox(width: 8),

        Flexible(
          child: _buildBalanceAmountText(context, balance),
        ),
      ],
    );
  }

  /// Affiche le montant du solde, flouté (au lieu de remplacé par
  /// des points) quand l'utilisateur a choisi de le masquer. Le
  /// texte réel reste dans l'arbre de widgets (juste flouté à
  /// l'écran), ce qui garde la largeur cohérente avec le montant
  /// réel plutôt qu'un nombre fixe de points.
  Widget _buildBalanceAmountText(
      BuildContext context,
      dynamic balance,
      ) {
    final amountText = Text(
      CurrencyFormatter.formatAmount(balance),
      overflow: TextOverflow.ellipsis,
      style: Theme.of(context)
          .textTheme
          .titleLarge
          ?.copyWith(
        color: Colors.white,
        fontWeight: FontWeight.bold,
      ),
    );

    if (!_isBalanceHidden) {
      return amountText;
    }

    return ImageFiltered(
      imageFilter: ui.ImageFilter.blur(
        sigmaX: 8,
        sigmaY: 8,
      ),
      child: amountText,
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.label,
    required this.onTap,
    required this.iconColor,
    required this.backgroundColor,
    this.comingSoon = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color iconColor;
  final Color backgroundColor;

  /// Vrai pour une action pas encore développée : affichée avec les
  /// autres (pour visualiser la mise en page complète, y compris les
  /// actions futures), mais estompée et marquée d'un badge "Bientôt".
  final bool comingSoon;

  @override
  Widget build(BuildContext context) {
    final card = Card(
      child: InkWell(
        onTap: onTap,
        borderRadius:
        BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            vertical: 20,
            horizontal: 12,
          ),
          child: Column(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: backgroundColor,
                ),
                child: Icon(
                  icon,
                  color: iconColor,
                  size: 24,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                label,
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );

    if (!comingSoon) {
      return card;
    }

    return Stack(
      children: [
        Opacity(
          opacity: 0.5,
          child: card,
        ),
        Positioned(
          top: 8,
          right: 8,
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 8,
              vertical: 3,
            ),
            decoration: BoxDecoration(
              color: AppColors.warningContainer,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              'Bientôt',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: AppColors.warning,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
