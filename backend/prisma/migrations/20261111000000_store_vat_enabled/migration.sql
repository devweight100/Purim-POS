-- Whether this store charges VAT on sales (prices VAT-inclusive). Off = no VAT on bills or receipts.
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "vat_enabled" BOOLEAN NOT NULL DEFAULT false;
