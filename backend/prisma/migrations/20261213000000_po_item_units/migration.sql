-- PO lines in a packaging unit (docs/po-grid-entry.md): quantity / unit_cost / received_qty of a line are in its unit,
-- unit_factor base units per unit. Additive only: existing lines get factor 1 and no unit name (= the product's base
-- unit, as they always were). ADD COLUMN with a constant default does not rewrite the table (PostgreSQL 11+).
ALTER TABLE "purchase_order_items" ADD COLUMN "unit_id" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN "unit_name" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN "unit_factor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_unit_factor_check" CHECK ("unit_factor" >= 1);
