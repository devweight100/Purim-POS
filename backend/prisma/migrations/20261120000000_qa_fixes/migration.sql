-- QA fixes: token revocation, single low-stock threshold, cash-movement approval limit.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "cash_movement_approval_limit" DECIMAL(12,2) NOT NULL DEFAULT 1000;
