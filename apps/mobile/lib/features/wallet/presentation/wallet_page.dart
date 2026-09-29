import 'dart:async';
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

  /// Transactions de l'utilisateur (dépôts, retraits, transferts),
  /// utilisées pour l'aperçu "Transactions récentes" et le résumé des
  /// dépenses du mois sur cet écran. La liste complète et détaillée
  /// reste sur `TransactionHistoryPage`.
  List<Map<String, dynamic>> _transactions = [];

  final PageController _promoPageController = PageController();

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  @override
  void dispose() {
    _promoPageController.dispose();
    super.dispose();
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

      // Chargée séparément : une panne ici ne doit pas empêcher
      // d'afficher le wallet (l'aperçu "Transactions récentes" et le
      // résumé des dépenses disparaissent simplement si elle échoue).
      unawaited(_loadRecentTransactions(token));
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

  /// Alimente l'aperçu "Transactions récentes" et le résumé des
  /// dépenses du mois (voir `_buildRecentTransactionsPreview` et
  /// `_buildSpendingSummary`). Silencieuse en cas d'échec : ces deux
  /// blocs disparaissent simplement plutôt que de bloquer l'écran.
  Future<void> _loadRecentTransactions(String token) async {
    try {
      final response = await _apiClient.get(
        '/transactions/me',
        token: token,
      );

      if (!mounted) {
        return;
      }

      final transactions = response['data'];

      setState(() {
        _transactions = transactions is List
            ? transactions.whereType<Map<String, dynamic>>().toList()
            : [];
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _transactions = [];
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

  /// Libellé court d'un type de transaction pour l'aperçu de l'accueil
  /// (version compacte de la logique équivalente dans
  /// `TransactionHistoryPage`, qui reste la référence pour le détail).
  String _transactionTypeLabel(Map<String, dynamic> transaction) {
    switch (transaction['type']) {
      case 'DEPOSIT':
        return 'Dépôt';
      case 'WITHDRAWAL':
        return 'Retrait';
      case 'TRANSFER':
        return _isIncomingTransaction(transaction)
            ? 'Transfert reçu'
            : 'Transfert envoyé';
      default:
        return 'Transaction';
    }
  }

  IconData _transactionIcon(Map<String, dynamic> transaction) {
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

  bool _isIncomingTransaction(Map<String, dynamic> transaction) {
    final type = transaction['type'];

    if (type == 'DEPOSIT') {
      return true;
    }

    if (type == 'WITHDRAWAL') {
      return false;
    }

    if (type == 'TRANSFER') {
      return transaction['receiverUserId'] == _user?['id'];
    }

    return false;
  }

  String _transactionCurrencyCode(Map<String, dynamic> transaction) {
    final wallet = transaction['type'] == 'DEPOSIT'
        ? transaction['receiverWallet']
        : transaction['senderWallet'];

    return CurrencyFormatter.codeFromWallet(
      wallet is Map<String, dynamic> ? wallet : null,
    );
  }

  /// Total des sorties d'argent (retraits + transferts envoyés) du
  /// mois en cours, groupé par devise — aperçu indicatif affiché sur
  /// l'accueil (voir `_buildSpendingSummary`), pas un relevé complet.
  /// Les deux devises supportées (USD, CDF) sont toujours incluses,
  /// même à 0, pour que le résumé les affiche systématiquement toutes
  /// les deux.
  Map<String, double> _monthlySpendingByCurrency() {
    final now = DateTime.now();

    final totals = <String, double>{
      for (final currency in CurrencyFormatter.selectableCurrencies)
        currency.key: 0,
    };

    for (final transaction in _transactions) {
      if (transaction['status'] != 'COMPLETED') {
        continue;
      }

      if (_isIncomingTransaction(transaction)) {
        continue;
      }

      final createdAt = DateTime.tryParse(
        transaction['createdAt']?.toString() ?? '',
      );

      if (createdAt == null ||
          createdAt.year != now.year ||
          createdAt.month != now.month) {
        continue;
      }

      final currencyCode = _transactionCurrencyCode(transaction);
      final amount = CurrencyFormatter.parseAmount(transaction['amount']);

      totals[currencyCode] = (totals[currencyCode] ?? 0) + amount;
    }

    return totals;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Profil (compte non vérifié)',
          onPressed: () => _showComingSoon('Profil'),
          icon: Stack(
            clipBehavior: Clip.none,
            children: [
              const Icon(Icons.person_outline),
              // Point rouge : indique que le compte n'est pas encore
              // vérifié (aucune vérification d'identité n'est encore
              // implémentée côté backend). À retirer une fois le
              // statut réel branché sur le KYC.
              Positioned(
                top: -2,
                right: -2,
                child: Container(
                  width: 9,
                  height: 9,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.error,
                  ),
                ),
              ),
            ],
          ),
        ),
        title: const Text('Mon Wallet'),
        actions: [
          IconButton(
            tooltip: 'Notifications',
            onPressed: () => _showComingSoon('Notifications'),
            icon: const Icon(Icons.notifications_outlined),
          ),
          PopupMenuButton<_SettingsAction>(
            tooltip: 'Paramètres',
            icon: const Icon(Icons.settings_outlined),
            onSelected: (action) {
              switch (action) {
                case _SettingsAction.logout:
                  _logout();
              }
            },
            itemBuilder: (context) => const [
              PopupMenuItem(
                value: _SettingsAction.logout,
                child: ListTile(
                  leading: Icon(Icons.logout),
                  title: Text('Déconnexion'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ],
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

        const SizedBox(height: 20),

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

        // Grille resserrée à 3 colonnes (cartes plus compactes, voir
        // `_ActionCard`) : l'historique a été déplacé à côté de l'icône
        // "œil" sur la carte de solde (voir `_buildBalancesCard`), donc
        // il n'apparaît plus ici. Profil, Notifications et Paramètres
        // restent dans l'en-tête.
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

            const SizedBox(width: 10),

            Expanded(
              child: _ActionCard(
                icon: Icons.arrow_upward,
                label: 'Retrait',
                onTap: _openWithdrawal,
                iconColor: AppColors.error,
                backgroundColor: AppColors.errorContainer,
              ),
            ),

            const SizedBox(width: 10),

            Expanded(
              child: _ActionCard(
                icon: Icons.send_outlined,
                label: 'Transfert',
                onTap: _openTransfer,
                iconColor: AppColors.primary,
                backgroundColor: AppColors.primaryContainer,
              ),
            ),
          ],
        ),

        const SizedBox(height: 10),

        // Actions pas encore développées (aperçu de mise en page
        // uniquement, phase de conception : pas de badge "Bientôt"
        // pour l'instant, pour juger du rendu final).
        Row(
          children: [
            Expanded(
              child: _ActionCard(
                icon: Icons.credit_card_outlined,
                label: 'Paiement',
                onTap: () => _showComingSoon('Paiement'),
                iconColor: AppColors.textSecondary,
                backgroundColor: AppColors.surfaceVariant,
              ),
            ),

            const SizedBox(width: 10),

            Expanded(
              child: _ActionCard(
                icon: Icons.currency_exchange,
                label: 'Bureau de change',
                onTap: () => _showComingSoon('Bureau de change'),
                iconColor: AppColors.textSecondary,
                backgroundColor: AppColors.surfaceVariant,
              ),
            ),

            const SizedBox(width: 10),

            Expanded(
              child: _ActionCard(
                icon: Icons.qr_code,
                label: 'Recevoir',
                onTap: () => _showComingSoon('Recevoir de l’argent par QR code'),
                iconColor: AppColors.textSecondary,
                backgroundColor: AppColors.surfaceVariant,
              ),
            ),
          ],
        ),

        const SizedBox(height: 28),

        _buildSectionTitle(context, 'Envoyer à...'),

        const SizedBox(height: 12),

        _buildQuickSendRow(context),

        const SizedBox(height: 28),

        _buildPromoCarousel(context),

        const SizedBox(height: 20),

        _buildExchangeRateCard(context),

        const SizedBox(height: 28),

        _buildSpendingSummary(context),

        const SizedBox(height: 28),

        _buildRecentTransactionsSection(context),
      ],
    );
  }

  Widget _buildSectionTitle(BuildContext context, String title) {
    return Text(
      title,
      style: Theme.of(context).textTheme.titleMedium?.copyWith(
        color: AppColors.textPrimary,
      ),
    );
  }

  /// Message affiché au clic sur une action pas encore développée.
  void _showComingSoon(String label) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text('$label : bientôt disponible.'),
        ),
      );
  }

  /// Raccourci vers les destinataires récents/favoris, comme sur les
  /// wallets grand public : un tap envoie directement vers le
  /// transfert. Aucun favori réel n'est encore mémorisé côté backend,
  /// donc les avatars sont génériques pour l'instant (aperçu de mise
  /// en page).
  Widget _buildQuickSendRow(BuildContext context) {
    return SizedBox(
      height: 84,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          _QuickSendAvatar(
            icon: Icons.add,
            label: 'Nouveau',
            isAddButton: true,
            onTap: _openTransfer,
          ),
          for (var i = 0; i < 4; i++)
            _QuickSendAvatar(
              icon: Icons.person_outline,
              label: 'Contact',
              onTap: _openTransfer,
            ),
        ],
      ),
    );
  }

  /// Carrousel d'annonces (nouveautés, futures fonctionnalités) : trois
  /// cartes statiques pour visualiser l'emplacement, à connecter plus
  /// tard à un vrai contenu (annonces gérées côté back-office, par
  /// exemple).
  Widget _buildPromoCarousel(BuildContext context) {
    final slides = [
      _PromoSlideData(
        icon: Icons.celebration_outlined,
        title: 'Bienvenue sur P-Elsa',
        message:
        'Gérez vos dépôts, retraits et transferts en toute simplicité.',
        color: AppColors.primary,
        backgroundColor: AppColors.primaryContainer,
      ),
      _PromoSlideData(
        icon: Icons.currency_exchange,
        title: 'Bureau de change',
        message: 'Bientôt : échangez USD et CDF directement dans l’app.',
        color: AppColors.success,
        backgroundColor: AppColors.successContainer,
      ),
      _PromoSlideData(
        icon: Icons.card_giftcard_outlined,
        title: 'Parrainez vos proches',
        message: 'Bientôt : invitez vos proches et gagnez des récompenses.',
        color: AppColors.warning,
        backgroundColor: AppColors.warningContainer,
      ),
    ];

    return SizedBox(
      height: 120,
      child: PageView.builder(
        controller: _promoPageController,
        itemCount: slides.length,
        itemBuilder: (context, index) {
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: _PromoSlide(data: slides[index]),
          );
        },
      ),
    );
  }

  /// Taux de change indicatif USD/CDF. Valeur fixe pour l'instant
  /// (aperçu de mise en page) : à brancher sur un vrai taux une fois
  /// le bureau de change développé côté backend.
  Widget _buildExchangeRateCard(BuildContext context) {
    return Card(
      elevation: 0,
      color: AppColors.surfaceVariant,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _showComingSoon('Bureau de change'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(
                Icons.currency_exchange,
                color: AppColors.textSecondary,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '1 \$ ≈ 2 800 CDF',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Taux indicatif du jour',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right,
                color: AppColors.textSecondary,
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Résumé des sorties d'argent du mois en cours (voir
  /// `_monthlySpendingByCurrency`) : un aperçu indicatif, pas un
  /// relevé comptable complet. N'affiche rien tant qu'aucune
  /// transaction du mois n'est disponible.
  Widget _buildSpendingSummary(BuildContext context) {
    final totals = _monthlySpendingByCurrency();

    if (totals.isEmpty) {
      return const SizedBox.shrink();
    }

    final monthLabel = _capitalize(
      _monthName(DateTime.now().month),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle(context, 'Dépenses de $monthLabel'),
        const SizedBox(height: 12),
        Card(
          elevation: 0,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                for (final entry in totals.entries) ...[
                  if (entry.key != totals.entries.first.key)
                    const Divider(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        entry.key,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      Text(
                        '${CurrencyFormatter.compactLabel(entry.key)} '
                            '${CurrencyFormatter.formatAmount(entry.value)}',
                        style: Theme.of(context)
                            .textTheme
                            .bodyMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  String _monthName(int month) {
    const names = [
      'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
    ];

    return names[(month - 1).clamp(0, 11)];
  }

  String _capitalize(String value) {
    if (value.isEmpty) {
      return value;
    }

    return value[0].toUpperCase() + value.substring(1);
  }

  /// Aperçu des trois dernières transactions, avec un lien vers
  /// l'historique complet (`TransactionHistoryPage`). N'affiche rien
  /// tant qu'aucune transaction n'a encore été chargée.
  Widget _buildRecentTransactionsSection(BuildContext context) {
    if (_transactions.isEmpty) {
      return const SizedBox.shrink();
    }

    final preview = _transactions.take(3).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _buildSectionTitle(context, 'Transactions récentes'),
            TextButton(
              onPressed: _openTransactionHistory,
              child: const Text('Voir tout'),
            ),
          ],
        ),
        const SizedBox(height: 4),
        for (final transaction in preview)
          _RecentTransactionTile(
            typeLabel: _transactionTypeLabel(transaction),
            icon: _transactionIcon(transaction),
            incoming: _isIncomingTransaction(transaction),
            currencySymbol: CurrencyFormatter.compactLabel(
              _transactionCurrencyCode(transaction),
            ),
            amount: CurrencyFormatter.formatAmount(transaction['amount']),
            onTap: _openTransactionHistory,
          ),
      ],
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

              Row(
                children: [
                  InkWell(
                    onTap: _openTransactionHistory,
                    borderRadius: BorderRadius.circular(20),
                    child: Padding(
                      padding: const EdgeInsets.all(4),
                      child: Icon(
                        Icons.history,
                        color: Colors.white.withValues(alpha: 0.85),
                        size: 20,
                      ),
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
            vertical: 12,
            horizontal: 6,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: backgroundColor,
                ),
                child: Icon(
                  icon,
                  color: iconColor,
                  size: 18,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 11,
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

/// Un avatar de la rangée "Envoyer à..." (voir `_buildQuickSendRow`) :
/// soit le bouton "Nouveau" (icône +) pour démarrer un transfert vers
/// un nouveau destinataire, soit un contact récent/favori (aperçu de
/// mise en page pour l'instant, aucun favori réel n'est encore
/// mémorisé côté backend).
class _QuickSendAvatar extends StatelessWidget {
  const _QuickSendAvatar({
    required this.icon,
    required this.label,
    this.isAddButton = false,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool isAddButton;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: SizedBox(
          width: 64,
          child: Column(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isAddButton
                      ? AppColors.primaryContainer
                      : AppColors.surfaceVariant,
                ),
                child: Icon(
                  icon,
                  color: isAddButton
                      ? AppColors.primary
                      : AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Contenu d'une carte du carrousel d'annonces (voir
/// `_buildPromoCarousel`) : une simple structure de données, séparée du
/// widget qui l'affiche (`_PromoSlide`).
class _PromoSlideData {
  const _PromoSlideData({
    required this.icon,
    required this.title,
    required this.message,
    required this.color,
    required this.backgroundColor,
  });

  final IconData icon;
  final String title;
  final String message;
  final Color color;
  final Color backgroundColor;
}

/// Affiche une carte du carrousel d'annonces à partir de son contenu
/// (`_PromoSlideData`).
class _PromoSlide extends StatelessWidget {
  const _PromoSlide({
    required this.data,
  });

  final _PromoSlideData data;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      color: data.backgroundColor,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(
              data.icon,
              color: data.color,
              size: 32,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    data.title,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: data.color,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    data.message,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Une ligne de l'aperçu "Transactions récentes" (voir
/// `_buildRecentTransactionsSection`) : version compacte de la ligne
/// équivalente dans `TransactionHistoryPage`, qui reste la référence
/// pour le détail complet d'une transaction.
class _RecentTransactionTile extends StatelessWidget {
  const _RecentTransactionTile({
    required this.typeLabel,
    required this.icon,
    required this.incoming,
    required this.currencySymbol,
    required this.amount,
    required this.onTap,
  });

  final String typeLabel;
  final IconData icon;
  final bool incoming;
  final String currencySymbol;
  final String amount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final amountColor = incoming ? AppColors.success : AppColors.error;
    final amountPrefix = incoming ? '+' : '-';

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: incoming
                    ? AppColors.successContainer
                    : AppColors.surfaceVariant,
              ),
              child: Icon(
                icon,
                size: 20,
                color: incoming ? AppColors.success : AppColors.textSecondary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                typeLabel,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
            Text(
              '$amountPrefix$currencySymbol $amount',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: amountColor,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Options du menu "Paramètres" affiché depuis l'en-tête (voir
/// PopupMenuButton dans WalletPage.build). Seule la déconnexion est
/// implémentée pour le moment ; d'autres réglages viendront s'y
/// ajouter au même endroit plus tard.
enum _SettingsAction {
  logout,
}
