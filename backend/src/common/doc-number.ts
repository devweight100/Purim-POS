import { Prisma } from '@prisma/client';
import { docPeriod, formatDocNumber, type DocType } from '../../../shared/src/doc-number';

export { DOC_PREFIX, docPeriod, formatDocNumber, parseDocNumber, type DocType } from '../../../shared/src/doc-number';

type Tx = Prisma.TransactionClient;

/**
 * Next document number `<PP><YYMM>-<NNNN>` (docs/document-numbers.md). Must run inside the transaction that creates
 * the document: the counter row (type, month) is incremented with an upsert, which locks it until that transaction
 * ends - a parallel create waits and gets the next value, a rolled back create gives its number back.
 * `taken` (optional) skips a value that some row already uses (e.g. a number typed by hand on a PO).
 */
export async function nextDocNumber(tx: Tx, type: DocType, opts: { at?: Date | string | number; taken?: (n: string) => Promise<boolean> } = {}): Promise<string> {
  const period = docPeriod(opts.at ?? Date.now());
  for (let i = 0; i < 1000; i++) {
    const rows = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO "document_counters" ("doc_type", "period", "last_value", "updated_at")
      VALUES (${type}, ${period}, 1, now())
      ON CONFLICT ("doc_type", "period") DO UPDATE SET "last_value" = "document_counters"."last_value" + 1, "updated_at" = now()
      RETURNING "last_value"`;
    const n = formatDocNumber(type, period, Number(rows[0].last_value));
    if (!opts.taken || !(await opts.taken(n))) return n;
  }
  throw new Error('document number counter exhausted');
}
