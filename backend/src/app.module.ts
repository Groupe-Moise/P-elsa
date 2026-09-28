import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './database/prisma.module';
import { CurrencyModule } from './currency/currency.module';
import {TransactionsModule } from './transactions/transactions.module'
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CurrencyModule,
    UsersModule,
    WalletModule,
    TransactionsModule,
    AdminModule,

  ],
  controllers: [AppController],
  providers: [
    AppService,

    // L'ordre compte : d'abord l'authentification, ensuite les rôles.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}