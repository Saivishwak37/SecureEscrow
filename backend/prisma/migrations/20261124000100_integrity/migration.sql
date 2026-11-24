BEGIN;

ALTER TABLE "user" ADD CONSTRAINT user_credentials_complete CHECK (
  (username IS NULL AND email IS NULL AND password_hash IS NULL)
  OR (username IS NOT NULL AND email IS NOT NULL AND password_hash IS NOT NULL
    AND btrim(username) = username AND username <> ''
    AND lower(btrim(email)) = email AND email <> '' AND password_hash <> '')
);
CREATE UNIQUE INDEX user_username_case_insensitive ON "user" (lower(username));
CREATE UNIQUE INDEX user_email_case_insensitive ON "user" (lower(email));

ALTER TABLE escrow
  ADD CONSTRAINT escrow_distinct_parties CHECK (client_id <> provider_id),
  ADD CONSTRAINT escrow_positive_total CHECK (total_amount > 0 AND total_amount <> 'NaN'),
  ADD CONSTRAINT escrow_currency_format CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE escrow_participant ADD CONSTRAINT escrow_participant_additional_role CHECK (
  btrim(role) <> '' AND upper(btrim(role)) NOT IN ('PAYER', 'PAYEE', 'CLIENT', 'PROVIDER')
);
ALTER TABLE account
  ADD CONSTRAINT account_owner_by_type CHECK (
    (type = 'PERSONAL' AND user_id IS NOT NULL AND escrow_id IS NULL)
    OR (type = 'ESCROW' AND user_id IS NULL AND escrow_id IS NOT NULL)
    OR (type = 'EXTERNAL' AND user_id IS NULL AND escrow_id IS NULL)
  ),
  ADD CONSTRAINT account_currency_format CHECK (currency ~ '^[A-Z]{3}$');
CREATE UNIQUE INDEX account_external_per_currency ON account (currency) WHERE type = 'EXTERNAL';

ALTER TABLE milestone ADD CONSTRAINT milestone_positive_values CHECK (
  amount > 0 AND amount <> 'NaN' AND "order" > 0
);
ALTER TABLE milestone_submission ADD CONSTRAINT submission_attachments_array CHECK (
  CASE WHEN jsonb_typeof(attachments) = 'array' THEN jsonb_array_length(attachments) BETWEEN 1 AND 5 ELSE false END
);
ALTER TABLE escrow_condition ADD CONSTRAINT condition_actor_and_status CHECK (
  ((submitted_at IS NULL) = (submitted_by IS NULL))
  AND (NOT satisfied_by_system OR type = 'DEADLINE_REACHED')
  AND (
    (status = 'SATISFIED' AND satisfied_at IS NOT NULL AND ((satisfied_by IS NOT NULL) <> satisfied_by_system))
    OR (status <> 'SATISFIED' AND satisfied_at IS NULL AND satisfied_by IS NULL AND NOT satisfied_by_system)
  )
);

ALTER TABLE "transaction"
  ADD CONSTRAINT transaction_positive_amount CHECK (amount > 0 AND amount <> 'NaN'),
  ADD CONSTRAINT transaction_distinct_accounts CHECK (from_account_id <> to_account_id),
  ADD CONSTRAINT transaction_scope CHECK (
    (type IN ('DEPOSIT', 'WITHDRAWAL') AND escrow_id IS NULL AND milestone_id IS NULL AND resolution_id IS NULL)
    OR (type = 'FUND' AND escrow_id IS NOT NULL AND resolution_id IS NULL)
    OR (type IN ('RELEASE', 'REFUND') AND escrow_id IS NOT NULL)
  ),
  ADD CONSTRAINT transaction_wallet_precision CHECK (type NOT IN ('DEPOSIT', 'WITHDRAWAL') OR amount = round(amount, 2)),
  ADD CONSTRAINT transaction_idempotency_shape CHECK (
    (idempotency_key IS NULL AND request_shape IS NULL)
    OR (idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '' AND request_shape IS NOT NULL)
  );
