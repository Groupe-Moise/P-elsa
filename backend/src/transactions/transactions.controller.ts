import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';

import type { Request } from 'express';

import { UserRole } from '../generated/prisma/enums';
import { Roles } from '../auth/decorators/roles.decorator';
import { assertOwnerOrAdmin } from '../auth/utils/assert-owner-or-admin';

import { CreateDepositBody } from './dto/create-deposit.body';
import { CreatePaymentBody } from './dto/create-payment.body';
import { CreateTransferBody } from './dto/create-transfer.body';
import { CreateWithdrawalBody } from './dto/create-withdrawal.body';
import { FindMerchantQuery } from './dto/find-merchant.query';
import { FindRecipientQuery } from './dto/find-recipient.query';

import { TransactionsService } from './transactions.service';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    phone: string;
    role: UserRole;
  };
}

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
  ) {}

  /**
   * =========================================================
   * CONTRÔLE D'ACCÈS À UNE TRANSACTION
   * =========================================================
   *
   * Une transaction n'est visible que par son expéditeur,
   * son destinataire ou un administrateur.
   */
  private assertParticipantOrAdmin(
    user: {
      id: string;
      role: UserRole;
    },
    transaction: {
      senderUserId: string | null;
      receiverUserId: string | null;
    },
  ): void {
    if (
      user.role === UserRole.ADMIN ||
      user.id === transaction.senderUserId ||
      user.id === transaction.receiverUserId
    ) {
      return;
    }

    throw new ForbiddenException('Accès refusé.');
  }

  /**
   * =========================================================
   * RECHERCHE DU BÉNÉFICIAIRE D'UN TRANSFERT
   * =========================================================
   *
   * Exemple :
   *
   * GET /transactions/transfer/recipient?phone=+243XXXXXXXXX
   *
   * Le numéro est recherché uniquement pour
   * l'utilisateur authentifié.
   *
   * Le numéro peut être saisi au format local (ex. 097...) :
   * il est converti automatiquement au format international.
   * Le paramètre facultatif country (ex. CD, ZM) précise le pays.
   *
   * Limité à 30 recherches par minute et par adresse IP, pour
   * empêcher de deviner quels numéros sont inscrits.
   */
  @Throttle({
    default: {
      limit: 30,
      ttl: 60000,
    },
  })
  @Get('transfer/recipient')
  findTransferRecipient(
    @Req() request: AuthenticatedRequest,
    @Query() query: FindRecipientQuery,
  ) {
    return this.transactionsService.findTransferRecipient(
      request.user.id,
      query.phone,
    );
  }

  /**
   * =========================================================
   * TRANSFERT ENTRE UTILISATEURS
   * =========================================================
   *
   * L'expéditeur est automatiquement récupéré
   * depuis l'utilisateur authentifié par le JWT.
   *
   * Le client ne peut donc pas choisir
   * le wallet d'un autre utilisateur comme expéditeur.
   *
   * Le receiverUserId provient du body.
   */
  @Post('transfer')
  createTransfer(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateTransferBody,
  ) {
    return this.transactionsService.createTransfer(
      request.user.id,
      body,
    );
  }

  /**
   * =========================================================
   * RECHERCHE DU MARCHAND D'UN PAIEMENT
   * =========================================================
   *
   * Exemple :
   *
   * GET /transactions/payment/recipient?merchantCode=PE-XXXXXXXX
   *
   * Le code est recherché uniquement parmi les comptes VENDOR (voir
   * TransactionsService.findPaymentRecipient).
   *
   * Limité comme la recherche par téléphone, pour empêcher de
   * deviner quels codes marchands sont inscrits.
   */
  @Throttle({
    default: {
      limit: 30,
      ttl: 60000,
    },
  })
  @Get('payment/recipient')
  findPaymentRecipient(
    @Req() request: AuthenticatedRequest,
    @Query() query: FindMerchantQuery,
  ) {
    return this.transactionsService.findPaymentRecipient(
      request.user.id,
      query.merchantCode,
    );
  }

  /**
   * =========================================================
   * PAIEMENT D'UN CLIENT VERS UN MARCHAND
   * =========================================================
   *
   * Le payeur est automatiquement récupéré depuis l'utilisateur
   * authentifié par le JWT. Le merchantCode du bénéficiaire provient
   * du body (voir CreatePaymentBody).
   */
  @Post('payment')
  createPayment(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreatePaymentBody,
  ) {
    return this.transactionsService.createPayment(
      request.user.id,
      body,
    );
  }

  /**
   * =========================================================
   * DÉPÔT
   * =========================================================
   *
   * Le wallet bénéficiaire est automatiquement
   * déterminé à partir de l'utilisateur connecté.
   *
   * Le userId ne vient jamais du body.
   *
   * Le client fournit :
   * - amount
   * - network
   * - phone
   * - pin
   * - description facultative
   */
  @Post('deposit')
  createDeposit(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateDepositBody,
  ) {
    return this.transactionsService.createDeposit(
      request.user.id,
      body,
    );
  }

  /**
   * =========================================================
   * RETRAIT
   * =========================================================
   *
   * Le wallet concerné est automatiquement
   * déterminé à partir de l'utilisateur connecté.
   *
   * Le userId ne vient jamais du body.
   *
   * Le client fournit :
   * - amount
   * - network
   * - phone
   * - pin
   * - description facultative
   */
  @Post('withdrawal')
  createWithdrawal(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateWithdrawalBody,
  ) {
    return this.transactionsService.createWithdrawal(
      request.user.id,
      body,
    );
  }

  /**
   * =========================================================
   * TRANSACTIONS DE L'UTILISATEUR CONNECTÉ
   * =========================================================
   */
  @Get('me')
  findMyTransactions(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.transactionsService.findByUserId(
      request.user.id,
    );
  }

  /**
   * =========================================================
   * LISTE DES TRANSACTIONS
   * =========================================================
   *
   * Réservé aux administrateurs.
   */
  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.transactionsService.findAll();
  }

  /**
   * =========================================================
   * TRANSACTIONS D'UN UTILISATEUR
   * =========================================================
   *
   * Accessible au propriétaire ou à un administrateur.
   */
  @Get('user/:userId')
  findByUserId(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    assertOwnerOrAdmin(request.user, userId);

    return this.transactionsService.findByUserId(
      userId,
    );
  }

  /**
   * =========================================================
   * TRANSACTION PAR RÉFÉRENCE
   * =========================================================
   *
   * Accessible à l'expéditeur, au destinataire
   * ou à un administrateur.
   */
  @Get('reference/:reference')
  async findByReference(
    @Param('reference') reference: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const transaction =
      await this.transactionsService.findByReference(
        reference,
      );

    this.assertParticipantOrAdmin(
      request.user,
      transaction,
    );

    return transaction;
  }

  /**
   * =========================================================
   * TRANSACTION PAR ID
   * =========================================================
   *
   * Accessible à l'expéditeur, au destinataire
   * ou à un administrateur.
   *
   * Cette route doit rester après 'me', 'user/:userId'
   * et 'reference/:reference'.
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const transaction =
      await this.transactionsService.findOne(id);

    this.assertParticipantOrAdmin(
      request.user,
      transaction,
    );

    return transaction;
  }
}
