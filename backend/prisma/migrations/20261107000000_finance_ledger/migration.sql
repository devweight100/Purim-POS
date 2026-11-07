-- CreateEnum
CREATE TYPE "MoneyAccountType" AS ENUM ('CASH_DRAWER', 'CASH_SAFE', 'BANK', 'CARD_CLEARING');

-- CreateEnum
CREATE TYPE "MoneyDirection" AS ENUM ('IN', 'OUT');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "bank_account_id" TEXT;

-- CreateTable
CREATE TABLE "money_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MoneyAccountType" NOT NULL,
    "bank_account_id" TEXT,
    "terminal_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "money_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "direction" "MoneyDirection" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" TEXT NOT NULL,
    "category_id" TEXT,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "transfer_group_id" TEXT,
    "reversal_of_id" TEXT,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "expense_number" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "vendor" TEXT,
    "receipt_image" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "money_accounts_bank_account_id_key" ON "money_accounts"("bank_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "money_accounts_terminal_id_key" ON "money_accounts"("terminal_id");

-- CreateIndex
CREATE INDEX "money_accounts_type_idx" ON "money_accounts"("type");

-- CreateIndex
CREATE UNIQUE INDEX "money_transactions_reversal_of_id_key" ON "money_transactions"("reversal_of_id");

-- CreateIndex
CREATE INDEX "money_transactions_account_id_occurred_at_idx" ON "money_transactions"("account_id", "occurred_at");

-- CreateIndex
CREATE INDEX "money_transactions_ref_type_ref_id_idx" ON "money_transactions"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "money_transactions_transfer_group_id_idx" ON "money_transactions"("transfer_group_id");

-- CreateIndex
CREATE INDEX "money_transactions_type_occurred_at_idx" ON "money_transactions"("type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_expense_number_key" ON "expenses"("expense_number");

-- CreateIndex
CREATE INDEX "expenses_paid_at_idx" ON "expenses"("paid_at");

-- CreateIndex
CREATE INDEX "expenses_category_id_idx" ON "expenses"("category_id");

-- AddForeignKey
ALTER TABLE "money_accounts" ADD CONSTRAINT "money_accounts_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Default expense categories (editable in the app)
INSERT INTO "expense_categories" ("id", "name", "sort_order") VALUES
  (gen_random_uuid()::text, 'ค่าเช่าที่', 1),
  (gen_random_uuid()::text, 'ค่าไฟฟ้า / ค่าน้ำ', 2),
  (gen_random_uuid()::text, 'เงินเดือน / ค่าแรง', 3),
  (gen_random_uuid()::text, 'ค่าขนส่ง / น้ำมัน', 4),
  (gen_random_uuid()::text, 'ค่าโทรศัพท์ / อินเทอร์เน็ต', 5),
  (gen_random_uuid()::text, 'วัสดุสิ้นเปลือง / ถุง / บรรจุภัณฑ์', 6),
  (gen_random_uuid()::text, 'ค่าซ่อมบำรุง', 7),
  (gen_random_uuid()::text, 'ค่าธรรมเนียมธนาคาร / บัตร', 8),
  (gen_random_uuid()::text, 'ภาษี / ค่าธรรมเนียมราชการ', 9),
  (gen_random_uuid()::text, 'ค่าใช้จ่ายเบ็ดเตล็ด', 10)
ON CONFLICT ("name") DO NOTHING;
