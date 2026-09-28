import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marque une route (ou un contrôleur entier) comme publique :
 * le guard JWT global ne demandera pas de token.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);