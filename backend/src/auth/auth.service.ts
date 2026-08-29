import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../database/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
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

    const usdCurrency = await this.prisma.currency.findUnique({
      where: {
        code: 'USD',
      },
    });

    if (!usdCurrency) {
      throw new UnauthorizedException(
        'La devise USD n’est pas configurée.',
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

    const accessToken = await this.generateToken(result.user);

    return {
      accessToken,
      user: this.sanitizeUser(result.user),
      wallet: result.wallet,
    };
  }

  async login(data: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        phone: data.phone,
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
      throw new UnauthorizedException(
        'Numéro de téléphone ou PIN incorrect.',
      );
    }

    const isPinValid = await bcrypt.compare(
      data.pin,
      user.pinHash,
    );

    if (!isPinValid) {
      throw new UnauthorizedException(
        'Numéro de téléphone ou PIN incorrect.',
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
      wallet: user.wallet,
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
            currency: true,
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