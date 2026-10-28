CREATE TABLE "product_packaging_units" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty_per_prev" INTEGER NOT NULL DEFAULT 1,
    "barcode" TEXT,
    "price_level_1" DECIMAL(10,2),
    "price_level_2" DECIMAL(10,2),
    "price_level_3" DECIMAL(10,2),
    "price_level_4" DECIMAL(10,2),
    "price_level_5" DECIMAL(10,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_packaging_units_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "data_url" TEXT NOT NULL,
    "name" TEXT,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_wholesale_prices" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "min_quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_wholesale_prices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_packaging_units_product_id_idx" ON "product_packaging_units"("product_id");
CREATE INDEX "product_packaging_units_barcode_idx" ON "product_packaging_units"("barcode");
CREATE INDEX "product_images_product_id_idx" ON "product_images"("product_id");
CREATE INDEX "product_wholesale_prices_product_id_idx" ON "product_wholesale_prices"("product_id");

ALTER TABLE "product_packaging_units"
  ADD CONSTRAINT "product_packaging_units_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_wholesale_prices"
  ADD CONSTRAINT "product_wholesale_prices_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
