-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "currencyId" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerReference" TEXT,
ADD COLUMN     "network" TEXT,
ADD COLUMN     "counterpartyPhone" TEXT,
ADD COLUMN     "failureReason" TEXT;

-- CreateUniqueIndex
CREATE UNIQUE INDEX "transactions_provider_providerReference_key" ON "transactions"("provider", "providerReference");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
