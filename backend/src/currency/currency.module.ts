import { Module } from '@nestjs/common';

import { PrismaModule } from '../database/prisma.module';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';

@Module({
  imports: [PrismaModule],
  controllers: [CurrencyController],
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrencyModule {}