import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { UserRole, UserStatus } from '../generated/prisma/enums';

interface CreateUserDto {
  phone: string;
  email?: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateUserDto) {
    const existingPhone = await this.prisma.user.findUnique({
      where: {
        phone: data.phone,
      },
    });

    if (existingPhone) {
      throw new ConflictException(
        'Un utilisateur existe déjà avec ce numéro de téléphone.',
      );
    }

    if (data.email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: {
          email: data.email,
        },
      });

      if (existingEmail) {
        throw new ConflictException(
          'Un utilisateur existe déjà avec cette adresse e-mail.',
        );
      }
    }

    const usdCurrency = await this.prisma.currency.findUnique({
      where: {
        code: 'USD',
      },
    });

    if (!usdCurrency) {
      throw new NotFoundException(
        'La devise USD n’existe pas encore dans la base de données.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: data.phone,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role ?? UserRole.CLIENT,
          status: UserStatus.ACTIVE,
        },
      });

      const wallet = await tx.wallet.create({
        data: {
          userId: user.id,
          currencyId: usdCurrency.id,
          balance: 0,
        },
        include: {
          currency: true,
        },
      });

      return {
        user,
        wallet,
      };
    });
  }

  async findAll() {
    return this.prisma.user.findMany({
      include: {
        wallet: {
          include: {
            currency: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
      },
      include: {
        wallet: {
          include: {
            currency: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    return user;
  }

  async findByPhone(phone: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        phone,
      },
      include: {
        wallet: {
          include: {
            currency: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    return user;
  }
}