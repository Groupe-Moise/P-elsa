-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'EXCHANGE';

-- AlterEnum
ALTER TYPE "LedgerAccountKind" ADD VALUE 'PLATFORM_EXCHANGE';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "toCurrencyId" TEXT,
ADD COLUMN     "rate" DECIMAL(20,8);

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_toCurrencyId_fkey" FOREIGN KEY ("toCurrencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "fromCurrencyId" TEXT NOT NULL,
    "toCurrencyId" TEXT NOT NULL,
    "rate" DECIMAL(20,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "exchange_rates_fromCurrencyId_toCurrencyId_key" ON "exchange_rates"("fromCurrencyId", "toCurrencyId");

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_fromCurrencyId_fkey" FOREIGN KEY ("fromCurrencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_toCurrencyId_fkey" FOREIGN KEY ("toCurrencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
