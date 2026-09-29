import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { PinAttemptsService } from '../auth/pin-attempts.service';
import { IdempotencyService } from '../transactions/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { SUPPORTED_CURRENCY_CODES } from '../common/currency/currency-code.decorator';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  TransactionStatus,
  TransactionType,
} from '../generated/prisma/enums';

import type { CreateExchangeBody } from './dto/create-exchange.body';

@Injectable()
export class ExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pinAttemptsService: PinAttemptsService,
    private readonly idempotencyService: IdempotencyService,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * =========================================================
   * TAUX DE CHANGE COURANT
   * =========================================================
   *
   * GET /exchange/rate?from=USD&to=CDF
   *
   * Public pour tout utilisateur connecté (pas besoin d'être
   * administrateur pour consulter le taux affiché sur l'accueil).
   */
  async getRate(fromCode: string, toCode: string) {
    const fromCurrency = await this.resolveCurrency(fromCode);
    const toCurrency = await this.resolveCurrency(toCode);

    if (fromCurrency.id === toCurrency.id) {
      throw new BadRequestException(
        'Les deux devises doivent être différentes.',
      );
    }

    const exchangeRate = await this.prisma.exchangeRate.findUnique({
      where: {
        fromCurrencyId_toCurrencyId: {
          fromCurrencyId: fromCurrency.id,
          toCurrencyId: toCurrency.id,
        },
      },
    });

    if (!exchangeRate) {
      throw new NotFoundException(
        `Aucun taux de change configuré de ${fromCurrency.code} vers ${toCurrency.code}.`,
      );
    }

    return {
      from: fromCurrency.code,
      to: toCurrency.code,
      rate: exchangeRate.rate,
      updatedAt: exchangeRate.updatedAt,
    };
  }

  /**
   * =========================================================
   * CONVERSION ENTRE DEUX DEVISES DU MÊME WALLET
   * =========================================================
   *
   * Le userId provient toujours du JWT. La conversion :
   * - vérifie le PIN (même exigence que le retrait et le
   *   transfert : contrairement au dépôt, cette opération fait
   *   sortir de l'argent d'un solde, même si c'est pour le faire
   *   réapparaître dans un autre du même wallet)
   * - vérifie le compte et le wallet
   * - récupère le taux configuré pour cette paire de devises
   * - vérifie le solde de la devise source
   * - débite la devise source, crédite la devise cible
   * - crée la transaction (type EXCHANGE) et les écritures du
   *   ledger (voir LedgerService.recordExchange)
   *
   * Aucun frais pour l'instant (voir CreateExchangeBody) : le
   * montant crédité est exactement amount * taux.
   */
  async createExchange(
    userId: string,
    data: CreateExchangeBody,
  ) {
    if (
      data.fromCurrencyCode === data.toCurrencyCode
    ) {
      throw new BadRequestException(
        'Les deux devises doivent être différentes.',
      );
    }

    if (
      !data.pin ||
      data.pin.trim().length === 0
    ) {
      throw new UnauthorizedException(
        'Le PIN est obligatoire pour confirmer la conversion.',
      );
    }

    if (
      !Number.isFinite(data.amount) ||
      data.amount <= 0
    ) {
      throw new BadRequestException(
        'Le montant à convertir doit être supérieur à zéro.',
      );
    }

    const amount = data.amount;

    /**
     * =======================================================
     * VÉRIFICATION DU PIN
     * =======================================================
     */
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
        status: true,
        pinHash: true,
      },
    });

    if (!user) {
      throw new NotFoundException(
        "L'utilisateur est introuvable.",
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new BadRequestException(
        "Le compte utilisateur n'est pas actif.",
      );
    }

    if (!user.pinHash) {
      throw new UnauthorizedException(
        'Le compte ne possède pas de PIN valide.',
      );
    }

    const pinResult = await this.pinAttemptsService.verify(
      user.id,
      data.pin,
    );

    if (!pinResult.valid) {
      throw new UnauthorizedException(
        `PIN incorrect. La conversion n’a pas été effectuée. ${pinResult.message}`,
      );
    }

    /**
     * =======================================================
     * OPÉRATION FINANCIÈRE ATOMIQUE
     * =======================================================
     */
    const idempotency = await this.idempotencyService.begin(
      userId,
      data.idempotencyKey,
    );

    if (idempotency.replay) {
      return idempotency.response;
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const fromCurrency = await this.resolveCurrency(
          data.fromCurrencyCode,
          tx,
        );

        const toCurrency = await this.resolveCurrency(
          data.toCurrencyCode,
          tx,
        );

        const exchangeRate = await tx.exchangeRate.findUnique({
          where: {
            fromCurrencyId_toCurrencyId: {
              fromCurrencyId: fromCurrency.id,
              toCurrencyId: toCurrency.id,
            },
          },
        });

        if (!exchangeRate) {
          throw new BadRequestException(
            `Aucun taux de change configuré de ${fromCurrency.code} vers ${toCurrency.code}.`,
          );
        }

        const wallet = await tx.wallet.findUnique({
          where: {
            userId,
          },
        });

        if (!wallet) {
          throw new NotFoundException(
            "Le wallet de l'utilisateur est introuvable.",
          );
        }

        if (wallet.status !== 'ACTIVE') {
          throw new BadRequestException(
            "Le wallet n'est pas actif.",
          );
        }

        const fromBalance = await this.getOrCreateWalletBalance(
          tx,
          wallet.id,
          fromCurrency.id,
        );

        const toBalance = await this.getOrCreateWalletBalance(
          tx,
          wallet.id,
          toCurrency.id,
        );

        /**
         * Montant crédité en devise cible, arrondi à 2 décimales
         * comme tout montant affiché dans l'application (voir
         * CurrencyFormatter côté mobile).
         */
        const convertedAmount = new Prisma.Decimal(amount)
          .mul(exchangeRate.rate)
          .toDecimalPlaces(2);

        /**
         * Vérification préalable du solde (message d'erreur clair).
         * Le débit conditionnel ci-dessous reste la vraie
         * protection contre la double dépense.
         */
        if (fromBalance.balance.lt(amount)) {
          throw new BadRequestException(
            'Solde insuffisant dans la devise source pour effectuer cette conversion.',
          );
        }

        const reference = this.generateReference();

        const debit = await tx.walletBalance.updateMany({
          where: {
            id: fromBalance.id,
            balance: {
              gte: amount,
            },
          },
          data: {
            balance: {
              decrement: amount,
            },
          },
        });

        if (debit.count !== 1) {
          throw new BadRequestException(
            'Solde insuffisant dans la devise source pour effectuer cette conversion.',
          );
        }

        await tx.walletBalance.update({
          where: {
            id: toBalance.id,
          },
          data: {
            balance: {
              increment: convertedAmount,
            },
          },
        });

        const updatedFromBalance = await tx.walletBalance.findUniqueOrThrow({
          where: {
            id: fromBalance.id,
          },
        });

        const updatedToBalance = await tx.walletBalance.findUniqueOrThrow({
          where: {
            id: toBalance.id,
          },
        });

        const transaction = await tx.transaction.create({
          data: {
            reference,
            type: TransactionType.EXCHANGE,
            status: TransactionStatus.COMPLETED,

            amount,
            fee: 0,
            totalAmount: amount,

            senderUserId: userId,
            receiverUserId: userId,
            senderWalletId: wallet.id,
            receiverWalletId: wallet.id,

            currencyId: fromCurrency.id,
            toCurrencyId: toCurrency.id,
            rate: exchangeRate.rate,

            description: data.description,
          },

          include: {
            senderUser: true,
            receiverUser: true,
            senderWallet: true,
            receiverWallet: true,
            currency: true,
            toCurrency: true,
          },
        });

        await this.ledgerService.recordExchange(tx, {
          transactionId: transaction.id,
          walletId: wallet.id,
          fromCurrencyId: fromCurrency.id,
          toCurrencyId: toCurrency.id,
          fromAmount: amount,
          toAmount: convertedAmount,
        });

        return {
          transaction,

          fromCurrency: fromCurrency.code,
          toCurrency: toCurrency.code,
          rate: exchangeRate.rate,
          convertedAmount,

          balances: {
            from: updatedFromBalance.balance,
            to: updatedToBalance.balance,
          },
        };
      });

      await this.idempotencyService.complete(
        idempotency.reservationId,
        result,
      );

      return result;
    } catch (error) {
      await this.idempotencyService.release(
        idempotency.reservationId,
      );

      throw error;
    }
  }

  private async getOrCreateWalletBalance(
    tx: Prisma.TransactionClient,
    walletId: string,
    currencyId: string,
  ) {
    const existing = await tx.walletBalance.findUnique({
      where: {
        walletId_currencyId: {
          walletId,
          currencyId,
        },
      },
    });

    if (existing) {
      return existing;
    }

    return tx.walletBalance.create({
      data: {
        walletId,
        currencyId,
        balance: 0,
      },
    });
  }

  private async resolveCurrency(
    currencyCode: string,
    prisma: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const code = currencyCode.toUpperCase();

    if (!SUPPORTED_CURRENCY_CODES.includes(code as never)) {
      throw new BadRequestException(
        `Devise invalide. Devises acceptées : ${SUPPORTED_CURRENCY_CODES.join(', ')}.`,
      );
    }

    const currency = await prisma.currency.findUnique({
      where: {
        code,
      },
    });

    if (!currency) {
      throw new BadRequestException(
        `La devise ${code} n'est pas configurée sur le serveur.`,
      );
    }

    return currency;
  }

  private generateReference(): string {
    const timestamp = Date.now().toString(36).toUpperCase();

    const random = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

    return `EX-${timestamp}-${random}`;
  }
}
