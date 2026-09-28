import { Module } from '@nestjs/common';

import { PrismaModule } from '../database/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    PrismaModule,
    PaymentsModule,
  ],

  controllers: [
    AdminController,
  ],

  providers: [
    AdminService,
    AdminAuditService,
  ],
})
export class AdminModule {}
