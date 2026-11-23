-- POS price level (docs/pos-price-level.md): level of each bill, start-of-bill dialog and walk-in level settings
ALTER TABLE "orders" ADD COLUMN "price_level" INTEGER;
ALTER TABLE "store_settings" ADD COLUMN "pos_ask_customer_at_start" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "store_settings" ADD COLUMN "walk_in_level_needs_discount" BOOLEAN NOT NULL DEFAULT false;
