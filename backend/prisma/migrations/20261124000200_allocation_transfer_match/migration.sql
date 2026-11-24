BEGIN;

CREATE UNIQUE INDEX "transaction_resolution_allocation_key"
  ON "transaction" ("id", "resolution_id", "to_account_id", "currency", "type", "amount");

ALTER TABLE "dispute_resolution_allocation"
  ADD CONSTRAINT "allocation_transfer_match_fkey"
  FOREIGN KEY ("transaction_id", "resolution_id", "recipient_account_id", "currency", "type", "amount")
  REFERENCES "transaction" ("id", "resolution_id", "to_account_id", "currency", "type", "amount")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "dispute_resolution_allocation"
  DROP CONSTRAINT "dispute_resolution_allocation_transaction_id_resolution_id_fkey";

DROP INDEX "transaction_id_resolution_id_to_account_id_currency_key";

COMMIT;
