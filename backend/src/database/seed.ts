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

    /**
     * Taux de change initiaux (bureau de change), uniquement
     * USD <-> CDF pour l'instant. `update: {}` : on ne réinitialise
     * jamais un taux déjà présent en base si ce script est relancé,
     * pour ne pas écraser une valeur que l'admin aurait mise à jour
     * entretemps.
     */
    const usd = await prisma.currency.findUniqueOrThrow({
      where: { code: 'USD' },
    });

    const cdf = await prisma.currency.findUniqueOrThrow({
      where: { code: 'CDF' },
    });

    const initialExchangeRates = [
      {
        fromCurrencyId: usd.id,
        toCurrencyId: cdf.id,
        rate: 2800,
      },
      {
        fromCurrencyId: cdf.id,
        toCurrencyId: usd.id,
        rate: 1 / 2800,
      },
    ];

    for (const exchangeRate of initialExchangeRates) {
      await prisma.exchangeRate.upsert({
        where: {
          fromCurrencyId_toCurrencyId: {
            fromCurrencyId: exchangeRate.fromCurrencyId,
            toCurrencyId: exchangeRate.toCurrencyId,
          },
        },
        update: {},
        create: exchangeRate,
      });
    }

    console.log('Taux de change P-Elsa initialisés avec succès.');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error('Erreur lors de l’initialisation des devises :', error);
  process.exit(1);
});