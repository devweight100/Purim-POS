CREATE TYPE "CashMovementType" AS ENUM ('IN', 'OUT');

CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_movements_shift_id_idx" ON "cash_movements"("shift_id");
CREATE INDEX "cash_movements_created_at_idx" ON "cash_movements"("created_at");

ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_shift_id_fkey"
  FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
