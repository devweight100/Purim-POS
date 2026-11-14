-- Customer list delta sync (GET /customers/sync): the screens refreshed the whole customer list every 15 s.

-- CreateTable: append-only change log, one row per changed customer per write (no row locks taken)
CREATE TABLE IF NOT EXISTS "customer_changes" (
    "id" BIGSERIAL NOT NULL,
    "customer_id" TEXT NOT NULL,
    "xid" xid8 NOT NULL DEFAULT pg_current_xact_id(),
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_changes_xid_idx" ON "customer_changes"("xid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_changes_changed_at_idx" ON "customer_changes"("changed_at");

-- A customer row of the list changes with the customer itself (name, phone, points, profile, ...) and with its
-- debts (currentDebt = sum of remaining_amount).
CREATE OR REPLACE FUNCTION purim_customer_change_by_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO customer_changes (customer_id) VALUES (NEW.id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id) THEN
    INSERT INTO customer_changes (customer_id) VALUES (OLD.id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION purim_customer_change_by_customer_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO customer_changes (customer_id) VALUES (NEW.customer_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id) THEN
    INSERT INTO customer_changes (customer_id) VALUES (OLD.customer_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS purim_sync_customers ON "customers";
CREATE TRIGGER purim_sync_customers AFTER INSERT OR DELETE OR UPDATE ON "customers"
  FOR EACH ROW EXECUTE FUNCTION purim_customer_change_by_id();

DROP TRIGGER IF EXISTS purim_sync_customer_debts ON "customer_debts";
CREATE TRIGGER purim_sync_customer_debts AFTER INSERT OR DELETE ON "customer_debts"
  FOR EACH ROW EXECUTE FUNCTION purim_customer_change_by_customer_id();
DROP TRIGGER IF EXISTS purim_sync_customer_debts_upd ON "customer_debts";
CREATE TRIGGER purim_sync_customer_debts_upd AFTER UPDATE ON "customer_debts"
  FOR EACH ROW WHEN (OLD.remaining_amount IS DISTINCT FROM NEW.remaining_amount OR OLD.customer_id IS DISTINCT FROM NEW.customer_id)
  EXECUTE FUNCTION purim_customer_change_by_customer_id();
