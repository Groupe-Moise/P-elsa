import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../database/prisma.service';
import { PinAttemptsService } from './pin-attempts.service';
import { withPrimaryBalance } from '../wallet/wallet.mapper';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly pinAttemptsService: PinAttemptsService,
  ) {}

  async register(data: RegisterDto) {
    const existingPhone = await this.prisma.user.findUnique({
      where: {
        phone: data.phone,
      },
    });

    if (existingPhone) {
      throw new UnauthorizedException(
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
        throw new UnauthorizedException(
          'Un utilisateur existe déjà avec cette adresse e-mail.',
        );
      }
    }

    const pinHash = await bcrypt.hash(data.pin, 12);

    /**
     * Devises de la RDC (marché de lancement) : le wallet est
     * créé avec un solde à zéro dans chacune d'elles. D'autres
     * pays et devises s'ajouteront progressivement (voir le
     * plan de projet).
     */
    const rdcCurrencies = await this.prisma.currency.findMany({
      where: {
        code: {
          in: ['USD', 'CDF'],
        },
      },
    });

    if (rdcCurrencies.length === 0) {
      throw new UnauthorizedException(
        'Les devises de la RDC ne sont pas configurées.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: data.phone,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          pinHash,
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
        wallet: walletWithBalances,
      };
    });

    const accessToken = await this.generateToken(result.user);

    return {
      accessToken,
      user: this.sanitizeUser(result.user),
      wallet: withPrimaryBalance(result.wallet),
    };
  }

  async login(data: LoginDto) {
    /**
     * IMPORTANT :
     *
     * PrismaService masque pinHash globalement pour éviter
     * qu'il soit accidentellement exposé dans les réponses API.
     *
     * Pour l'authentification uniquement, nous devons explicitement
     * demander le pinHash afin que bcrypt puisse vérifier le PIN.
     */
    const user = await this.prisma.user.findUnique({
      where: {
        phone: data.phone,
      },

      omit: {
        pinHash: false,
      },

      include: {
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
      /**
       * Faux calcul de vérification : la réponse prend le même
       * temps qu'avec un vrai compte, ce qui empêche de deviner
       * quels numéros sont inscrits.
       */
      await this.pinAttemptsService.simulateVerification(
        data.pin,
      );

      throw new UnauthorizedException(
        'Numéro de téléphone ou PIN incorrect.',
      );
    }

    if (!user.pinHash) {
      throw new UnauthorizedException(
        'Le compte ne possède pas de PIN valide.',
      );
    }

    /**
     * Vérification du PIN avec limitation des tentatives :
     * après plusieurs échecs, le PIN est bloqué temporairement
     * (erreur 429).
     */
    const pinResult = await this.pinAttemptsService.verify(
      user.id,
      data.pin,
    );

    if (!pinResult.valid) {
      throw new UnauthorizedException(
        pinResult.locked
          ? pinResult.message
          : 'Numéro de téléphone ou PIN incorrect.',
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Ce compte n’est pas actif.',
      );
    }

    const accessToken = await this.generateToken(user);

    return {
      accessToken,
      user: this.sanitizeUser(user),
      wallet: user.wallet ? withPrimaryBalance(user.wallet) : null,
    };
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      include: {
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

    if (!user || user.status !== 'ACTIVE') {
      return null;
    }

    return user;
  }

  private async generateToken(user: {
    id: string;
    phone: string;
    role: string;
  }) {
    return this.jwtService.signAsync({
      sub: user.id,
      phone: user.phone,
      role: user.role,
    });
  }

  private sanitizeUser<T extends { pinHash: string }>(user: T) {
    const { pinHash: _pinHash, ...safeUser } = user;

    return safeUser;
  }
}