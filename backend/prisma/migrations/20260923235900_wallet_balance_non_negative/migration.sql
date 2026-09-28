-- Filet de sécurité : un wallet ne peut jamais avoir un solde négatif,
-- même si un bug applicatif contournait le débit conditionnel.
--
-- Avant d'appliquer, vérifier qu'aucun wallet n'est déjà négatif :
--   SELECT id, "userId", balance FROM wallets WHERE balance < 0;
-- (si des lignes apparaissent, la migration échouera : à corriger d'abord)

ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_balance_non_negative"
  CHECK ("balance" >= 0);
