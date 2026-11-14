-- Substring search (ILIKE '%...%') for the paged management lists: trigram GIN indexes.
-- pg_trgm ships with PostgreSQL contrib (postgres:16-alpine image, EDB Windows installers) and is a trusted
-- extension. If it cannot be created, the indexes are skipped and searches run as plain scans (same results).
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm not available (%): search indexes skipped', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "products_sku_trgm_idx" ON "products" USING GIN ("sku" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "product_barcodes_barcode_trgm_idx" ON "product_barcodes" USING GIN ("barcode" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "product_packaging_units_barcode_trgm_idx" ON "product_packaging_units" USING GIN ("barcode" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "customers_name_trgm_idx" ON "customers" USING GIN ("name" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "customers_phone_trgm_idx" ON "customers" USING GIN ("phone" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "orders_order_number_trgm_idx" ON "orders" USING GIN ("order_number" gin_trgm_ops);
  END IF;
END $$;
