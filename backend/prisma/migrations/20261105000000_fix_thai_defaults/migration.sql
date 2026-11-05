-- Fix Thai default values that were saved with broken encoding (UTF-8 read as Windows-1252).
ALTER TABLE "products" ALTER COLUMN "unit" SET DEFAULT 'ชิ้น';
ALTER TABLE "store_settings" ALTER COLUMN "store_name" SET DEFAULT 'ร้านปุริม POS';

-- Repair rows that already received the broken default.
UPDATE "products" SET "unit" = 'ชิ้น' WHERE "unit" = 'à¸Šà¸´à¹‰à¸™';
UPDATE "store_settings" SET "store_name" = 'ร้านปุริม POS' WHERE "store_name" = 'à¸£à¹‰à¸²à¸™à¸›à¸¸à¸£à¸´à¸¡ POS';
