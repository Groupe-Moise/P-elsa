import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import type { Request } from 'express';

import { UserRole } from '../generated/prisma/enums';

import { CreateExchangeBody } from './dto/create-exchange.body';
import { GetExchangeRateQuery } from './dto/get-exchange-rate.query';
import { ExchangeService } from './exchange.service';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    phone: string;
    role: UserRole;
  };
}

@Controller('exchange')
export class ExchangeController {
  constructor(
    private readonly exchangeService: ExchangeService,
  ) {}

  /**
   * =========================================================
   * TAUX DE CHANGE COURANT
   * =========================================================
   *
   * GET /exchange/rate?from=USD&to=CDF
   */
  @Get('rate')
  getRate(
    @Query() query: GetExchangeRateQuery,
  ) {
    return this.exchangeService.getRate(
      query.from,
      query.to,
    );
  }

  /**
   * =========================================================
   * CONVERSION ENTRE DEUX DEVISES DU WALLET CONNECTÉ
   * =========================================================
   *
   * Le userId provient toujours du JWT, jamais du body.
   */
  @Post()
  createExchange(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateExchangeBody,
  ) {
    return this.exchangeService.createExchange(
      request.user.id,
      body,
    );
  }
}
