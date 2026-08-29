import { PrismaService } from './prisma.service';

async function main(): Promise<void> {
  const prisma = new PrismaService();

  try {
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
        update: {
          name: currency.name,
          symbol: currency.symbol,
        },
        create: currency,
      });
    }

    console.log('Devises P-Elsa initialisées avec succès.');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error('Erreur lors de l’initialisation des devises :', error);
  process.exit(1);
});