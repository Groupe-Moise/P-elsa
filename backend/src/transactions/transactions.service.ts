import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import {
  TransactionStatus,
  TransactionType,
} from '../generated/prisma/enums';

export interface CreateTransferBody {
  senderUserId: string;
  receiverUserId: string;
  amount: number;
  description?: string;
}

export interface CreateDepositBody {
  userId: string;
  amount: number;
  description?: string;
}

export interface CreateWithdrawalBody {
  userId: string;
  amount: number;
  description?: string;
}

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * TRANSFERT ENTRE DEUX UTILISATEURS
   */
  async createTransfer(data: CreateTransferBody) {
    if (data.senderUserId === data.receiverUserId) {
      throw new BadRequestException(
        'Vous ne pouvez pas effectuer un transfert vers votre propre compte.',
      );
    }

    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw new BadRequestException(
        'Le montant du transfert doit être supérieur à zéro.',
      );
    }

    const amount = data.amount;
    const fee = 0;
    const totalAmount = amount + fee;

    return this.prisma.$transaction(async (tx) => {
      const senderWallet = await tx.wallet.findUnique({
        where: {
          userId: data.senderUserId,
        },
        include: {
          user: true,
          currency: true,
        },
      });

      if (!senderWallet) {
        throw new NotFoundException(
          'Le wallet de l’expéditeur est introuvable.',
        );
      }

      const receiverWallet = await tx.wallet.findUnique({
        where: {
          userId: data.receiverUserId,
        },
        include: {
          user: true,
          currency: true,
        },
      });

      if (!receiverWallet) {
        throw new NotFoundException(
          'Le wallet du destinataire est introuvable.',
        );
      }

      if (senderWallet.status !== 'ACTIVE') {
        throw new BadRequestException(
          'Le wallet de l’expéditeur n’est pas actif.',
        );
      }

      if (receiverWallet.status !== 'ACTIVE') {
        throw new BadRequestException(
          'Le wallet du destinataire n’est pas actif.',
        );
      }

      if (senderWallet.currencyId !== receiverWallet.currencyId) {
        throw new BadRequestException(
          'Les wallets doivent utiliser la même devise pour effectuer un transfert.',
        );
      }

      if (senderWallet.balance.lt(totalAmount)) {
        throw new BadRequestException(
          'Solde insuffisant pour effectuer ce transfert.',
        );
      }

      const reference = this.generateReference();

      const updatedSenderWallet = await tx.wallet.update({
        where: {
          id: senderWallet.id,
        },
        data: {
          balance: {
            decrement: totalAmount,
          },
        },
      });

      const updatedReceiverWallet = await tx.wallet.update({
        where: {
          id: receiverWallet.id,
        },
        data: {
          balance: {
            increment: amount,
          },
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          reference,
          type: TransactionType.TRANSFER,
          status: TransactionStatus.COMPLETED,
          amount,
          fee,
          totalAmount,
          senderUserId: senderWallet.userId,
          receiverUserId: receiverWallet.userId,
          senderWalletId: senderWallet.id,
          receiverWalletId: receiverWallet.id,
          description: data.description,
        },
        include: {
          senderUser: true,
          receiverUser: true,
          senderWallet: {
            include: {
              currency: true,
            },
          },
          receiverWallet: {
            include: {
              currency: true,
            },
          },
        },
      });

      return {
        transaction,
        balances: {
          sender: updatedSenderWallet.balance,
          receiver: updatedReceiverWallet.balance,
        },
      };
    });
  }

  /**
   * DÉPÔT
   *
   * Pour le moment, le dépôt est considéré comme effectué
   * directement dans le système.
   *
   * L'intégration Airtel Money / M-Pesa / Orange Money
   * sera ajoutée ensuite.
   */
  async createDeposit(data: CreateDepositBody) {
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw new BadRequestException(
        'Le montant du dépôt doit être supérieur à zéro.',
      );
    }

    const amount = data.amount;
    const fee = 0;
    const totalAmount = amount + fee;

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: {
          userId: data.userId,
        },
        include: {
          user: true,
          currency: true,
        },
      });

      if (!wallet) {
        throw new NotFoundException(
          'Le wallet de cet utilisateur est introuvable.',
        );
      }

      if (wallet.status !== 'ACTIVE') {
        throw new BadRequestException(
          'Le wallet de cet utilisateur n’est pas actif.',
        );
      }

      const reference = this.generateReference();

      const updatedWallet = await tx.wallet.update({
        where: {
          id: wallet.id,
        },
        data: {
          balance: {
            increment: amount,
          },
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          reference,
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.COMPLETED,
          amount,
          fee,
          totalAmount,
          receiverUserId: wallet.userId,
          receiverWalletId: wallet.id,
          description: data.description,
        },
        include: {
          receiverUser: true,
          receiverWallet: {
            include: {
              currency: true,
            },
          },
        },
      });

      return {
        transaction,
        balance: updatedWallet.balance,
      };
    });
  }

  /**
   * RETRAIT
   *
   * Pour le moment, le retrait est considéré comme effectué
   * directement dans le système.
   *
   * La commission P-Elsa et l'intégration des opérateurs
   * seront ajoutées dans une prochaine étape.
   */
  async createWithdrawal(data: CreateWithdrawalBody) {
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw new BadRequestException(
        'Le montant du retrait doit être supérieur à zéro.',
      );
    }

    const amount = data.amount;
    const fee = 0;
    const totalAmount = amount + fee;

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: {
          userId: data.userId,
        },
        include: {
          user: true,
          currency: true,
        },
      });

      if (!wallet) {
        throw new NotFoundException(
          'Le wallet de cet utilisateur est introuvable.',
        );
      }

      if (wallet.status !== 'ACTIVE') {
        throw new BadRequestException(
          'Le wallet de cet utilisateur n’est pas actif.',
        );
      }

      if (wallet.balance.lt(totalAmount)) {
        throw new BadRequestException(
          'Solde insuffisant pour effectuer ce retrait.',
        );
      }

      const reference = this.generateReference();

      const updatedWallet = await tx.wallet.update({
        where: {
          id: wallet.id,
        },
        data: {
          balance: {
            decrement: totalAmount,
          },
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          reference,
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.COMPLETED,
          amount,
          fee,
          totalAmount,
          senderUserId: wallet.userId,
          senderWalletId: wallet.id,
          description: data.description,
        },
        include: {
          senderUser: true,
          senderWallet: {
            include: {
              currency: true,
            },
          },
        },
      });

      return {
        transaction,
        balance: updatedWallet.balance,
      };
    });
  }

  /**
   * LISTE DES TRANSACTIONS
   */
  async findAll() {
    return this.prisma.transaction.findMany({
      include: {
        senderUser: true,
        receiverUser: true,
        senderWallet: {
          include: {
            currency: true,
          },
        },
        receiverWallet: {
          include: {
            currency: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * TRANSACTION PAR ID
   */
  async findOne(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: {
        id,
      },
      include: {
        senderUser: true,
        receiverUser: true,
        senderWallet: {
          include: {
            currency: true,
          },
        },
        receiverWallet: {
          include: {
            currency: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction introuvable.');
    }

    return transaction;
  }

  /**
   * TRANSACTION PAR RÉFÉRENCE
   */
  async findByReference(reference: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: {
        reference,
      },
      include: {
        senderUser: true,
        receiverUser: true,
        senderWallet: {
          include: {
            currency: true,
          },
        },
        receiverWallet: {
          include: {
            currency: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction introuvable.');
    }

    return transaction;
  }

  /**
   * TRANSACTIONS D'UN UTILISATEUR
   */
  async findByUserId(userId: string) {
    return this.prisma.transaction.findMany({
      where: {
        OR: [
          {
            senderUserId: userId,
          },
          {
            receiverUserId: userId,
          },
        ],
      },
      include: {
        senderUser: true,
        receiverUser: true,
        senderWallet: {
          include: {
            currency: true,
          },
        },
        receiverWallet: {
          include: {
            currency: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * GÉNÉRATION DE RÉFÉRENCE
   */
  private generateReference(): string {
    const timestamp = Date.now().toString(36).toUpperCase();

    const random = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

    return `TX-${timestamp}-${random}`;
  }
}