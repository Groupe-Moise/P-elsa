import {
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  /**
   * VALIDATION DES ENTRÉES
   *
   * - whitelist : les champs non déclarés dans un DTO sont supprimés.
   * - transform : les données reçues deviennent des instances de DTO
   *   (nécessaire pour convertir automatiquement les numéros de
   *   téléphone au format international).
   * - exceptionFactory : renvoie un seul message texte (le premier
   *   défaut trouvé), format déjà géré par l'application Flutter.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) => {
        const messages = errors.flatMap((error) =>
          Object.values(error.constraints ?? {}),
        );

        return new BadRequestException(
          messages[0] ?? 'Données invalides.',
        );
      },
    }),
  );

  const port = Number(process.env.PORT ?? 3000);

  await app.listen(port, '0.0.0.0');

  console.log(`P-Elsa backend running on port ${port}`);
}

void bootstrap();