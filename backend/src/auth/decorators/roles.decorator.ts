import { SetMetadata } from '@nestjs/common';

import type { UserRole } from '../../generated/prisma/enums';

export const ROLES_KEY = 'roles';

/**
 * Restreint une route (ou un contrôleur) à certains rôles.
 * Exemple : @Roles(UserRole.ADMIN)
 */
export const Roles = (...roles: UserRole[]) =>
  SetMetadata(ROLES_KEY, roles);