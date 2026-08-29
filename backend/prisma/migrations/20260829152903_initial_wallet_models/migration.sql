-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CLIENT', 'VENDOR', 'DELIVERY', 'TAXI', 'MOTORBIKE', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BLOCKED', 'PENDING');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('TRANSFER', 'DEPOSIT', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CLIENT',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "balance" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(20,4) NOT NULL,
    "fee" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,4) NOT NULL,
    "senderUserId" TEXT,
    "receiverUserId" TEXT,
    "senderWalletId" TEXT,
    "receiverWalletId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_code_key" ON "currencies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "wallets_currencyId_idx" ON "wallets"("currencyId");

-- CreateIndex
CREATE INDEX "wallets_status_idx" ON "wallets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_senderUserId_idx" ON "transactions"("senderUserId");

-- CreateIndex
CREATE INDEX "transactions_receiverUserId_idx" ON "transactions"("receiverUserId");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receiverUserId_fkey" FOREIGN KEY ("receiverUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_senderWalletId_fkey" FOREIGN KEY ("senderWalletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receiverWalletId_fkey" FOREIGN KEY ("receiverWalletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
