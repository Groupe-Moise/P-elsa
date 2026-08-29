import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.wallet.findMany({
      include: {
        user: true,
        currency: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: {
        id,
      },
      include: {
        user: true,
        currency: true,
      },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet introuvable.');
    }

    return wallet;
  }

  async findByUserId(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: {
        userId,
      },
      include: {
        user: true,
        currency: true,
      },
    });

    if (!wallet) {
      throw new NotFoundException(
        'Aucun wallet trouvé pour cet utilisateur.',
      );
    }

    return wallet;
  }
}