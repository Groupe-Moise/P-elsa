import { Controller, Get, Param } from '@nestjs/common';

import { CurrencyService } from './currency.service';

@Controller('currency')
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

  @Get()
  findAll() {
    return this.currencyService.findAll();
  }

  @Get(':code')
  findByCode(@Param('code') code: string) {
    return this.currencyService.findByCode(code);
  }
}