import {
  Controller,
  Get,
  Param,
  Req,
} from '@nestjs/common';

import type { Request } from 'express';

import { UserRole } from '../generated/prisma/enums';
import { Roles } from '../auth/decorators/roles.decorator';
import { assertOwnerOrAdmin } from '../auth/utils/assert-owner-or-admin';
import { WalletService } from './wallet.service';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    phone: string;
    role: UserRole;
  };
}

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.walletService.findAll();
  }

  @Get('me')
  findMe(@Req() request: AuthenticatedRequest) {
    return this.walletService.findByUserId(request.user.id);
  }

  @Get('user/:userId')
  findByUserId(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    assertOwnerOrAdmin(request.user, userId);

    return this.walletService.findByUserId(
      userId,
    );
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const wallet = await this.walletService.findOne(id);

    assertOwnerOrAdmin(request.user, wallet.userId);

    return wallet;
  }
}