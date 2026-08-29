import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './database/prisma.module';
import { CurrencyModule } from './currency/currency.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    PrismaModule,
    CurrencyModule,
    UsersModule,
    WalletModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}