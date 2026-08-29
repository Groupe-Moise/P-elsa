
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { UserRole, UserStatus } from '../generated/prisma/enums';

export interface CreateUserDto {
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
      /*
       * IMPORTANT :
       * La création d'un utilisateur classique ne doit pas créer
       * un compte sans PIN.
       *
       * Cette méthode est conservée pour les besoins internes.
       * Les inscriptions normales passent désormais par /auth/register.
       */
      const user = await tx.user.create({
        data: {
          phone: data.phone,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role ?? UserRole.CLIENT,
          status: UserStatus.ACTIVE,

          // Valeur temporaire uniquement pour satisfaire le schéma.
          // L'inscription publique doit utiliser AuthService.
          pinHash: '',
        },

        select: {
          id: true,
          phone: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
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
      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,

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

      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,

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

      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,

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

  async findMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,

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
