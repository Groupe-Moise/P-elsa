
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { withPrimaryBalance } from '../wallet/wallet.mapper';
import { UserRole, UserStatus } from '../generated/prisma/enums';

export interface CreateUserDto {
  phone: string;
  email?: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
}

// Alphabet volontairement privé des caractères ambigus (0/O, 1/I/l, ...)
// pour qu'un code marchand reste facile à relire et à retaper à la main.
const MERCHANT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MERCHANT_CODE_LENGTH = 8;
const MERCHANT_CODE_MAX_ATTEMPTS = 5;

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

    const rdcCurrencies = await this.prisma.currency.findMany({
      where: {
        code: {
          in: ['USD', 'CDF'],
        },
      },
    });

    if (rdcCurrencies.length === 0) {
      throw new NotFoundException(
        'Les devises de la RDC ne sont pas configurées.',
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
          merchantCode: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const wallet = await tx.wallet.create({
        data: {
          userId: user.id,
        },
      });

      await tx.walletBalance.createMany({
        data: rdcCurrencies.map((currency) => ({
          walletId: wallet.id,
          currencyId: currency.id,
          balance: 0,
        })),
      });

      const walletWithBalances = await tx.wallet.findUniqueOrThrow({
        where: {
          id: wallet.id,
        },
        include: {
          balances: {
            include: {
              currency: true,
            },
          },
        },
      });

      return {
        user,
        wallet: withPrimaryBalance(walletWithBalances),
      };
    });
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        merchantCode: true,
        createdAt: true,
        updatedAt: true,

        wallet: {
          include: {
            balances: {
              include: {
                currency: true,
              },
            },
          },
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });

    return users.map((user) => ({
      ...user,
      wallet: user.wallet ? withPrimaryBalance(user.wallet) : null,
    }));
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
        merchantCode: true,
        createdAt: true,
        updatedAt: true,

        wallet: {
          include: {
            balances: {
              include: {
                currency: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    return {
      ...user,
      wallet: user.wallet ? withPrimaryBalance(user.wallet) : null,
    };
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
        merchantCode: true,
        createdAt: true,
        updatedAt: true,

        wallet: {
          include: {
            balances: {
              include: {
                currency: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    return {
      ...user,
      wallet: user.wallet ? withPrimaryBalance(user.wallet) : null,
    };
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
        merchantCode: true,
        createdAt: true,
        updatedAt: true,

        wallet: {
          include: {
            balances: {
              include: {
                currency: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    return {
      ...user,
      wallet: user.wallet ? withPrimaryBalance(user.wallet) : null,
    };
  }

  /**
   * Génère (ou régénère) le code marchand d'un compte VENDOR, utilisé
   * pour recevoir un paiement (voir TransactionsService.createPayment)
   * à la place d'un numéro de téléphone. Le marchand le déclenche
   * lui-même depuis l'app ; il n'y a pas d'attribution par un admin.
   *
   * Rappeler cette méthode remplace le code existant : l'ancien QR
   * affiché ailleurs (imprimé, partagé) cesse alors de fonctionner.
   */
  async generateMerchantCode(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    if (user.role !== UserRole.VENDOR) {
      throw new ForbiddenException(
        'Seul un compte marchand peut générer un code marchand.',
      );
    }

    for (let attempt = 0; attempt < MERCHANT_CODE_MAX_ATTEMPTS; attempt += 1) {
      const merchantCode = this.generateRandomMerchantCode();

      try {
        return await this.prisma.user.update({
          where: {
            id: userId,
          },
          data: {
            merchantCode,
          },
          select: {
            id: true,
            phone: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            merchantCode: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      } catch (error) {
        const isUniqueConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';

        if (!isUniqueConflict) {
          throw error;
        }

        // Collision très improbable sur le code généré : on retente
        // avec un nouveau tirage plutôt que d'échouer directement.
      }
    }

    throw new ConflictException(
      "Impossible de générer un code marchand unique pour l'instant, veuillez réessayer.",
    );
  }

  private generateRandomMerchantCode(): string {
    let suffix = '';

    for (let i = 0; i < MERCHANT_CODE_LENGTH; i += 1) {
      const index = Math.floor(Math.random() * MERCHANT_CODE_ALPHABET.length);
      suffix += MERCHANT_CODE_ALPHABET[index];
    }

    return `PE-${suffix}`;
  }
}
