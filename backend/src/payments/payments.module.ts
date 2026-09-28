import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module';
import { PaymentService } from './payment.service';
import { PaymentsController } from './payments.controller';
import { SandboxProvider } from './providers/sandbox.provider';
import { MaishaPayProvider } from './providers/maishapay.provider';

@Module({
  imports: [
    LedgerModule,
  ],

  controllers: [
    PaymentsController,
  ],

  providers: [
    PaymentService,
    SandboxProvider,
    MaishaPayProvider,
  ],

  exports: [
    PaymentService,
  ],
})
export class PaymentsModule {}
