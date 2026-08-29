import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';

import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    phone: string;
    role: string;
  };
}

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
  ) {}

  @Get()
  findAll() {
    return this.walletService.findAll();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  findMe(@Req() request: AuthenticatedRequest) {
    return this.walletService.findByUserId(request.user.id);
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard)
  findByUserId(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.walletService.findByUserId(
      userId,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.walletService.findOne(id);
  }
}