import { Controller, Get, Param } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import { CurrencyService } from './currency.service';

// La liste des devises n'est pas sensible : elle reste publique.
@Public()
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