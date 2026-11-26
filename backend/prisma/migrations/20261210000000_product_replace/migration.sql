-- Delete a used product with a replacement (docs/round-shift-today-bundle-replace.md). Additive only.
-- Document lines keep the name / code the product had when they were written once their product_id is moved to the
-- replacement (snapshot_name / snapshot_sku, filled from the deleted product inside the replace transaction just
-- before the lines are repointed; NULL = the line still shows its product's current name, as before).
ALTER TABLE "order_items" ADD COLUMN "snapshot_name" TEXT, ADD COLUMN "snapshot_sku" TEXT;
ALTER TABLE "order_return_items" ADD COLUMN "snapshot_name" TEXT, ADD COLUMN "snapshot_sku" TEXT;
ALTER TABLE "online_order_items" ADD COLUMN "snapshot_name" TEXT, ADD COLUMN "snapshot_sku" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN "snapshot_name" TEXT, ADD COLUMN "snapshot_sku" TEXT;
ALTER TABLE "customer_claims" ADD COLUMN "snapshot_name" TEXT, ADD COLUMN "snapshot_sku" TEXT;
ALTER TABLE "claim_inventory" ADD COLUMN "snapshot_name" TEXT, ADD COLUMN "snapshot_sku" TEXT;

-- Tombstone: a deleted product id -> the product that replaced it. Checkout / online orders / sync map a line that
-- still carries the old id (held bill, offline outbox, an online shop cart) to the replacement. No foreign keys: the
-- old product is gone, and "delete all products" must not be blocked by it.
CREATE TABLE "product_replacements" (
    "old_product_id" TEXT NOT NULL,
    "replacement_product_id" TEXT NOT NULL,
    "old_name" TEXT NOT NULL,
    "old_sku" TEXT NOT NULL,
    "user_id" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_replacements_pkey" PRIMARY KEY ("old_product_id")
);
CREATE INDEX "product_replacements_replacement_product_id_idx" ON "product_replacements"("replacement_product_id");

-- Claims screens: a claim whose product was replaced keeps the name / code it was recorded with.
CREATE OR REPLACE VIEW claim_records AS
SELECT
  f.claim_id,
  f.claim_key,
  c.received_date,
  c.product_id,
  c.customer_id,
  COALESCE(c.order_id, '') AS order_id,
  f.claim_date,
  f.res_type,
  f.status,
  f.has_return_doc,
  f.return_doc_id,
  f.quantity,
  f.conversion_factor,
  f.base_quantity,
  COALESCE(f.unit_price, COALESCE(p.price_level_1, p.base_price, 0)::double precision) AS unit_price,
  COALESCE(f.claim_value, COALESCE(f.unit_price, COALESCE(p.price_level_1, p.base_price, 0)::double precision) * f.quantity) AS total_claim_value,
  f.refund_amount,
  COALESCE(NULLIF(o.order_number, ''), f.order_number, '-') AS order_number,
  COALESCE(NULLIF(cu.name, ''), f.customer_name, 'ลูกค้าทั่วไป') AS customer_name,
  COALESCE(NULLIF(cu.phone, ''), f.customer_phone, '-') AS customer_phone,
  COALESCE(NULLIF(c.snapshot_name, ''), NULLIF(p.name, ''), f.product_name, 'สินค้า') AS product_name,
  COALESCE(NULLIF(c.snapshot_sku, ''), NULLIF(p.sku, ''), f.sku, '-') AS sku,
  f.defect_reason,
  -- (unitName ?? product unit ?? 'ชิ้น') || store unit || 'ชิ้น' (a given but empty unit name falls back the same way)
  COALESCE(f.unit_name, NULLIF(p.unit, ''), 'ชิ้น') AS unit_name,
  f.replacement_unit_name,
  f.supplier_id,
  f.supplier_name,
  f.cost_price
FROM claim_facts f
JOIN customer_claims c ON c.id = f.claim_id
JOIN products p ON p.id = c.product_id
LEFT JOIN customers cu ON cu.id = c.customer_id
LEFT JOIN orders o ON o.id = c.order_id;
