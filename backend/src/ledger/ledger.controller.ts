import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
  Req,
} from '@nestjs/common';

import type { Request } from 'express';

import { PrismaService } from '../database/prisma.service';
import { LedgerService } from './ledger.service';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
  };
}

@Controller('ledger')
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Auto-contrôle du wallet de l'utilisateur connecté : compare
   * le solde d'une devise à la somme de ses écritures
   * comptables. Utile pour vérifier le ledger sans accès direct
   * à la base.
   *
   * GET /ledger/me            -> réconciliation en USD (par défaut)
   * GET /ledger/me?currency=CDF
   */
  @Get('me')
  async reconcileMyWallet(
    @Req() request: AuthenticatedRequest,
    @Query('currency') currencyCode = 'USD',
  ) {
    const wallet = await this.prisma.wallet.findUnique({
      where: {
        userId: request.user.id,
      },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet introuvable.');
    }

    const currency = await this.prisma.currency.findUnique({
      where: {
        code: currencyCode.toUpperCase(),
      },
    });

    if (!currency) {
      throw new BadRequestException(
        `Devise inconnue : ${currencyCode}.`,
      );
    }

    return this.ledgerService.reconcileWallet(
      wallet.id,
      currency.id,
    );
  }
}