CREATE UNIQUE INDEX transaction_completed_milestone_operation ON "transaction" (milestone_id, type)
  WHERE milestone_id IS NOT NULL AND resolution_id IS NULL AND status = 'COMPLETED';
CREATE UNIQUE INDEX transaction_completed_escrow_operation ON "transaction" (escrow_id, type)
  WHERE milestone_id IS NULL AND resolution_id IS NULL AND status = 'COMPLETED' AND type IN ('FUND', 'RELEASE', 'REFUND');

ALTER TABLE ledger_entry ADD CONSTRAINT ledger_finite_values CHECK (
  amount > 0 AND amount <> 'NaN' AND balance <> 'NaN'
);
ALTER TABLE dispute ADD CONSTRAINT dispute_resolution_timestamp CHECK (
  (status = 'RESOLVED') = (resolved_at IS NOT NULL)
);
CREATE UNIQUE INDEX dispute_active_per_escrow ON dispute (escrow_id) WHERE status <> 'RESOLVED';
ALTER TABLE dispute_evidence ADD CONSTRAINT evidence_metadata_valid CHECK (
  file_size > 0 AND file_hash ~ '^[a-f0-9]{64}$'
  AND storage_key ~ '^[a-f0-9-]+\.(pdf|jpe?g|png)$'
  AND ((type = 'PDF' AND mime_type = 'application/pdf')
    OR (type = 'JPEG' AND mime_type = 'image/jpeg')
    OR (type = 'PNG' AND mime_type = 'image/png'))
);
ALTER TABLE dispute_resolution ADD CONSTRAINT resolution_execution_values CHECK (
  length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 128
  AND ((execution_status = 'PENDING' AND remaining_escrow_balance IS NULL)
    OR (execution_status = 'PARTIAL' AND decision = 'PARTIAL_RELEASE'
      AND remaining_escrow_balance IS NOT NULL AND remaining_escrow_balance > 0 AND remaining_escrow_balance <> 'NaN')
    OR (execution_status = 'COMPLETED' AND remaining_escrow_balance IS NOT NULL AND remaining_escrow_balance = 0))
);
CREATE UNIQUE INDEX dispute_resolution_final_per_dispute ON dispute_resolution (dispute_id)
  WHERE execution_status = 'COMPLETED';
ALTER TABLE dispute_resolution_allocation ADD CONSTRAINT allocation_positive_amount CHECK (
  amount > 0 AND amount <> 'NaN' AND type IN ('RELEASE', 'REFUND')
);

CREATE FUNCTION prevent_ledger_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER ledger_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON ledger_entry
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_ledger_rewrite();

CREATE FUNCTION prevent_posted_transfer_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'Completed transfers are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER transaction_no_posted_rewrite BEFORE UPDATE OR DELETE ON "transaction"
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_transfer_rewrite();

CREATE FUNCTION validate_ledger_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  transfer "transaction"%ROWTYPE;
  transfer_id text;
  entry_count integer;
  matching_count integer;
BEGIN
  IF TG_TABLE_NAME = 'ledger_entry' THEN
    transfer_id := NEW.transaction_id;
  ELSE
    transfer_id := NEW.id;
  END IF;
  SELECT * INTO transfer FROM "transaction" WHERE id = transfer_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*), count(*) FILTER (
    WHERE amount = transfer.amount AND (
      (type = 'DEBIT' AND account_id = transfer.from_account_id)
      OR (type = 'CREDIT' AND account_id = transfer.to_account_id)
    )
  ) INTO entry_count, matching_count FROM ledger_entry WHERE transaction_id = transfer_id;
  IF (transfer.status = 'COMPLETED' AND (entry_count <> 2 OR matching_count <> 2))
    OR (transfer.status <> 'COMPLETED' AND entry_count <> 0) THEN
    RAISE EXCEPTION 'Invalid ledger posting for transfer %', transfer_id USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER transaction_balanced_posting AFTER INSERT OR UPDATE ON "transaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_ledger_posting();
CREATE CONSTRAINT TRIGGER ledger_balanced_posting AFTER INSERT ON ledger_entry
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_ledger_posting();

COMMIT;
