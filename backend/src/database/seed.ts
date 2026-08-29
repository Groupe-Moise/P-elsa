import { PrismaService } from './prisma.service';

async function main() {
  const prisma = new PrismaService();

  await prisma.$connect();

  const currencies = [
    {
      code: 'USD',
      name: 'Dollar américain',
      symbol: '$',
    },
    {
      code: 'CDF',
      name: 'Franc congolais',
      symbol: 'FC',
    },
    {
      code: 'ZMW',
      name: 'Kwacha zambien',
      symbol: 'ZK',
    },
  ];

  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: {
        code: currency.code,
      },
      update: currency,
      create: currency,
    });
  }

  console.log('Devises P-Elsa initialisées avec succès.');

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});