-- What the shop shows on its receipts (slip / A4), shared by every terminal. NULL = defaults
-- (shared/src/receipt-options.ts).
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "receipt_options" JSONB;
