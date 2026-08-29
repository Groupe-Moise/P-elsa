import { Controller, Get, Param } from '@nestjs/common';

import { WalletService } from './wallet.service';

@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  findAll() {
    return this.walletService.findAll();
  }

  @Get('user/:userId')
  findByUserId(@Param('userId') userId: string) {
    return this.walletService.findByUserId(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.walletService.findOne(id);
  }
}