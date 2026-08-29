import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './database/prisma.module';
import { CurrencyModule } from './currency/currency.module';
import {TransactionsModule } from './transactions/transactions.module'
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CurrencyModule,
    UsersModule,
    WalletModule,
    TransactionsModule,

  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}