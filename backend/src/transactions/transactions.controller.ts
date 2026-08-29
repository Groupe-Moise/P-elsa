import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';

import type {
  CreateDepositBody,
  CreateTransferBody,
  CreateWithdrawalBody,
} from './transactions.service';

import { TransactionsService } from './transactions.service';

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
  ) {}

  /**
   * TRANSFERT ENTRE UTILISATEURS
   */
  @Post('transfer')
  createTransfer(@Body() body: CreateTransferBody) {
    return this.transactionsService.createTransfer(body);
  }

  /**
   * DÉPÔT
   */
  @Post('deposit')
  createDeposit(@Body() body: CreateDepositBody) {
    return this.transactionsService.createDeposit(body);
  }

  /**
   * RETRAIT
   */
  @Post('withdrawal')
  createWithdrawal(@Body() body: CreateWithdrawalBody) {
    return this.transactionsService.createWithdrawal(body);
  }

  /**
   * LISTE DES TRANSACTIONS
   */
  @Get()
  findAll() {
    return this.transactionsService.findAll();
  }

  /**
   * TRANSACTIONS D'UN UTILISATEUR
   */
  @Get('user/:userId')
  findByUserId(@Param('userId') userId: string) {
    return this.transactionsService.findByUserId(userId);
  }

  /**
   * TRANSACTION PAR RÉFÉRENCE
   */
  @Get('reference/:reference')
  findByReference(@Param('reference') reference: string) {
    return this.transactionsService.findByReference(reference);
  }

  /**
   * TRANSACTION PAR ID
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactionsService.findOne(id);
  }
}