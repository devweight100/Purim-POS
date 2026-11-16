-- PromptPay ID on a bank account: the POS generates a QR with the amount locked (offline).
-- Both columns set or both null (checked by the API; the table check keeps it so).
DO $$ BEGIN
  CREATE TYPE "PromptPayIdType" AS ENUM ('MOBILE', 'NATIONAL_ID', 'EWALLET');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "promptpay_type" "PromptPayIdType";
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "promptpay_id" TEXT;

ALTER TABLE "bank_accounts" DROP CONSTRAINT IF EXISTS "bank_accounts_promptpay_pair";
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_promptpay_pair"
  CHECK (("promptpay_type" IS NULL) = ("promptpay_id" IS NULL));
