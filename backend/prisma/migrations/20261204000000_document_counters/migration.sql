-- Document numbers <PP><YYMM>-<NNNN> (docs/document-numbers.md): monthly running number per document type.
-- Existing documents keep their old numbers; no backfill needed (the new format never collides with the old ones).
-- CreateTable
CREATE TABLE "document_counters" (
    "doc_type" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("doc_type","period")
);
