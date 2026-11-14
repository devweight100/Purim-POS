-- POS catalogue delta sync (GET /products/sync) and product photo thumbnails (GET /product-images/:id?size=thumb).

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN IF NOT EXISTS "thumb_data_url" TEXT;

-- CreateTable: append-only change log, one row per changed product per write (no row locks taken)
CREATE TABLE IF NOT EXISTS "product_changes" (
    "id" BIGSERIAL NOT NULL,
    "product_id" TEXT NOT NULL,
    "xid" xid8 NOT NULL DEFAULT pg_current_xact_id(),
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_changes_xid_idx" ON "product_changes"("xid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_changes_changed_at_idx" ON "product_changes"("changed_at");

-- Row triggers. Each logs the product(s) whose POS catalogue row changes; an UPDATE that moves a row to another
-- product logs both. Everything that changes a product's catalogue row goes through one of these tables:
-- price / name / active edits (products), stock (stock_batches: sales, receiving, adjustments, returns, claims),
-- barcodes, packaging units, photos, wholesale prices, suppliers, bundle composition, category / supplier renames.
CREATE OR REPLACE FUNCTION purim_product_change_by_product_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO product_changes (product_id) VALUES (NEW.product_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.product_id IS DISTINCT FROM NEW.product_id) THEN
    INSERT INTO product_changes (product_id) VALUES (OLD.product_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION purim_product_change_by_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO product_changes (product_id) VALUES (NEW.id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id) THEN
    INSERT INTO product_changes (product_id) VALUES (OLD.id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION purim_product_change_by_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO product_changes (product_id) VALUES (NEW.bundle_product_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.bundle_product_id IS DISTINCT FROM NEW.bundle_product_id) THEN
    INSERT INTO product_changes (product_id) VALUES (OLD.bundle_product_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION purim_product_change_by_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO product_changes (product_id) SELECT p.id FROM products p WHERE p.category_id = NEW.id;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION purim_product_change_by_supplier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO product_changes (product_id) SELECT ps.product_id FROM product_suppliers ps WHERE ps.supplier_id = NEW.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS purim_sync_products ON "products";
CREATE TRIGGER purim_sync_products AFTER INSERT OR DELETE OR UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION purim_product_change_by_id();

DROP TRIGGER IF EXISTS purim_sync_stock_batches ON "stock_batches";
CREATE TRIGGER purim_sync_stock_batches AFTER INSERT OR DELETE ON "stock_batches"
  FOR EACH ROW EXECUTE FUNCTION purim_product_change_by_product_id();
DROP TRIGGER IF EXISTS purim_sync_stock_batches_upd ON "stock_batches";
CREATE TRIGGER purim_sync_stock_batches_upd AFTER UPDATE ON "stock_batches"
  FOR EACH ROW WHEN (OLD.quantity_remaining IS DISTINCT FROM NEW.quantity_remaining OR OLD.product_id IS DISTINCT FROM NEW.product_id)
  EXECUTE FUNCTION purim_product_change_by_product_id();

DROP TRIGGER IF EXISTS purim_sync_product_barcodes ON "product_barcodes";
CREATE TRIGGER purim_sync_product_barcodes AFTER INSERT OR DELETE OR UPDATE ON "product_barcodes"
  FOR EACH ROW EXECUTE FUNCTION purim_product_change_by_product_id();

DROP TRIGGER IF EXISTS purim_sync_product_packaging_units ON "product_packaging_units";
CREATE TRIGGER purim_sync_product_packaging_units AFTER INSERT OR DELETE OR UPDATE ON "product_packaging_units"
  FOR EACH ROW EXECUTE FUNCTION purim_product_change_by_product_id();

DROP TRIGGER IF EXISTS purim_sync_product_images ON "product_images";
CREATE TRIGGER purim_sync_product_images AFTER INSERT OR DELETE OR UPDATE ON "product_images"
  FOR EACH ROW EXECUTE FUNCTION purim_product_change_by_product_id();

DROP TRIGGER IF EXISTS purim_sync_product_wholesale_prices ON "product_wholesale_prices";
CREATE TRIGGER purim_sync_product_wholesale_prices AFTER INSERT OR DELETE OR UPDATE ON "product_wholesale_prices"
  FOR EACH ROW EXECUTE FUNCTION purim_product_change_by_product_id();

DROP TRIGGER IF EXISTS purim_sync_product_suppliers ON "product_suppliers";
CREATE TRIGGER purim_sync_product_suppliers AFTER INSERT OR DELETE OR UPDATE ON "product_suppliers"
  FOR EACH ROW EXECUTE FUNCTION purim_product_change_by_product_id();

DROP TRIGGER IF EXISTS purim_sync_product_bundle_items ON "product_bundle_items";
CREATE TRIGGER purim_sync_product_bundle_items AFTER INSERT OR DELETE OR UPDATE ON "product_bundle_items"
  FOR EACH ROW EXECUTE FUNCTION purim_product_change_by_bundle();

DROP TRIGGER IF EXISTS purim_sync_categories ON "categories";
CREATE TRIGGER purim_sync_categories AFTER UPDATE ON "categories"
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION purim_product_change_by_category();

DROP TRIGGER IF EXISTS purim_sync_suppliers ON "suppliers";
CREATE TRIGGER purim_sync_suppliers AFTER UPDATE ON "suppliers"
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION purim_product_change_by_supplier();
