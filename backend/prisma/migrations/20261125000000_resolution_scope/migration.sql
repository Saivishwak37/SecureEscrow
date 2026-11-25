BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "transaction" t
    JOIN dispute_resolution r ON r.id = t.resolution_id
    JOIN dispute d ON d.id = r.dispute_id
    WHERE t.escrow_id IS DISTINCT FROM d.escrow_id
       OR t.milestone_id IS DISTINCT FROM d.milestone_id
  ) THEN
    RAISE EXCEPTION 'Existing resolution transfer does not match its dispute scope';
  END IF;
END;
$$;

CREATE FUNCTION assert_resolution_transfer_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resolution_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dispute_resolution r
    JOIN dispute d ON d.id = r.dispute_id
    WHERE r.id = NEW.resolution_id
      AND d.escrow_id = NEW.escrow_id
      AND d.milestone_id IS NOT DISTINCT FROM NEW.milestone_id
  ) THEN
    RAISE EXCEPTION 'Resolution transfer must match its dispute scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER transaction_resolution_scope BEFORE INSERT OR UPDATE OF resolution_id, escrow_id, milestone_id
  ON "transaction" FOR EACH ROW EXECUTE FUNCTION assert_resolution_transfer_scope();

CREATE FUNCTION prevent_dispute_scope_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Dispute scope is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER dispute_scope_immutable BEFORE UPDATE OF escrow_id, milestone_id ON dispute
  FOR EACH ROW WHEN (OLD.escrow_id IS DISTINCT FROM NEW.escrow_id OR OLD.milestone_id IS DISTINCT FROM NEW.milestone_id)
  EXECUTE FUNCTION prevent_dispute_scope_change();
CREATE TRIGGER resolution_scope_immutable BEFORE UPDATE OF dispute_id ON dispute_resolution
  FOR EACH ROW WHEN (OLD.dispute_id IS DISTINCT FROM NEW.dispute_id)
  EXECUTE FUNCTION prevent_dispute_scope_change();

COMMIT;
