import { IsString, Length } from 'class-validator';

export class FindMerchantQuery {
  /**
   * Code marchand affiché par le vendeur (ex. sous forme de QR code),
   * généré par lui-même depuis l'app (voir
   * UsersService.generateMerchantCode). Recherché uniquement parmi
   * les comptes VENDOR (voir TransactionsService.findPaymentRecipient).
   */
  @IsString()
  @Length(4, 32, {
    message: 'Le code marchand est invalide.',
  })
  merchantCode!: string;
}
