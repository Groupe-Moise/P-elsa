import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { PinAttemptsService } from '../auth/pin-attempts.service';
import { IdempotencyService } from './idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentService } from '../payments/payment.service';
import { SUPPORTED_CURRENCY_CODES } from '../common/currency/currency-code.decorator';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  TransactionStatus,
  TransactionType,
} from '../generated/prisma/enums';

import type { CreateDepositBody } from './dto/create-deposit.body';
import type { CreateTransferBody } from './dto/create-transfer.body';
import type { CreateWithdrawalBody } from './dto/create-withdrawal.body';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pinAttemptsService: PinAttemptsService,
    private readonly idempotencyService: IdempotencyService,
    private readonly ledgerService: LedgerService,
    private readonly paymentService: PaymentService,
  ) {}

  /**
   * =========================================================
   * RECHERCHE DU BÉNÉFICIAIRE D'UN TRANSFERT
   * =========================================================
   *
   * La recherche se fait à partir du numéro de téléphone.
   *
   * Le numéro est fourni par l'utilisateur connecté.
   *
   * On retourne uniquement les informations nécessaires
   * à la vérification du bénéficiaire.
   */
  async findTransferRecipient(
    senderUserId: string,
    phone: string,
  ) {
    const normalizedPhone = phone.trim();

    if (normalizedPhone.length < 9) {
      throw new BadRequestException(
        'Le numéro de téléphone du bénéficiaire est invalide.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: {
        phone: normalizedPhone,
      },

      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,

        wallet: {
          select: {
            id: true,
            status: true,

            balances: {
              select: {
                balance: true,

                currency: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    symbol: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(
        'Aucun utilisateur ne correspond à ce numéro de téléphone.',
      );
    }

    if (user.id === senderUserId) {
      throw new BadRequestException(
        'Vous ne pouvez pas effectuer un transfert vers votre propre compte.',
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Le compte du bénéficiaire n’est pas actif.',
      );
    }

    if (!user.wallet) {
      throw new NotFoundException(
        'Le bénéficiaire ne possède pas encore de wallet.',
      );
    }

    if (user.wallet.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Le wallet du bénéficiaire n’est pas actif.',
      );
    }

    return {
      id: user.id,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,

      wallet: {
        id: user.wallet.id,

        /**
         * Devises déjà détenues par ce wallet, à titre
         * indicatif : le transfert peut tout de même créer un
         * nouveau solde chez le destinataire si besoin (voir
         * getOrCreateWalletBalance).
         */
        currencies: user.wallet.balances.map(
          (entry) => entry.currency,
        ),
      },
    };
  }

  /**
   * =========================================================
   * TRANSFERT ENTRE DEUX UTILISATEURS
   * =========================================================
   *
   * Le senderUserId provient toujours du JWT.
   *
   * Le receiverUserId, le montant et le PIN
   * proviennent du body.
   *
   * Le transfert :
   * - vérifie le PIN
   * - vérifie les utilisateurs
   * - vérifie les wallets
   * - vérifie les statuts
   * - vérifie la devise
   * - vérifie le solde
   * - débite l'expéditeur
   * - crédite le destinataire
   * - crée la transaction
   *
   * Toutes les opérations financières sont effectuées
   * dans une seule transaction Prisma.
   */
  async createTransfer(
    senderUserId: string,
    data: CreateTransferBody,
  ) {
    if (senderUserId === data.receiverUserId) {
      throw new BadRequestException(
        'Vous ne pouvez pas effectuer un transfert vers votre propre compte.',
      );
    }

    if (
      !data.pin ||
      data.pin.trim().length === 0
    ) {
      throw new UnauthorizedException(
        'Le PIN est obligatoire pour confirmer le transfert.',
      );
    }

    if (
      !Number.isFinite(data.amount) ||
      data.amount <= 0
    ) {
      throw new BadRequestException(
        'Le montant du transfert doit être supérieur à zéro.',
      );
    }

    const amount = data.amount;

    /**
     * Pour le moment :
     * commission = 0
     *
     * Nous ajouterons la vraie commission P-Elsa
     * dans une étape dédiée.
     */
    const fee = 0;
    const totalAmount = amount + fee;

    /**
     * =======================================================
     * VÉRIFICATION DU PIN
     * =======================================================
     *
     * PrismaService masque pinHash globalement.
     *
     * Pour cette opération d'authentification,
     * nous devons explicitement demander le pinHash.
     *
     * Le pinHash n'est jamais renvoyé au client.
     */
    const senderUser = await this.prisma.user.findUnique({
      where: {
        id: senderUserId,
      },

      select: {
        id: true,
        status: true,
        pinHash: true,
      },
    });

    if (!senderUser) {
      throw new NotFoundException(
        "L'utilisateur expéditeur est introuvable.",
      );
    }

    if (senderUser.status !== 'ACTIVE') {
      throw new BadRequestException(
        "Le compte de l'expéditeur n'est pas actif.",
      );
    }

    if (!senderUser.pinHash) {
      throw new UnauthorizedException(
        'Le compte ne possède pas de PIN valide.',
      );
    }

    /**
     * Vérification du PIN avec limitation des tentatives :
     * après plusieurs échecs, le PIN est bloqué temporairement.
     */
    const pinResult = await this.pinAttemptsService.verify(
      senderUser.id,
      data.pin,
    );

    if (!pinResult.valid) {
      throw new UnauthorizedException(
        `PIN incorrect. Le transfert n’a pas été effectué. ${pinResult.message}`,
      );
    }

    /**
     * =======================================================
     * TRANSACTION FINANCIÈRE ATOMIQUE
     * =======================================================
     */
    const idempotency = await this.idempotencyService.begin(
      senderUserId,
      data.idempotencyKey,
    );

    if (idempotency.replay) {
      return idempotency.response;
    }

    try {
      const result = await this.prisma.$transaction(
      async (tx) => {
        /**
         * Devise de ce transfert (USD par défaut). Le
         * destinataire est crédité dans la même devise : plus
         * de conversion automatique à gérer, et plus besoin de
         * vérifier que les deux wallets "utilisent" la même
         * devise, puisqu'un wallet peut désormais en détenir
         * plusieurs (voir WalletBalance).
         */
        const currency = await this.resolveCurrency(
          tx,
          data.currencyCode,
        );

        /**
         * Recherche du wallet de l'expéditeur.
         *
         * Le userId provient du JWT et non du body.
         */
        const senderWallet =
          await tx.wallet.findUnique({
            where: {
              userId: senderUserId,
            },
            include: {
              user: true,
            },
          });

        if (!senderWallet) {
          throw new NotFoundException(
            "Le wallet de l'expéditeur est introuvable.",
          );
        }

        /**
         * Recherche du wallet du destinataire.
         */
        const receiverWallet =
          await tx.wallet.findUnique({
            where: {
              userId: data.receiverUserId,
            },
            include: {
              user: true,
            },
          });

        if (!receiverWallet) {
          throw new NotFoundException(
            'Le wallet du destinataire est introuvable.',
          );
        }

        /**
         * Vérification du statut des wallets.
         */
        if (senderWallet.status !== 'ACTIVE') {
          throw new BadRequestException(
            "Le wallet de l'expéditeur n'est pas actif.",
          );
        }

        if (receiverWallet.status !== 'ACTIVE') {
          throw new BadRequestException(
            "Le wallet du destinataire n'est pas actif.",
          );
        }

        /**
         * Vérification du statut des comptes.
         */
        if (senderWallet.user.status !== 'ACTIVE') {
          throw new BadRequestException(
            "Le compte de l'expéditeur n'est pas actif.",
          );
        }

        if (receiverWallet.user.status !== 'ACTIVE') {
          throw new BadRequestException(
            "Le compte du destinataire n'est pas actif.",
          );
        }

        /**
         * Solde de l'expéditeur dans la devise du transfert.
         * Celui du destinataire est créé à zéro s'il n'existe
         * pas encore dans cette devise (voir
         * getOrCreateWalletBalance).
         */
        const senderBalance = await this.getOrCreateWalletBalance(
          tx,
          senderWallet.id,
          currency.id,
        );

        const receiverBalance = await this.getOrCreateWalletBalance(
          tx,
          receiverWallet.id,
          currency.id,
        );

        /**
         * Vérification préalable du solde (message d'erreur clair).
         *
         * Cette lecture seule ne suffit pas à empêcher une double
         * dépense : la vraie protection est le débit conditionnel
         * effectué plus bas.
         */
        if (
          senderBalance.balance.lt(totalAmount)
        ) {
          throw new BadRequestException(
            'Solde insuffisant pour effectuer ce transfert.',
          );
        }

        /**
         * Génération de la référence.
         */
        const reference =
          this.generateReference();

        /**
         * Débit de l'expéditeur et crédit du destinataire.
         *
         * PROTECTION CONTRE LA DOUBLE DÉPENSE :
         *
         * Le débit est conditionnel : la base de données ne
         * l'applique que si le solde est toujours suffisant
         * au moment exact de l'écriture. Deux transferts
         * simultanés ne peuvent donc pas dépenser deux fois
         * le même argent.
         *
         * Les deux soldes sont toujours modifiés dans le même
         * ordre (selon leur id), quel que soit le sens du
         * transfert. Cela évite qu'un transfert A -> B et un
         * transfert B -> A simultanés se bloquent mutuellement.
         */
        const debitSender = async () => {
          const debit = await tx.walletBalance.updateMany({
            where: {
              id: senderBalance.id,
              balance: {
                gte: totalAmount,
              },
            },
            data: {
              balance: {
                decrement: totalAmount,
              },
            },
          });

          if (debit.count !== 1) {
            throw new BadRequestException(
              'Solde insuffisant pour effectuer ce transfert.',
            );
          }
        };

        const creditReceiver = async () => {
          await tx.walletBalance.update({
            where: {
              id: receiverBalance.id,
            },
            data: {
              balance: {
                increment: amount,
              },
            },
          });
        };

        if (senderBalance.id < receiverBalance.id) {
          await debitSender();
          await creditReceiver();
        } else {
          await creditReceiver();
          await debitSender();
        }

        /**
         * Lecture des soldes après opération.
         */
        const updatedSenderBalance =
          await tx.walletBalance.findUniqueOrThrow({
            where: {
              id: senderBalance.id,
            },
          });

        const updatedReceiverBalance =
          await tx.walletBalance.findUniqueOrThrow({
            where: {
              id: receiverBalance.id,
            },
          });

        /**
         * Création de la transaction.
         *
         * NOTE : la devise de l'opération n'est pas encore
         * stockée sur Transaction elle-même (seulement sur les
         * écritures du ledger) ; ce sera nécessaire quand
         * plusieurs devises circuleront couramment (voir le
         * plan de projet, jalon J6).
         */
        const transaction =
          await tx.transaction.create({
            data: {
              reference,
              type: TransactionType.TRANSFER,
              status:
                TransactionStatus.COMPLETED,

              amount,
              fee,
              totalAmount,

              senderUserId:
                senderWallet.userId,

              receiverUserId:
                receiverWallet.userId,

              senderWalletId:
                senderWallet.id,

              receiverWalletId:
                receiverWallet.id,

              currencyId:
                currency.id,

              description:
                data.description,
            },

            include: {
              senderUser: true,

              receiverUser: true,

              senderWallet: true,

              receiverWallet: true,
            },
          });

        await this.ledgerService.recordTransfer(tx, {
          transactionId: transaction.id,
          senderWalletId: senderWallet.id,
          receiverWalletId: receiverWallet.id,
          currencyId: currency.id,
          amount,
        });

        return {
          transaction,

          currency: currency.code,

          balances: {
            sender:
              updatedSenderBalance.balance,

            receiver:
              updatedReceiverBalance.balance,
          },
        };
      },
      );

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

  /**
   * =========================================================
   * DÉPÔT
   * =========================================================
   *
   * Pour le moment le dépôt est encore un dépôt
   * de test dans le système.
   *
   * Le userId provient du JWT.
   *
   * Le réseau, le numéro, le montant et le PIN
   * sont fournis par l'utilisateur.
   *
   * Le PIN est vérifié avant toute opération financière.
   *
   * Plus tard :
   *
   * P-Elsa
   *    ↓
   * Airtel / M-Pesa / Orange
   *    ↓
   * paiement confirmé
   *    ↓
   * webhook
   *    ↓
   * wallet crédité
   */
  async createDeposit(
    userId: string,
    data: CreateDepositBody,
  ) {
    /**
     * =======================================================
     * VALIDATION DU PIN
     * =======================================================
     */
    if (
      !data.pin ||
      !/^\d{6}$/.test(data.pin.trim())
    ) {
      throw new UnauthorizedException(
        'Le PIN doit contenir 6 chiffres pour confirmer le dépôt.',
      );
    }

    /**
     * Recherche de l'utilisateur et de son PIN.
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
      throw new UnauthorizedException(
        "Le compte utilisateur n'est pas actif.",
      );
    }

    if (!user.pinHash) {
      throw new UnauthorizedException(
        'Le compte ne possède pas de PIN valide.',
      );
    }

    /**
     * Vérification du PIN avec limitation des tentatives :
     * après plusieurs échecs, le PIN est bloqué temporairement.
     */
    const pinResult = await this.pinAttemptsService.verify(
      user.id,
      data.pin.trim(),
    );

    if (!pinResult.valid) {
      throw new UnauthorizedException(
        `PIN incorrect. Le dépôt n’a pas été effectué. ${pinResult.message}`,
      );
    }

    /**
     * =======================================================
     * VALIDATION DU MONTANT
     * =======================================================
     */
    if (
      !Number.isFinite(data.amount) ||
      data.amount <= 0
    ) {
      throw new BadRequestException(
        'Le montant du dépôt doit être supérieur à zéro.',
      );
    }

    /**
     * =======================================================
     * VALIDATION DU RÉSEAU
     * =======================================================
     */
    const allowedNetworks = [
      'Airtel Money',
      'M-Pesa',
      'Orange Money',
    ];

    const network =
      data.network?.trim() ?? '';

    if (!allowedNetworks.includes(network)) {
      throw new BadRequestException(
        'Le réseau de paiement sélectionné est invalide.',
      );
    }

    /**
     * =======================================================
     * VALIDATION DU NUMÉRO
     * =======================================================
     */
    const phone =
      data.phone?.trim() ?? '';

    if (
      phone.length < 9 ||
      phone.length > 20
    ) {
      throw new BadRequestException(
        'Le numéro de paiement est invalide.',
      );
    }

    const amount = data.amount;

    /**
     * Pour le moment :
     * frais de dépôt = 0
     *
     * Une vraie tarification pourra être ajoutée
     * lors de l'intégration des opérateurs.
     */
    const fee = 0;
    const totalAmount = amount + fee;

    const idempotency = await this.idempotencyService.begin(
      userId,
      data.idempotencyKey,
    );

    if (idempotency.replay) {
      return idempotency.response;
    }

    try {
      const created = await this.prisma.$transaction(
      async (tx) => {
        /**
         * Devise de ce dépôt (USD par défaut).
         */
        const currency = await this.resolveCurrency(
          tx,
          data.currencyCode,
        );

        /**
         * ===================================================
         * RECHERCHE DU WALLET
         * ===================================================
         */
        const wallet =
          await tx.wallet.findUnique({
            where: {
              userId,
            },
            include: {
              user: true,
            },
          });

        if (!wallet) {
          throw new NotFoundException(
            'Le wallet de cet utilisateur est introuvable.',
          );
        }

        if (wallet.status !== 'ACTIVE') {
          throw new BadRequestException(
            "Le wallet de cet utilisateur n'est pas actif.",
          );
        }

        if (wallet.user.status !== 'ACTIVE') {
          throw new BadRequestException(
            "Le compte de cet utilisateur n'est pas actif.",
          );
        }

        /**
         * Le solde de cette devise doit exister avant l'arrivée de
         * l'argent (voir getOrCreateWalletBalance).
         */
        await this.getOrCreateWalletBalance(
          tx,
          wallet.id,
          currency.id,
        );

        /**
         * ===================================================
         * GÉNÉRATION DE LA RÉFÉRENCE
         * ===================================================
         */
        const reference =
          this.generateReference();

        /**
         * ===================================================
         * ENREGISTREMENT DE LA TRANSACTION, EN ATTENTE
         * ===================================================
         *
         * Le wallet n'est PAS crédité ici : l'argent n'arrive qu'une
         * fois le paiement confirmé par le fournisseur (voir
         * PaymentService.applyResult). Avec le fournisseur de test
         * en mode « instant », la confirmation est immédiate.
         */
        const transaction =
          await tx.transaction.create({
            data: {
              reference,
              type:
                TransactionType.DEPOSIT,

              status:
                TransactionStatus.PENDING,

              amount,
              fee,
              totalAmount,

              receiverUserId:
                wallet.userId,

              receiverWalletId:
                wallet.id,

              currencyId:
                currency.id,

              provider:
                this.paymentService.providerName,

              network,

              counterpartyPhone:
                phone,

              description:
                data.description ??
                `Dépôt via ${network} depuis ${phone}`,
            },
          });

        return {
          transactionId: transaction.id,
          currency: currency.code,
        };
      },
      );

      /**
       * Demande de l'encaissement au fournisseur de paiement. Selon
       * lui, la transaction sera RÉUSSIE (wallet crédité), ÉCHOUÉE, ou
       * restera EN ATTENTE jusqu'à sa confirmation par webhook.
       */
      const settled = await this.paymentService.process(
        created.transactionId,
      );

      /**
       * Un dépôt ÉCHOUÉ (refusé par le fournisseur) ne doit jamais
       * ressembler à un succès : voir assertNotFailed.
       */
      this.assertNotFailed(settled.transaction);

      const result = {
        transaction: settled.transaction,

        currency: created.currency,

        balance:
          settled.balance,

        deposit: {
          amount,
          fee,
          totalAmount,
          network,
          phone,
        },
      };

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

  /**
   * =========================================================
   * RETRAIT
   * =========================================================
   *
   * Pour le moment le retrait est directement
   * exécuté dans le système.
   *
   * Le userId provient du JWT.
   *
   * Le numéro et le réseau sont fournis par
   * l'utilisateur.
   *
   * Commission P-Elsa :
   * 0,5 % du montant demandé.
   *
   * Le retrait exige également le PIN du propriétaire
   * du wallet avant toute opération financière.
   */
  async createWithdrawal(
    userId: string,
    data: CreateWithdrawalBody,
  ) {
    if (
      !data.pin ||
      !/^\d{6}$/.test(data.pin.trim())
    ) {
      throw new UnauthorizedException(
        'Le PIN doit contenir 6 chiffres pour confirmer le retrait.',
      );
    }

    const senderUser = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        status: true,
        pinHash: true,
      },
    });

    if (!senderUser) {
      throw new NotFoundException(
        "L'utilisateur est introuvable.",
      );
    }

    if (senderUser.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        "Le compte utilisateur n'est pas actif.",
      );
    }

    if (!senderUser.pinHash) {
      throw new UnauthorizedException(
        'Le compte ne possède pas de PIN valide.',
      );
    }

    /**
     * Vérification du PIN avec limitation des tentatives :
     * après plusieurs échecs, le PIN est bloqué temporairement.
     */
    const pinResult = await this.pinAttemptsService.verify(
      senderUser.id,
      data.pin.trim(),
    );

    if (!pinResult.valid) {
      throw new UnauthorizedException(
        `PIN incorrect. Le retrait n'a pas été effectué. ${pinResult.message}`,
      );
    }

    if (
      !Number.isFinite(data.amount) ||
      data.amount <= 0
    ) {
      throw new BadRequestException(
        'Le montant du retrait doit être supérieur à zéro.',
      );
    }

    if (
      !data.network ||
      data.network.trim().length === 0
    ) {
      throw new BadRequestException(
        'Le réseau de paiement est obligatoire.',
      );
    }

    if (
      !data.phone ||
      data.phone.trim().length < 9
    ) {
      throw new BadRequestException(
        'Le numéro bénéficiaire est invalide.',
      );
    }

    const amount = data.amount;

    /**
     * Commission P-Elsa :
     *
     * 0,5 % du montant du retrait.
     */
    const fee = amount * 0.005;

    const totalAmount = amount + fee;

    const idempotency = await this.idempotencyService.begin(
      userId,
      data.idempotencyKey,
    );

    if (idempotency.replay) {
      return idempotency.response;
    }

    try {
      const created = await this.prisma.$transaction(
      async (tx) => {
        /**
         * Devise de ce retrait (USD par défaut).
         */
        const currency = await this.resolveCurrency(
          tx,
          data.currencyCode,
        );

        const wallet =
          await tx.wallet.findUnique({
            where: {
              userId,
            },
            include: {
              user: true,
            },
          });

        if (!wallet) {
          throw new NotFoundException(
            'Le wallet de cet utilisateur est introuvable.',
          );
        }

        if (wallet.status !== 'ACTIVE') {
          throw new BadRequestException(
            "Le wallet de cet utilisateur n'est pas actif.",
          );
        }

        if (wallet.user.status !== 'ACTIVE') {
          throw new BadRequestException(
            "Le compte de cet utilisateur n'est pas actif.",
          );
        }

        /**
         * Solde de ce wallet dans la devise du retrait, créé à
         * zéro s'il n'existe pas encore (voir
         * getOrCreateWalletBalance).
         */
        const walletBalance = await this.getOrCreateWalletBalance(
          tx,
          wallet.id,
          currency.id,
        );

        /**
         * Vérification préalable du solde (message d'erreur clair).
         *
         * Cette lecture seule ne suffit pas à empêcher une double
         * dépense : la vraie protection est le débit conditionnel
         * effectué plus bas.
         */
        if (
          walletBalance.balance.lt(totalAmount)
        ) {
          throw new BadRequestException(
            'Solde insuffisant pour effectuer ce retrait, frais compris.',
          );
        }

        /**
         * Génération de la référence.
         */
        const reference =
          this.generateReference();

        /**
         * BLOCAGE DES FONDS.
         *
         * Le wallet est débité tout de suite (montant + commission) :
         * l'argent ne peut plus être dépensé pendant que le
         * fournisseur exécute le versement. S'il le refuse, les
         * fonds sont remboursés (voir PaymentService.applyResult).
         *
         * PROTECTION CONTRE LA DOUBLE DÉPENSE :
         *
         * Le débit est conditionnel : la base de données ne
         * l'applique que si le solde est toujours suffisant
         * au moment exact de l'écriture. Deux retraits
         * simultanés ne peuvent donc pas dépenser deux fois
         * le même argent.
         */
        const debit = await tx.walletBalance.updateMany({
          where: {
            id: walletBalance.id,
            balance: {
              gte: totalAmount,
            },
          },
          data: {
            balance: {
              decrement: totalAmount,
            },
          },
        });

        if (debit.count !== 1) {
          throw new BadRequestException(
            'Solde insuffisant pour effectuer ce retrait, frais compris.',
          );
        }

        /**
         * Création de la transaction, EN ATTENTE : le résultat
         * dépend du fournisseur de paiement.
         */
        const transaction =
          await tx.transaction.create({
            data: {
              reference,
              type:
                TransactionType.WITHDRAWAL,

              status:
                TransactionStatus.PENDING,

              amount,
              fee,
              totalAmount,

              senderUserId:
                wallet.userId,

              senderWalletId:
                wallet.id,

              currencyId:
                currency.id,

              provider:
                this.paymentService.providerName,

              network:
                data.network.trim(),

              counterpartyPhone:
                data.phone.trim(),

              description:
                data.description,
            },
          });

        /**
         * Le ledger enregistre tout de suite la sortie des fonds du
         * wallet ; un refus du fournisseur ajoutera les écritures
         * inverses.
         */
        await this.ledgerService.recordWithdrawal(tx, {
          transactionId: transaction.id,
          walletId: wallet.id,
          currencyId: currency.id,
          amount,
          fee,
        });

        return {
          transactionId: transaction.id,
          currency: currency.code,
        };
      },
      );

      /**
       * Demande du versement au fournisseur de paiement. Selon lui,
       * la transaction sera RÉUSSIE, ÉCHOUÉE (fonds remboursés) ou
       * restera EN ATTENTE jusqu'à sa confirmation par webhook.
       */
      const settled = await this.paymentService.process(
        created.transactionId,
      );

      /**
       * Un retrait ÉCHOUÉ (refusé par le fournisseur, fonds déjà
       * remboursés) ne doit jamais ressembler à un succès : voir
       * assertNotFailed.
       *
       * Un retrait resté EN ATTENTE faute de solde marchand chez le
       * fournisseur (voir PaymentService.applyResult) n'est PAS un
       * échec : il passe ce contrôle sans erreur, avec
       * settled.transaction.status toujours à PENDING. L'app doit
       * alors afficher un état "en attente de traitement" plutôt
       * qu'une confirmation, en se basant sur ce statut.
       */
      this.assertNotFailed(settled.transaction);

      const result = {
        transaction: settled.transaction,

        currency: created.currency,

        balance:
          settled.balance,

        withdrawal: {
          amount,
          fee,
          totalAmount,
          network:
            data.network.trim(),
          phone:
            data.phone.trim(),
        },
      };

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

  /**
   * =========================================================
   * LISTE DE TOUTES LES TRANSACTIONS
   * =========================================================
   */
  async findAll() {
    return this.prisma.transaction.findMany({
      include: {
        senderUser: true,

        receiverUser: true,

        senderWallet: true,

        receiverWallet: true,
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * =========================================================
   * TRANSACTION PAR ID
   * =========================================================
   */
  async findOne(id: string) {
    const transaction =
      await this.prisma.transaction.findUnique({
        where: {
          id,
        },

        include: {
          senderUser: true,

          receiverUser: true,

          senderWallet: true,

          receiverWallet: true,
        },
      });

    if (!transaction) {
      throw new NotFoundException(
        'Transaction introuvable.',
      );
    }

    return transaction;
  }

  /**
   * =========================================================
   * TRANSACTION PAR RÉFÉRENCE
   * =========================================================
   */
  async findByReference(
    reference: string,
  ) {
    const transaction =
      await this.prisma.transaction.findUnique({
        where: {
          reference,
        },

        include: {
          senderUser: true,

          receiverUser: true,

          senderWallet: true,

          receiverWallet: true,
        },
      });

    if (!transaction) {
      throw new NotFoundException(
        'Transaction introuvable.',
      );
    }

    return transaction;
  }

  /**
   * =========================================================
   * TRANSACTIONS D'UN UTILISATEUR
   * =========================================================
   */
  async findByUserId(userId: string) {
    return this.prisma.transaction.findMany({
      where: {
        OR: [
          {
            senderUserId: userId,
          },

          {
            receiverUserId: userId,
          },
        ],
      },

      include: {
        senderUser: true,

        receiverUser: true,

        senderWallet: true,

        receiverWallet: true,
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * =========================================================
   * GÉNÉRATION DE RÉFÉRENCE
   * =========================================================
   */
  /**
   * =========================================================
   * SOLDE D'UN WALLET DANS UNE DEVISE DONNÉE
   * =========================================================
   *
   * Un wallet peut détenir un solde dans plusieurs devises
   * (voir WalletBalance). La ligne correspondante est créée à
   * la demande, à zéro, la première fois qu'elle est
   * nécessaire : un compte ouvert avant l'ajout d'une devise,
   * ou un nouveau pays ajouté plus tard, n'a pas besoin d'une
   * migration pour en profiter.
   */
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

  /**
   * Résout le code de devise fourni par le client (ou USD par
   * défaut) vers la devise correspondante en base. Rejette une
   * devise qui ne fait pas partie de celles prises en charge
   * pour le moment (voir SUPPORTED_CURRENCY_CODES).
   */
  private async resolveCurrency(
    prisma: PrismaService | Prisma.TransactionClient,
    currencyCode: string | undefined,
  ) {
    const code = (currencyCode ?? 'USD').toUpperCase();

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
    const timestamp =
      Date.now()
        .toString(36)
        .toUpperCase();

    const random =
      Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

    return `TX-${timestamp}-${random}`;
  }

  /**
   * =========================================================
   * REFUS DÉFINITIF DU FOURNISSEUR
   * =========================================================
   *
   * Avant ce correctif, un dépôt ou un retrait ÉCHOUÉ (refusé par le
   * fournisseur de paiement) était quand même renvoyé avec un code
   * HTTP 200 : l'app ne recevait aucune erreur alors que l'argent
   * n'avait pas bougé (ou avait été remboursé pour un retrait), ce
   * qui donnait l'illusion trompeuse d'une opération réussie.
   *
   * Une transaction restée EN ATTENTE (fournisseur injoignable, ou
   * retrait mis en attente faute de solde marchand — voir
   * PaymentService.applyResult) n'est PAS un échec : elle passe ce
   * contrôle sans erreur, l'app affichant alors un état "en attente"
   * plutôt qu'une confirmation ou une erreur.
   */
  private assertNotFailed(transaction: {
    status: TransactionStatus;
    failureReason: string | null;
  }): void {
    if (transaction.status === TransactionStatus.FAILED) {
      throw new BadRequestException(
        transaction.failureReason ??
          'L’opération a été refusée par le fournisseur de paiement.',
      );
    }
  }
}