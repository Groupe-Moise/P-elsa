import 'package:flutter_test/flutter_test.dart';

// Imports relatifs : le nom du paquet de l'application n'est pas connu ici.
// ignore_for_file: avoid_relative_lib_imports
import '../lib/core/phone/country.dart';
import '../lib/core/phone/phone_formatter.dart';

void main() {
  group('PhoneFormatter.toInternational', () {
    test('RDC : tous les formats locaux donnent +243977777777', () {
      const inputs = [
        '97 777 7777',
        '977777777',
        '0977777777',
        '097 777 7777',
        '097-777-7777',
        '243977777777',
        '00243977777777',
        '+243977777777',
        '+243 97 777 7777',
      ];

      for (final input in inputs) {
        expect(
          PhoneFormatter.toInternational(Countries.drCongo, input),
          '+243977777777',
          reason: input,
        );
      }
    });

    test('RDC : numéro qui commence par 81', () {
      expect(
        PhoneFormatter.toInternational(
          Countries.drCongo,
          '081 234 5678',
        ),
        '+243812345678',
      );
    });

    test('Zambie : le pays choisi fixe l\'indicatif', () {
      expect(
        PhoneFormatter.toInternational(
          Countries.zambia,
          '0977123456',
        ),
        '+260977123456',
      );
    });

    test('un numéro international est conservé tel quel', () {
      expect(
        PhoneFormatter.toInternational(
          Countries.drCongo,
          '+260977123456',
        ),
        '+260977123456',
      );
    });
  });

  group('PhoneFormatter.isPlausible', () {
    test('accepte des numéros plausibles', () {
      expect(PhoneFormatter.isPlausible('97 777 7777'), isTrue);
      expect(PhoneFormatter.isPlausible('+243977777777'), isTrue);
    });

    test('refuse les saisies invalides', () {
      expect(PhoneFormatter.isPlausible(''), isFalse);
      expect(PhoneFormatter.isPlausible('12'), isFalse);
      expect(PhoneFormatter.isPlausible('abc'), isFalse);
      expect(PhoneFormatter.isPlausible('97 777 77x7'), isFalse);
    });
  });
}