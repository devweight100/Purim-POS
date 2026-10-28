-- Additive migration: claims & supplier returns real tables (no data removed).
-- Every statement is idempotent. Run backend/scripts/backfill-claims-from-auditlog.cjs afterwards.

ALTER TABLE "customer_claims"
  ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "unit_name" TEXT,
  ADD COLUMN IF NOT EXISTS "conversion_factor" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "base_quantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "unit_price" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "total_claim_value" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "refund_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "cost_price" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "total_cost_value" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "resolution_type" TEXT,
  ADD COLUMN IF NOT EXISTS "frontend_status" TEXT,
  ADD COLUMN IF NOT EXISTS "cashier_name" TEXT,
  ADD COLUMN IF NOT EXISTS "supplier_id" TEXT,
  ADD COLUMN IF NOT EXISTS "return_note_id" TEXT,
  ADD COLUMN IF NOT EXISTS "replacement_product_id" TEXT,
  ADD COLUMN IF NOT EXISTS "replacement_base_quantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE INDEX IF NOT EXISTS "customer_claims_supplier_id_idx" ON "customer_claims"("supplier_id");
CREATE INDEX IF NOT EXISTS "customer_claims_return_note_id_idx" ON "customer_claims"("return_note_id");

ALTER TABLE "claim_inventory"
  ADD COLUMN IF NOT EXISTS "claim_id" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_id" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_name" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "supplier_id" TEXT,
  ADD COLUMN IF NOT EXISTS "supplier_name" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "supplier_return_notes" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE TABLE IF NOT EXISTS "supplier_return_note_items" (
  "id" TEXT NOT NULL,
  "note_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "product_id" TEXT,
  "claim_id" TEXT,
  "item_type" TEXT NOT NULL DEFAULT 'DEFECTIVE',
  "product_name" TEXT,
  "sku" TEXT,
  "unit_name" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_return_note_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_return_note_items_note_id_idx" ON "supplier_return_note_items"("note_id");
CREATE INDEX IF NOT EXISTS "supplier_return_note_items_product_id_idx" ON "supplier_return_note_items"("product_id");

CREATE TABLE IF NOT EXISTS "supplier_return_note_deductions" (
  "id" TEXT NOT NULL,
  "note_id" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reference" TEXT,
  "net_paid" DECIMAL(12,2),
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_return_note_deductions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_return_note_deductions_note_id_idx" ON "supplier_return_note_deductions"("note_id");

CREATE TABLE IF NOT EXISTS "replacement_warranties" (
  "id" TEXT NOT NULL,
  "original_claim_id" TEXT,
  "original_order_id" TEXT,
  "original_order_number" TEXT,
  "replacement_date" TIMESTAMP(3),
  "customer_id" TEXT,
  "customer_name" TEXT,
  "customer_phone" TEXT,
  "product_id" TEXT,
  "product_name" TEXT,
  "sku" TEXT,
  "unit_name" TEXT,
  "unit_price" DECIMAL(12,2),
  "is_claimed" BOOLEAN NOT NULL DEFAULT false,
  "claim_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "replacement_warranties_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "replacement_warranties_original_claim_id_idx" ON "replacement_warranties"("original_claim_id");
CREATE INDEX IF NOT EXISTS "replacement_warranties_customer_id_idx" ON "replacement_warranties"("customer_id");

ALTER TABLE "customer_claims" DROP CONSTRAINT IF EXISTS "customer_claims_supplier_id_fkey";
ALTER TABLE "customer_claims" ADD CONSTRAINT "customer_claims_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_claims" DROP CONSTRAINT IF EXISTS "customer_claims_return_note_id_fkey";
ALTER TABLE "customer_claims" ADD CONSTRAINT "customer_claims_return_note_id_fkey" FOREIGN KEY ("return_note_id") REFERENCES "supplier_return_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_return_note_items" DROP CONSTRAINT IF EXISTS "supplier_return_note_items_note_id_fkey";
ALTER TABLE "supplier_return_note_items" ADD CONSTRAINT "supplier_return_note_items_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "supplier_return_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_return_note_deductions" DROP CONSTRAINT IF EXISTS "supplier_return_note_deductions_note_id_fkey";
ALTER TABLE "supplier_return_note_deductions" ADD CONSTRAINT "supplier_return_note_deductions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "supplier_return_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;