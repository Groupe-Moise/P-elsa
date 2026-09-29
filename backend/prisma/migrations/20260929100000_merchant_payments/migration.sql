-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'PAYMENT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "merchantCode" TEXT;

-- CreateUniqueIndex
CREATE UNIQUE INDEX "users_merchantCode_key" ON "users"("merchantCode");
