// Test réel de MaishaPayProvider : formatage des requêtes, mapping
// des réponses, et surtout la revérification systématique du
// statut via Transaction Lookup avant de faire confiance à un
// webhook (MaishaPay ne signe pas ses webhooks).

import { BadRequestException, ConflictException } from '@nestjs/common';
import { MaishaPayProvider } from './maishapay.provider';

function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

const BASE_ENV = {
  MAISHAPAY_PUBLIC_KEY: 'MP-SBPK-test',
  MAISHAPAY_SECRET_KEY: 'MP-SBSK-test',
  MAISHAPAY_GATEWAY_MODE: '0',
  MAISHAPAY_CALLBACK_BASE_URL: 'https://example-tunnel.test',
  MAISHAPAY_BASE_URL: 'https://marchand.maishapay.online/api',
};

/**
 * Installe un fetch simulé qui répond dans l'ordre des réponses
 * fournies, et journalise chaque appel (url, méthode, corps décodé).
 */
function installFakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      method: options?.method,
      body: options?.body ? JSON.parse(options.body) : undefined,
    });

    const next = queue.shift();
    if (!next) throw new Error('Aucune réponse simulée disponible pour cet appel fetch.');

    return {
      status: next.status ?? 200,
      /**
       * `raw` simule une réponse illisible (page de débogage HTML au
       * lieu du JSON attendu), pour tester la réconciliation
       * automatique. Sans `raw`, on renvoie du JSON classique comme
       * avant.
       */
      text: async () =>
        next.raw !== undefined ? next.raw : JSON.stringify(next.body ?? {}),
    };
  };

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe('MaishaPayProvider', () => {
  it('collect() envoie la requête MaishaPay attendue et reste PENDING (comportement documenté de la collecte v2)', async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([
        {
          status: 202,
          body: {
            status_code: 202,
            transactionStatus: 'PENDING',
            transactionId: 12345,
            originatingTransactionId: 'TX-1',
          },
        },
      ]);

      try {
        const provider = new MaishaPayProvider();
        const result = await provider.collect({
          transactionReference: 'TX-1',
          amount: '100',
          currencyCode: 'CDF',
          phone: '+243997447204',
          network: 'Airtel Money',
        });

        expect(result.status).toBe('PENDING');
        expect(result.providerReference).toBe('12345');

        expect(fake.calls).toHaveLength(1);
        const call = fake.calls[0];
        expect(call.url).toBe('https://marchand.maishapay.online/api/collect/v2/store/mobileMoney');
        expect(call.body.transactionReference).toBe('TX-1');
        expect(call.body.gatewayMode).toBe('0');
        expect(call.body.publicApiKey).toBe('MP-SBPK-test');
        expect(call.body.secretApiKey).toBe('MP-SBSK-test');
        expect(call.body.order.amount).toBe('100');
        expect(call.body.order.currency).toBe('CDF');
        expect(call.body.paymentChannel.channel).toBe('MOBILEMONEY');
        expect(call.body.paymentChannel.provider).toBe('AIRTEL');
        expect(call.body.paymentChannel.walletID).toBe('+243997447204');
        expect(call.body.paymentChannel.callbackUrl).toBe('https://example-tunnel.test/payments/webhooks/maishapay');
      } finally {
        fake.restore();
      }
    });
  });

  it('collect() traduit un réseau déjà au format MaishaPay (ex. "MPESA")', async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([
        { body: { transactionStatus: 'PENDING', transactionId: 1 } },
      ]);

      try {
        const provider = new MaishaPayProvider();
        await provider.collect({
          transactionReference: 'TX-2',
          amount: '1',
          currencyCode: 'USD',
          phone: '+243900000000',
          network: 'MPESA',
        });

        expect(fake.calls[0].body.paymentChannel.provider).toBe('MPESA');
      } finally {
        fake.restore();
      }
    });
  });

  it('collect() refuse un réseau non pris en charge sans appeler MaishaPay', async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([]);

      try {
        const provider = new MaishaPayProvider();
        await expect(
          provider.collect({
            transactionReference: 'TX-3',
            amount: '1',
            currencyCode: 'USD',
            phone: '+243900000000',
            network: 'Wave',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(fake.calls).toHaveLength(0);
      } finally {
        fake.restore();
      }
    });
  });

  it("collect() lève une erreur si les clés API ne sont pas configurées", async () => {
    await withEnv({ ...BASE_ENV, MAISHAPAY_PUBLIC_KEY: undefined }, async () => {
      const provider = new MaishaPayProvider();

      await expect(
        provider.collect({
          transactionReference: 'TX-4',
          amount: '1',
          currencyCode: 'USD',
          phone: '+243900000000',
          network: 'AIRTEL',
        }),
      ).rejects.toBeInstanceOf(Error);
    });
  });

  it('payout() renvoie COMPLETED immédiatement sur une réponse SUCCESS (le transfert B2C est synchrone)', async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([
        {
          body: {
            status_code: 200,
            transactionStatus: 'SUCCESS',
            transactionId: 999,
            originatingTransactionId: 'TX-5',
          },
        },
      ]);

      try {
        const provider = new MaishaPayProvider();
        const result = await provider.payout({
          transactionReference: 'TX-5',
          amount: '20000',
          currencyCode: 'CDF',
          phone: '+24399XXXXXXX',
          network: 'Airtel Money',
        });

        expect(result.status).toBe('COMPLETED');
        expect(result.providerReference).toBe('999');

        const call = fake.calls[0];
        expect(call.url).toBe('https://marchand.maishapay.online/api/b2c/store/transfert/mobilemoney');
        expect(call.body.order.motif).toBe('Retrait P-ELSA');
        expect(call.body.paymentChannel.provider).toBe('AIRTEL');
        expect(call.body.paymentChannel.channel).toBe(undefined);

        /**
         * Régression : une chaîne vide pour customerFullName fait
         * planter l'API MaishaPay côté transfert B2C (colonne
         * recipientFullName NOT NULL, confirmé en sandbox réel — voir
         * SQLSTATE[23000] dans les logs). On doit toujours envoyer
         * une vraie valeur non vide.
         */
        expect(call.body.order.customerFullName).toBe('Client P-ELSA');
        expect(call.body.order.customerFullName.length > 0).toBe(true);
      } finally {
        fake.restore();
      }
    });
  });

  it('payout() renvoie FAILED avec le motif du refus sur une réponse FAILED', async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([
        {
          body: {
            status_code: 400,
            transactionStatus: 'FAILED',
            transactionId: 1000,
            transactionDescription: 'Fonds insuffisants côté opérateur.',
          },
        },
      ]);

      try {
        const provider = new MaishaPayProvider();
        const result = await provider.payout({
          transactionReference: 'TX-6',
          amount: '5',
          currencyCode: 'USD',
          phone: '+243900000000',
          network: 'MTN',
        });

        expect(result.status).toBe('FAILED');
        expect(result.failureReason).toBe('Fonds insuffisants côté opérateur.');
      } finally {
        fake.restore();
      }
    });
  });

  it('getStatus() interroge le Lookup par identifiant MaishaPay, sans useRef', async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([
        {
          body: {
            transaction_type: 'C2B | Collect',
            transactionStatus: 'SUCCESS',
            transactionId: 42,
          },
        },
      ]);

      try {
        const provider = new MaishaPayProvider();
        const result = await provider.getStatus('42');

        expect(result.status).toBe('COMPLETED');

        const call = fake.calls[0];
        expect(call.url).toBe('https://marchand.maishapay.online/api/transaction/rest/v2/check');
        expect(call.body.transactionId).toBe('42');
      } finally {
        fake.restore();
      }
    });
  });

  it('parseWebhook() revérifie le statut auprès de MaishaPay et ne fait JAMAIS confiance au corps du webhook', async () => {
    await withEnv(BASE_ENV, async () => {
      // Le webhook prétend que la transaction a échoué...
      const webhookBody = {
        transactionId: 777,
        transactionStatus: 'FAILED',
      };

      // ...mais la revérification (Transaction Lookup) dit qu'elle a
      // en réalité réussi. C'est la vérité de la revérification qui
      // doit l'emporter : c'est exactement le scénario contre lequel
      // cette revérification protège, puisque MaishaPay ne signe pas
      // ses webhooks.
      const fake = installFakeFetch([
        { body: { transactionStatus: 'SUCCESS', transactionId: 777 } },
      ]);

      try {
        const provider = new MaishaPayProvider();
        const event = await provider.parseWebhook({}, webhookBody);

        expect(event.status).toBe('COMPLETED');
        expect(event.providerReference).toBe('777');

        // La revérification a bien appelé le Lookup (pas de deuxième
        // appel : on ne traite jamais le webhook comme suffisant en soi).
        expect(fake.calls).toHaveLength(1);
        expect(fake.calls[0].url).toBe('https://marchand.maishapay.online/api/transaction/rest/v2/check');
      } finally {
        fake.restore();
      }
    });
  });

  it('parseWebhook() refuse la notification si la revérification montre toujours PENDING', async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([
        { body: { transactionStatus: 'PENDING', transactionId: 1 } },
      ]);

      try {
        const provider = new MaishaPayProvider();
        await expect(
          provider.parseWebhook({}, { transactionId: 1, transactionStatus: 'SUCCESS' }),
        ).rejects.toBeInstanceOf(ConflictException);
      } finally {
        fake.restore();
      }
    });
  });

  it('parseWebhook() refuse un webhook sans transactionId', async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([]);

      try {
        const provider = new MaishaPayProvider();
        await expect(
          provider.parseWebhook({}, { transactionStatus: 'SUCCESS' }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(fake.calls).toHaveLength(0);
      } finally {
        fake.restore();
      }
    });
  });

  /**
   * Réconciliation automatique (voir la note en tête de fichier de
   * maishapay.provider.ts) : constaté en conditions réelles, le
   * transfert B2C peut exécuter réellement l'opération puis planter
   * en essayant de nous notifier, nous renvoyant une page HTML
   * illisible au lieu du JSON attendu. payout() et collect() doivent
   * alors revérifier via le Lookup par référence marchande
   * (?useRef=1) avant d'abandonner.
   */
  it("payout() se réconcilie automatiquement via le Lookup (useRef) quand la réponse initiale est illisible, et renvoie le résultat réel", async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([
        { status: 500, raw: '<html>page de débogage illisible</html>' },
        {
          body: {
            transactionStatus: 'SUCCESS',
            transactionId: 269647,
            originatingTransactionId: 'TX-7',
          },
        },
      ]);

      try {
        const provider = new MaishaPayProvider();
        const result = await provider.payout({
          transactionReference: 'TX-7',
          amount: '3',
          currencyCode: 'USD',
          phone: '+243997447204',
          network: 'Airtel Money',
        });

        expect(result.status).toBe('COMPLETED');
        expect(result.providerReference).toBe('269647');

        expect(fake.calls).toHaveLength(2);
        expect(fake.calls[0].url).toBe(
          'https://marchand.maishapay.online/api/b2c/store/transfert/mobilemoney',
        );
        // Le deuxième appel est bien le Lookup PAR RÉFÉRENCE MARCHANDE
        // (useRef=1), avec notre transactionReference — pas l'appel
        // getStatus() habituel (qui, lui, cherche par transactionId
        // MaishaPay et n'a pas ce paramètre).
        expect(fake.calls[1].url).toBe(
          'https://marchand.maishapay.online/api/transaction/rest/v2/check?useRef=1',
        );
        expect(fake.calls[1].body.transactionId).toBe('TX-7');
      } finally {
        fake.restore();
      }
    });
  });

  it("payout() renvoie l'erreur d'origine si la réconciliation échoue aussi (transaction reste EN ATTENTE, jamais de faux positif)", async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([
        { status: 500, raw: '<html>première erreur illisible</html>' },
        { status: 500, raw: '<html>la réconciliation échoue aussi</html>' },
      ]);

      try {
        const provider = new MaishaPayProvider();
        let caught = null;
        try {
          await provider.payout({
            transactionReference: 'TX-8',
            amount: '1',
            currencyCode: 'USD',
            phone: '+243997447204',
            network: 'Airtel Money',
          });
        } catch (error) {
          caught = error;
        }

        expect(caught instanceof Error).toBe(true);
        expect(caught.message.includes('illisible')).toBe(true);
        // C'est bien l'erreur D'ORIGINE (premier appel) qui remonte,
        // pas une erreur générique sur la réconciliation elle-même.
        expect(caught.message.includes('première erreur illisible')).toBe(
          true,
        );

        // Les deux tentatives ont bien eu lieu (l'appel initial, puis
        // la réconciliation), mais aucune n'a permis de conclure.
        expect(fake.calls).toHaveLength(2);
      } finally {
        fake.restore();
      }
    });
  });

  it('collect() bénéficie de la même réconciliation automatique que payout()', async () => {
    await withEnv(BASE_ENV, async () => {
      const fake = installFakeFetch([
        { status: 500, raw: '<html>page de débogage illisible</html>' },
        { body: { transactionStatus: 'PENDING', transactionId: 555 } },
      ]);

      try {
        const provider = new MaishaPayProvider();
        const result = await provider.collect({
          transactionReference: 'TX-9',
          amount: '1',
          currencyCode: 'USD',
          phone: '+243997447204',
          network: 'Airtel Money',
        });

        expect(result.status).toBe('PENDING');
        expect(result.providerReference).toBe('555');
        expect(fake.calls[1].url).toBe(
          'https://marchand.maishapay.online/api/transaction/rest/v2/check?useRef=1',
        );
        expect(fake.calls[1].body.transactionId).toBe('TX-9');
      } finally {
        fake.restore();
      }
    });
  });
});
