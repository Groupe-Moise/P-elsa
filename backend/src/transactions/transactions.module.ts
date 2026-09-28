import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';

import { LedgerModule } from '../ledger/ledger.module';
import { PaymentsModule } from '../payments/payments.module';
import { IdempotencyService } from './idempotency.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    LedgerModule,
    PaymentsModule,
  ],

  controllers: [
    TransactionsController,
  ],

  providers: [
    TransactionsService,
    IdempotencyService,
  ],

  exports: [
    TransactionsService,
  ],
})
export class TransactionsModule {}