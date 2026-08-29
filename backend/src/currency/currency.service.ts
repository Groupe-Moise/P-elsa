import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CurrencyService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.currency.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        code: 'asc',
      },
    });
  }

  async findByCode(code: string) {
    return this.prisma.currency.findUnique({
      where: {
        code: code.toUpperCase(),
      },
    });
  }

  async seedDefaultCurrencies() {
    const currencies = [
      {
        code: 'USD',
        name: 'Dollar américain',
        symbol: '$',
      },
      {
        code: 'CDF',
        name: 'Franc congolais',
        symbol: 'FC',
      },
      {
        code: 'ZMW',
        name: 'Kwacha zambien',
        symbol: 'ZK',
      },
    ];

    for (const currency of currencies) {
      await this.prisma.currency.upsert({
        where: {
          code: currency.code,
        },
        update: {
          name: currency.name,
          symbol: currency.symbol,
          isActive: true,
        },
        create: currency,
      });
    }

    return this.findAll();
  }
}