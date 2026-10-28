ALTER TABLE "shifts" ADD COLUMN "terminal_id" TEXT;
CREATE UNIQUE INDEX "shifts_open_terminal_key" ON "shifts" ("terminal_id") WHERE "status" = 'OPEN' AND "terminal_id" IS NOT NULL;
ALTER TABLE "customers" ADD COLUMN "profile" JSONB;
ALTER TABLE "orders" ADD COLUMN "points_used" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "points_earned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "base_quantity" INTEGER;
ALTER TABLE "order_items" ADD COLUMN "unit_name" TEXT;
ALTER TABLE "order_items" ADD COLUMN "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "store_settings" ADD COLUMN "loyalty_config" JSONB;
