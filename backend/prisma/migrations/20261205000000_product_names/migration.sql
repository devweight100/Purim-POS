-- Product names (docs/product-names.md): ชื่อผู้ผลิต on products, ชื่อ / รหัสสินค้าของผู้ขาย per supplier row,
-- the product-name mode stored on supplier documents and its default in the store settings.

-- ชื่อผู้ผลิต
ALTER TABLE "products" ADD COLUMN "manufacturer_name" VARCHAR(200);

-- ชื่อสินค้าของผู้ขาย (new) and รหัสสินค้าของผู้ขาย (existing supplier_sku, was shown as "หมายเหตุ" in the form):
-- trim, blank = NULL; a stored value longer than 100 characters is a note rather than a code: it moves to the
-- supplier product name (cut to 200) so nothing is lost.
ALTER TABLE "product_suppliers" ADD COLUMN "supplier_product_name" VARCHAR(200);
UPDATE "product_suppliers" SET "supplier_sku" = NULLIF(btrim("supplier_sku"), '') WHERE "supplier_sku" IS NOT NULL;
UPDATE "product_suppliers" SET "supplier_product_name" = left("supplier_sku", 200), "supplier_sku" = NULL
  WHERE char_length("supplier_sku") > 100;
ALTER TABLE "product_suppliers" ALTER COLUMN "supplier_sku" SET DATA TYPE VARCHAR(100);
CREATE INDEX "product_suppliers_supplier_id_idx" ON "product_suppliers"("supplier_id");

-- name mode on supplier documents (SHOP = ชื่อร้าน, SUPPLIER = ชื่อของผู้ขาย / ผู้ผลิต); existing documents keep SHOP
ALTER TABLE "purchase_orders" ADD COLUMN "doc_name_mode" VARCHAR(10) NOT NULL DEFAULT 'SHOP';
ALTER TABLE "supplier_return_notes" ADD COLUMN "doc_name_mode" VARCHAR(10) NOT NULL DEFAULT 'SHOP';
ALTER TABLE "store_settings" ADD COLUMN "supplier_doc_name_mode" VARCHAR(10) NOT NULL DEFAULT 'SHOP';

-- search the new names like the other product fields (20261125000000_trigram_search): trigram GIN indexes,
-- skipped when pg_trgm cannot be created (searches then run as plain scans, same results).
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm not available (%): search indexes skipped', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "products_manufacturer_name_trgm_idx" ON "products" USING GIN ("manufacturer_name" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "product_suppliers_supplier_sku_trgm_idx" ON "product_suppliers" USING GIN ("supplier_sku" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "product_suppliers_supplier_product_name_trgm_idx" ON "product_suppliers" USING GIN ("supplier_product_name" gin_trgm_ops);
  END IF;
END $$;
