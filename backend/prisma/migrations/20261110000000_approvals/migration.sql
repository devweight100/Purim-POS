-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "approval_id" TEXT;

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "approval_rules" JSONB;

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "channel" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "terminal_id" TEXT,
    "context_hash" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL,
    "summary" JSONB,
    "decision_note" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "used_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_requests_status_created_at_idx" ON "approval_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_requested_by_id_idx" ON "approval_requests"("requested_by_id");

