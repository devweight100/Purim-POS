-- Bank logos for the shop's receiving accounts (docs/product-form-bank-logos.md). Additive only.
ALTER TABLE "bank_accounts" ADD COLUMN "bank_code" TEXT;
ALTER TABLE "bank_accounts" ADD COLUMN "logo_url" TEXT;
