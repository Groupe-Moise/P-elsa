import 'dotenv/config';

import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not defined. Please configure it in backend/.env',
      );
    }

    const adapter = new PrismaPg({
      connectionString,
    });

    super({
      adapter,

      /**
       * SÉCURITÉ
       *
       * pinHash ne sera jamais retourné par défaut
       * lorsqu'un utilisateur est récupéré avec Prisma.
       *
       * Cela protège automatiquement :
       * - /users
       * - /users/me/profile
       * - /wallets/me
       * - /transactions/me
       * - /transactions/transfer
       * - /transactions/deposit
       * - /transactions/withdrawal
       */
      omit: {
        user: {
          pinHash: true,
        },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}