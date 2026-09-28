import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';

/**
 * Journal d'audit des actions d'administration (relance,
 * annulation, suspension de compte, déblocage de PIN...).
 *
 * Un enregistrement ici n'est jamais modifié ni supprimé : c'est
 * la trace de ce qu'un administrateur a fait, quand, et sur qui.
 */
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async record(
    adminUserId: string,
    action: string,
    targetType: string,
    targetId?: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action,
        targetType,
        targetId,
        details: details as Prisma.InputJsonValue,
      },
    });
  }

  async list(limit = 100) {
    return this.prisma.adminAuditLog.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: Math.min(Math.max(limit, 1), 500),
      include: {
        adminUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });
  }
}
