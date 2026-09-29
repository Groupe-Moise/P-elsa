import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Page générique de scan de QR code : renvoie la première valeur
/// texte détectée via Navigator.pop, ou `null` si l'utilisateur
/// annule (bouton retour, ou appui sur la croix).
///
/// Réutilisable pour n'importe quel usage futur, pas seulement le
/// paiement marchand : elle ne connaît rien du format attendu, elle
/// se contente de renvoyer la chaîne brute lue dans le QR code.
class QrScannerPage extends StatefulWidget {
  const QrScannerPage({
    super.key,
    this.title = 'Scanner un QR code',
    this.instructions =
        'Placez le QR code du marchand dans le cadre pour le scanner.',
  });

  final String title;
  final String instructions;

  @override
  State<QrScannerPage> createState() => _QrScannerPageState();
}

class _QrScannerPageState extends State<QrScannerPage> {
  final MobileScannerController _controller = MobileScannerController();

  bool _hasDetected = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_hasDetected) {
      return;
    }

    for (final barcode in capture.barcodes) {
      final value = barcode.rawValue;

      if (value != null && value.trim().isNotEmpty) {
        _hasDetected = true;
        Navigator.of(context).pop(value.trim());
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(widget.title),
        actions: [
          IconButton(
            tooltip: 'Activer/désactiver le flash',
            icon: ValueListenableBuilder(
              valueListenable: _controller,
              builder: (context, state, child) {
                final torchOn = state.torchState == TorchState.on;

                return Icon(
                  torchOn
                      ? Icons.flash_on
                      : Icons.flash_off,
                );
              },
            ),
            onPressed: () => _controller.toggleTorch(),
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
          ),

          Align(
            alignment: Alignment.center,
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                border: Border.all(
                  color: Colors.white,
                  width: 2,
                ),
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),

          Positioned(
            left: 24,
            right: 24,
            bottom: 32,
            child: Text(
              widget.instructions,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 14,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
