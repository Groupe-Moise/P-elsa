import { ForbiddenException } from '@nestjs/common';

import { UserRole } from '../../generated/prisma/enums';

/**
 * Autorise l'accès si l'utilisateur connecté est propriétaire
 * de la ressource ou administrateur. Sinon : 403.
 */
export function assertOwnerOrAdmin(
  user: { id: string; role: UserRole },
  ownerId: string | null | undefined,
): void {
  if (user.role === UserRole.ADMIN || user.id === ownerId) {
    return;
  }

  throw new ForbiddenException('Accès refusé.');
}