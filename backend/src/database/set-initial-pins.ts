import 'dotenv/config';

import * as bcrypt from 'bcrypt';

import { PrismaService } from './prisma.service';

async function main() {
  const prisma = new PrismaService();

  await prisma.$connect();

  const users = await prisma.user.findMany({
    select: {
      id: true,
      phone: true,
      pinHash: true,
    },
  });

  const defaultPin = '123456';
  const pinHash = await bcrypt.hash(defaultPin, 12);

  let updatedCount = 0;

  for (const user of users) {
    if (!user.pinHash) {
      await prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          pinHash,
        },
      });

      updatedCount++;

      console.log(
        `PIN initialisé pour l'utilisateur ${user.phone}`,
      );
    }
  }

  console.log(
    `${updatedCount} utilisateur(s) ont reçu un PIN initial.`,
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});