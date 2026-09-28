import 'dotenv/config';

import { LedgerAccountKind } from '../generated/prisma/enums';
import { PrismaService } from './prisma.service';

/**
 * =========================================================
 * MIGRATION VERS LE WALLET MULTI-DEVISES
 * =========================================================
 *
 * À lancer UNE FOIS, juste après avoir appliqué le nouveau
 * schéma (npx prisma db push + npx prisma generate), et avant
 * de considérer la migration terminée.
 *
 * Ce que fait ce script :
 *
 * 1. Pour chaque wallet, reconstruit son solde dans chaque
 *    devise à partir du LEDGER (somme des écritures de son
 *    compte de ledger). C'est sans risque : la colonne
 *    Wallet.balance a été supprimée par le schéma, mais
 *    l'historique complet reste dans ledger_entries, qui n'a
 *    pas changé.
 *
 * 2. S'assure que chaque wallet a bien un solde (même à zéro)
 *    dans chacune des devises de la RDC (USD, CDF), pour que
 *    les comptes créés avant cette migration ne soient pas
 *    bloqués en attendant une première opération en CDF.
 *
 * Idempotent : peut être relancé sans risque (les soldes déjà
 * corrects ne sont pas modifiés).
 *
 * Utilisation :
 *   npx tsx src/database/migrate-wallets-to-multicurrency.ts
 */
async function main(): Promise<void> {
  const prisma = new PrismaService();

  await prisma.$connect();

  const wallets = await prisma.wallet.findMany();
  const rdcCurrencies = await prisma.currency.findMany({
    where: {
      code: {
        in: ['USD', 'CDF'],
      },
    },
  });

  console.log(
    `${wallets.length} wallet(s) à vérifier, ${rdcCurrencies.length} devise(s) de la RDC.`,
  );

  let reconstructed = 0;
  let zeroed = 0;

  for (const wallet of wallets) {
    /**
     * Comptes de ledger de ce wallet, un par devise déjà
     * utilisée (aujourd'hui, uniquement USD, le seul en usage
     * avant cette migration).
     */
    const ledgerAccounts = await prisma.ledgerAccount.findMany({
      where: {
        walletId: wallet.id,
        kind: LedgerAccountKind.WALLET,
      },
    });

    for (const account of ledgerAccounts) {
      const aggregate = await prisma.ledgerEntry.aggregate({
        where: {
          accountId: account.id,
        },
        _sum: {
          amount: true,
        },
      });

      const balance = aggregate._sum.amount ?? 0;

      const existing = await prisma.walletBalance.findUnique({
        where: {
          walletId_currencyId: {
            walletId: wallet.id,
            currencyId: account.currencyId,
          },
        },
      });

      if (existing) {
        if (!existing.balance.equals(balance)) {
          await prisma.walletBalance.update({
            where: {
              id: existing.id,
            },
            data: {
              balance,
            },
          });

          console.log(
            `Wallet ${wallet.id} : solde corrigé (${existing.balance.toString()} -> ${balance.toString()}).`,
          );
        }

        continue;
      }

      await prisma.walletBalance.create({
        data: {
          walletId: wallet.id,
          currencyId: account.currencyId,
          balance,
        },
      });

      reconstructed++;

      console.log(
        `Wallet ${wallet.id} : solde reconstruit depuis le ledger (${balance.toString()}).`,
      );
    }

    /**
     * Complète avec un solde à zéro pour les devises de la RDC
     * que ce wallet ne détient pas encore.
     */
    for (const currency of rdcCurrencies) {
      const existing = await prisma.walletBalance.findUnique({
        where: {
          walletId_currencyId: {
            walletId: wallet.id,
            currencyId: currency.id,
          },
        },
      });

      if (existing) {
        continue;
      }

      await prisma.walletBalance.create({
        data: {
          walletId: wallet.id,
          currencyId: currency.id,
          balance: 0,
        },
      });

      zeroed++;
    }
  }

  console.log(
    `${reconstructed} solde(s) reconstruit(s) depuis le ledger, ${zeroed} solde(s) à zéro ajouté(s).`,
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
