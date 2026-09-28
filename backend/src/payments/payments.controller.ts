import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import { PaymentService } from './payment.service';

/**
 * Point d'entrée des webhooks des fournisseurs de paiement.
 *
 * Public : un fournisseur n'a pas de token utilisateur. La sécurité
 * repose sur la signature vérifiée par chaque fournisseur (voir
 * PaymentProvider.parseWebhook).
 */
@Public()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentService: PaymentService,
  ) {}

  @Post('webhooks/:provider')
  @HttpCode(200)
  handleWebhook(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ) {
    return this.paymentService.handleWebhook(provider, headers, body);
  }
}
