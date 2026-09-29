import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';

import { LedgerModule } from '../ledger/ledger.module';
import { IdempotencyService } from '../transactions/idempotency.service';
import { ExchangeController } from './exchange.controller';
import { ExchangeService } from './exchange.service';

/**
 * `IdempotencyService` est déclaré ici comme provider propre à ce
 * module (comme le fait déjà TransactionsModule) plutôt qu'importé
 * depuis TransactionsModule : la classe est sans état partagé entre
 * modules (uniquement une dépendance à PrismaService), et importer
 * TransactionsModule ici n'apporterait rien d'autre tout en créant un
 * couplage inutile entre les deux modules.
 */
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    LedgerModule,
  ],

  controllers: [
    ExchangeController,
  ],

  providers: [
    ExchangeService,
    IdempotencyService,
  ],

  exports: [
    ExchangeService,
  ],
})
export class ExchangeModule {}
