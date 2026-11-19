-- Debt receipts know the cashier shift their money went into (docs/round-start-dashboard.md).
-- POS: the current shift; back office: an OPEN shift chosen by the user, or none ("ไม่เข้ากะแคชเชียร์").
ALTER TABLE "debt_payments" ADD COLUMN     "shift_id" TEXT;

CREATE INDEX "debt_payments_shift_id_idx" ON "debt_payments"("shift_id");

ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill, same result as before for every shift summary:
-- cash receipts: the shift of their drawer movement ("debt-<payment id>")
UPDATE "debt_payments" dp SET "shift_id" = cm."shift_id"
  FROM "cash_movements" cm
  WHERE cm."id" = 'debt-' || dp."id" AND dp."shift_id" IS NULL;

-- QR / transfer receipts: the old summary rule (a shift of the user who took the money, open at that moment)
UPDATE "debt_payments" dp SET "shift_id" = (
  SELECT s."id"
  FROM "money_transactions" mt
  JOIN "money_accounts" ma ON ma."id" = mt."account_id"
  JOIN "shifts" s ON s."user_id" = mt."user_id"
    AND mt."occurred_at" >= s."opened_at"
    AND (s."closed_at" IS NULL OR mt."occurred_at" <= s."closed_at")
  WHERE mt."ref_type" = 'DEBT_PAYMENT' AND mt."ref_id" = dp."id" AND mt."type" = 'DEBT_RECEIPT'
    AND ma."type" <> 'CASH_DRAWER'
  ORDER BY s."opened_at" DESC
  LIMIT 1)
WHERE dp."shift_id" IS NULL AND dp."payment_method" <> 'CASH';
