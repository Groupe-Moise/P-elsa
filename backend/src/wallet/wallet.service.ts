import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { withPrimaryBalance } from './wallet.mapper';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const wallets = await this.prisma.wallet.findMany({
      include: {
        user: true,
        balances: {
          include: {
            currency: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return wallets.map(withPrimaryBalance);
  }

  async findOne(id: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: {
        id,
      },
      include: {
        user: true,
        balances: {
          include: {
            currency: true,
          },
        },
      },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet introuvable.');
    }

    return withPrimaryBalance(wallet);
  }

  async findByUserId(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: {
        userId,
      },
      include: {
        user: true,
        balances: {
          include: {
            currency: true,
          },
        },
      },
    });

    if (!wallet) {
      throw new NotFoundException(
        'Aucun wallet trouvé pour cet utilisateur.',
      );
    }

    return withPrimaryBalance(wallet);
  }
}