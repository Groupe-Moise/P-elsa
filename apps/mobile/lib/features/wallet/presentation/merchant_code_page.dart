import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../core/api/api_client.dart';
import '../../../core/storage/token_storage.dart';

/// Page réservée aux comptes VENDOR : affiche le code marchand actuel
/// sous forme de QR code (à présenter aux clients dans `PaymentPage`),
/// et permet de le générer ou de le régénérer soi-même (voir
/// UsersService.generateMerchantCode — pas d'attribution par un admin).
///
/// Régénérer remplace définitivement l'ancien code : un QR déjà
/// imprimé ou partagé avec cet ancien code cesse alors de fonctionner,
/// ce que le bouton rappelle avant de confirmer.
class MerchantCodePage extends StatefulWidget {
  const MerchantCodePage({
    super.key,
    this.initialMerchantCode,
  });

  final String? initialMerchantCode;

  @override
  State<MerchantCodePage> createState() => _MerchantCodePageState();
}

class _MerchantCodePageState extends State<MerchantCodePage> {
  final _apiClient = ApiClient();
  final _tokenStorage = TokenStorage();

  bool _isGenerating = false;
  String? _merchantCode;

  @override
  void initState() {
    super.initState();
    _merchantCode = widget.initialMerchantCode;
  }

  Future<void> _generateMerchantCode() async {
    if (_isGenerating) {
      return;
    }

    final hasExistingCode =
        _merchantCode != null && _merchantCode!.isNotEmpty;

    if (hasExistingCode) {
      final confirmed = await _confirmRegeneration();

      if (!mounted || confirmed != true) {
        return;
      }
    }

    setState(() {
      _isGenerating = true;
    });

    try {
      final token = await _tokenStorage.readAccessToken();

      if (token == null || token.isEmpty) {
        if (!mounted) {
          return;
        }

        setState(() {
          _isGenerating = false;
        });

        Navigator.of(context).pushNamedAndRemoveUntil(
          '/login',
              (route) => false,
        );

        return;
      }

      final response = await _apiClient.post(
        '/users/me/merchant-code',
        token: token,
      );

      if (!mounted) {
        return;
      }

      final code = response['merchantCode'];

      setState(() {
        _merchantCode = code is String ? code : _merchantCode;
        _isGenerating = false;
      });
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isGenerating = false;
      });

      _showError(error.message);
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isGenerating = false;
      });

      _showError(
        'Impossible de générer le code marchand.',
      );
    }
  }

  Future<bool?> _confirmRegeneration() {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Régénérer le code marchand ?'),
        content: const Text(
          'Votre code marchand actuel cessera de fonctionner : tout '
              'QR code déjà imprimé ou partagé avec vos clients ne '
              'pourra plus être utilisé pour vous payer.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Régénérer'),
          ),
        ],
      ),
    );
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

  @override
  Widget build(BuildContext context) {
    final hasCode = _merchantCode != null && _merchantCode!.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mon code marchand'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 500),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 16),

                  Text(
                    'Faites payer vos clients',
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
                    hasCode
                        ? 'Présentez ce QR code à vos clients, ou '
                        'communiquez-leur le code ci-dessous.'
                        : 'Générez votre code marchand pour commencer '
                        'à recevoir des paiements.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),

                  const SizedBox(height: 32),

                  if (hasCode)
                    Card(
                      elevation: 0,
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          children: [
                            QrImageView(
                              data: _merchantCode!,
                              size: 220,
                              backgroundColor: Colors.white,
                            ),
                            const SizedBox(height: 20),
                            SelectableText(
                              _merchantCode!,
                              textAlign: TextAlign.center,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleLarge
                                  ?.copyWith(
                                fontWeight: FontWeight.bold,
                                letterSpacing: 1.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                    )
                  else
                    Container(
                      padding: const EdgeInsets.all(32),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        color: Theme.of(context)
                            .colorScheme
                            .primary
                            .withValues(alpha: 0.06),
                      ),
                      child: Column(
                        children: [
                          Icon(
                            Icons.qr_code_2,
                            size: 64,
                            color: Theme.of(context).colorScheme.primary,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            'Aucun code marchand pour le moment.',
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ],
                      ),
                    ),

                  const SizedBox(height: 24),

                  SizedBox(
                    height: 52,
                    child: ElevatedButton.icon(
                      onPressed:
                      _isGenerating ? null : _generateMerchantCode,
                      icon: _isGenerating
                          ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                        ),
                      )
                          : Icon(
                        hasCode
                            ? Icons.refresh
                            : Icons.qr_code,
                      ),
                      label: Text(
                        _isGenerating
                            ? 'Génération...'
                            : hasCode
                            ? 'Régénérer mon code'
                            : 'Générer mon code marchand',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
