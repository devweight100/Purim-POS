-- Online orders: "จัดของเสร็จ" (READY status, who picked and when). The claim lock covers only the picking phase; payment is open to every cashier.
-- AlterEnum
ALTER TYPE "OnlineOrderStatus" ADD VALUE 'READY' AFTER 'PREPARING';

-- AlterTable
ALTER TABLE "online_orders" ADD COLUMN     "picked_at" TIMESTAMP(3),
ADD COLUMN     "picked_by_id" TEXT;

-- CreateIndex
CREATE INDEX "online_orders_picked_by_id_idx" ON "online_orders"("picked_by_id");

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_picked_by_id_fkey" FOREIGN KEY ("picked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

