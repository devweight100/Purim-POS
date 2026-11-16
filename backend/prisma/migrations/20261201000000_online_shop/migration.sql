-- Online shop from LINE (LIFF): orders, link requests, visitors, settings; service products (ค่าส่ง) never touch stock.
-- docs/online-shop.md

-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('NEW', 'ACCEPTED', 'PREPARING', 'DELIVERING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnlineFulfillment" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "LineLinkStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "is_service" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "online_shop_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "liff_id" TEXT,
    "login_channel_id" TEXT,
    "messaging_token" TEXT,
    "public_base_url" TEXT,
    "allow_pickup" BOOLEAN NOT NULL DEFAULT true,
    "allow_delivery" BOOLEAN NOT NULL DEFAULT true,
    "notice" TEXT,
    "level_names" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_shop_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_visitors" (
    "line_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "picture_url" TEXT,
    "customer_id" TEXT,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "address" TEXT,
    "linked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_visitors_pkey" PRIMARY KEY ("line_user_id")
);

-- CreateTable
CREATE TABLE "line_link_requests" (
    "id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "phone" TEXT NOT NULL,
    "status" "LineLinkStatus" NOT NULL DEFAULT 'PENDING',
    "customer_id" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_link_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_orders" (
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "status" "OnlineOrderStatus" NOT NULL DEFAULT 'NEW',
    "line_user_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "price_level" INTEGER NOT NULL DEFAULT 1,
    "fulfillment" "OnlineFulfillment" NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "address" TEXT,
    "note" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "delivery_fee" DECIMAL(12,2),
    "total_amount" DECIMAL(12,2) NOT NULL,
    "reject_reason" TEXT,
    "pos_order_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "accepted_by_id" TEXT,
    "done_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "line_notice" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_order_items" (
    "id" TEXT NOT NULL,
    "online_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "unit_id" TEXT,
    "unit_name" TEXT NOT NULL,
    "factor" INTEGER NOT NULL DEFAULT 1,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "online_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_visitors_customer_id_idx" ON "shop_visitors"("customer_id");

-- CreateIndex
CREATE INDEX "line_link_requests_status_created_at_idx" ON "line_link_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "line_link_requests_line_user_id_idx" ON "line_link_requests"("line_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_order_no_key" ON "online_orders"("order_no");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_pos_order_id_key" ON "online_orders"("pos_order_id");

-- CreateIndex
CREATE INDEX "online_orders_status_created_at_idx" ON "online_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "online_orders_line_user_id_created_at_idx" ON "online_orders"("line_user_id", "created_at");

-- CreateIndex
CREATE INDEX "online_orders_customer_id_idx" ON "online_orders"("customer_id");

-- CreateIndex
CREATE INDEX "online_order_items_online_order_id_idx" ON "online_order_items"("online_order_id");

-- CreateIndex
CREATE INDEX "online_order_items_product_id_idx" ON "online_order_items"("product_id");

-- AddForeignKey
ALTER TABLE "shop_visitors" ADD CONSTRAINT "shop_visitors_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_order_items" ADD CONSTRAINT "online_order_items_online_order_id_fkey" FOREIGN KEY ("online_order_id") REFERENCES "online_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_order_items" ADD CONSTRAINT "online_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

