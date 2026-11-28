-- Barcodes supplied per supplier on a product (docs/product-supplier-excel.md).
-- Additive and safe for existing rows: existing product_suppliers rows start with an empty text array.
ALTER TABLE "product_suppliers" ADD COLUMN IF NOT EXISTS "barcodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
