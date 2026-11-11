-- Quantities may have up to 2 decimals (sell rope by the metre, nails by the kg).
-- INTEGER -> DECIMAL(12,2) keeps every existing value exactly (USING col::numeric).
ALTER TABLE "product_bundle_items" ALTER COLUMN "quantity" TYPE DECIMAL(12,2) USING "quantity"::numeric;
ALTER TABLE "product_wholesale_prices" ALTER COLUMN "min_quantity" TYPE DECIMAL(12,2) USING "min_quantity"::numeric;
ALTER TABLE "stock_batches"
  ALTER COLUMN "quantity_received" TYPE DECIMAL(12,2) USING "quantity_received"::numeric,
  ALTER COLUMN "quantity_remaining" TYPE DECIMAL(12,2) USING "quantity_remaining"::numeric;
ALTER TABLE "purchase_order_items"
  ALTER COLUMN "quantity" TYPE DECIMAL(12,2) USING "quantity"::numeric,
  ALTER COLUMN "received_qty" TYPE DECIMAL(12,2) USING "received_qty"::numeric;
ALTER TABLE "supplier_return_notes" ALTER COLUMN "total_quantity" TYPE DECIMAL(12,2) USING "total_quantity"::numeric;
ALTER TABLE "supplier_return_note_items" ALTER COLUMN "quantity" TYPE DECIMAL(12,2) USING "quantity"::numeric;
ALTER TABLE "order_items"
  ALTER COLUMN "quantity" TYPE DECIMAL(12,2) USING "quantity"::numeric,
  ALTER COLUMN "base_quantity" TYPE DECIMAL(12,2) USING "base_quantity"::numeric;
ALTER TABLE "customer_claims"
  ALTER COLUMN "quantity" TYPE DECIMAL(12,2) USING "quantity"::numeric,
  ALTER COLUMN "base_quantity" TYPE DECIMAL(12,2) USING "base_quantity"::numeric,
  ALTER COLUMN "replacement_base_quantity" TYPE DECIMAL(12,2) USING "replacement_base_quantity"::numeric;
ALTER TABLE "claim_inventory" ALTER COLUMN "quantity" TYPE DECIMAL(12,2) USING "quantity"::numeric;
ALTER TABLE "order_return_items"
  ALTER COLUMN "quantity" TYPE DECIMAL(12,2) USING "quantity"::numeric,
  ALTER COLUMN "base_quantity" TYPE DECIMAL(12,2) USING "base_quantity"::numeric;
ALTER TABLE "store_settings"
  ALTER COLUMN "low_stock_threshold" TYPE DECIMAL(12,2) USING "low_stock_threshold"::numeric,
  ADD COLUMN IF NOT EXISTS "allow_decimal_qty" BOOLEAN NOT NULL DEFAULT false;
