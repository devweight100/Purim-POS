-- Online orders: claim lock (who prepares the order), the POS terminal that opened it as a bill, picking slip prints
-- AlterTable
ALTER TABLE "online_orders" ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "claimed_by_id" TEXT,
ADD COLUMN     "picking_print_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "picking_printed_at" TIMESTAMP(3),
ADD COLUMN     "pos_opened_at" TIMESTAMP(3),
ADD COLUMN     "pos_terminal_id" TEXT;

-- CreateIndex
CREATE INDEX "online_orders_claimed_by_id_idx" ON "online_orders"("claimed_by_id");

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_claimed_by_id_fkey" FOREIGN KEY ("claimed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

