import { RequiredCurrencyCodeField } from '../../common/currency/currency-code.decorator';

export class GetExchangeRateQuery {
  /**
   * Devise source (ex. USD).
   */
  @RequiredCurrencyCodeField()
  from!: string;

  /**
   * Devise cible (ex. CDF).
   */
  @RequiredCurrencyCodeField()
  to!: string;
}
