-- Purchase bills: per-line discount and VAT (none / included / added on top), bill discount, totals.
ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "discount_type" TEXT NOT NULL DEFAULT 'baht',
  ADD COLUMN IF NOT EXISTS "discount_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "vat_type" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "net_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- existing lines had no discount/VAT: net = total
UPDATE "purchase_order_items" SET "net_amount" = "total" WHERE "net_amount" = 0 AND "total" <> 0;

ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "bill_discount_type" TEXT NOT NULL DEFAULT 'baht',
  ADD COLUMN IF NOT EXISTS "bill_discount_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "subtotal_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "purchase_orders" SET "subtotal_amount" = "total_amount" WHERE "subtotal_amount" = 0 AND "total_amount" <> 0;

-- stock cost with VAT/discount spread needs more than 2 decimals per unit
ALTER TABLE "stock_batches" ALTER COLUMN "unit_cost" TYPE DECIMAL(14,4);
