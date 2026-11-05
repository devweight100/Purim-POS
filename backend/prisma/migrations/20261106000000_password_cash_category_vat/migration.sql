-- Forced password change after logging in with a default credential
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- Explicit cash movement category instead of classifying by reason text
ALTER TABLE "cash_movements" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'GENERAL';
UPDATE "cash_movements" SET "category" = 'REFUND'
  WHERE "type" = 'OUT' AND ("reason" LIKE 'คืนเงินสดเคลมสินค้า%' OR "reason" LIKE 'คืนเงินสดยกเลิกบิล%');
UPDATE "cash_movements" SET "category" = 'DEBT_PAYMENT'
  WHERE "type" = 'IN' AND "reason" LIKE 'รับชำระหนี้%';

-- VAT recorded per bill (VAT-inclusive prices)
ALTER TABLE "orders" ADD COLUMN "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
