import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Groundwork for matching a photographed supplier invoice against an open PO (docs/product-names.md
 * "Invoice matching"; no OCR yet). Given a supplier and one free-text invoice line (a code or a name), returns the
 * candidate products of that supplier, best first:
 *   1. the supplier's product code equals the text (case / space-insensitive)    -> matchedBy 'supplierCode', score 1
 *   2. the shop SKU or a barcode / pack barcode equals the text                    -> matchedBy 'barcode', score 0.99
 *   3. name similarity (pg_trgm `similarity`) of the text with the supplier's product name, the manufacturer name
 *      and the shop name, the best of the three                                    -> 'supplierName' | 'manufacturerName' | 'shopName'
 * Candidates = products linked to the supplier (product_suppliers), or with `purchaseOrderId` the lines of that PO
 * (then each candidate also carries its `purchaseOrderItemId`). Without pg_trgm the same trigram measure is
 * computed in JavaScript over the candidates (same order, slightly different numbers).
 */
export interface SupplierLineMatch {
  productId: string;
  name: string;
  sku: string;
  manufacturerName: string | null;
  supplierProductName: string | null;
  supplierSku: string | null;
  purchaseOrderItemId: string | null;
  matchedBy: 'supplierCode' | 'barcode' | 'supplierName' | 'manufacturerName' | 'shopName';
  score: number;
}

export interface SupplierLineQuery {
  supplierId: string;
  text: string;
  purchaseOrderId?: string | null;
  limit?: number;
  /** lowest name similarity returned (0..1, default 0.1) */
  minScore?: number;
}

const MAX_TEXT = 300;

/** Normalised text: trimmed, inner spaces collapsed, lower case. */
export const normLine = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** pg_trgm-like trigram set of a string (words padded with two spaces in front, one behind). */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of normLine(s).split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean)) {
    const w = `  ${word} `;
    const chars = Array.from(w);
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(''));
  }
  return out;
}

/** Trigram similarity (shared / union), the measure pg_trgm's similarity() uses. */
export function trigramSimilarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

interface CandidateRow {
  productId: string;
  name: string;
  sku: string;
  manufacturerName: string | null;
  supplierProductName: string | null;
  supplierSku: string | null;
  purchaseOrderItemId: string | null;
  codeExact: boolean;
  barcodeExact: boolean;
  simSupplier: number | null;
  simManufacturer: number | null;
  simShop: number | null;
}

let trgmAvailable: boolean | null = null;

async function hasTrgm(db: any): Promise<boolean> {
  if (trgmAvailable === null) {
    const rows: { ok: boolean }[] = await db.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS ok`;
    trgmAvailable = !!rows[0]?.ok;
  }
  return trgmAvailable;
}

/** Test hook: forget the cached pg_trgm check (or force the JavaScript fallback with `false`). */
export function setTrgmAvailableForTest(value: boolean | null) {
  trgmAvailable = value;
}

export async function matchSupplierLine(db: any, q: SupplierLineQuery): Promise<SupplierLineMatch[]> {
  const supplierId = typeof q.supplierId === 'string' ? q.supplierId.trim() : '';
  if (!supplierId) throw new BadRequestException('กรุณาระบุผู้จำหน่าย');
  const text = String(q.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new BadRequestException('กรุณาระบุชื่อหรือรหัสสินค้าจากบิล');
  if (text.length > MAX_TEXT) throw new BadRequestException(`ข้อความยาวเกิน ${MAX_TEXT} ตัวอักษร`);
  const limit = Math.max(1, Math.min(20, Math.floor(Number(q.limit) || 5)));
  const minScore = Number.isFinite(Number(q.minScore)) ? Math.max(0, Math.min(1, Number(q.minScore))) : 0.1;
  const poId = q.purchaseOrderId ? String(q.purchaseOrderId) : null;
  const trgm = await hasTrgm(db);
  const lowered = text.toLowerCase();

  const sim = (col: string) =>
    trgm ? Prisma.sql`similarity(COALESCE(${Prisma.raw(col)}, ''), ${text})::float8` : Prisma.sql`NULL::float8`;
  const base = poId
    ? Prisma.sql`SELECT DISTINCT ON (i.product_id) i.product_id, i.id AS po_item_id
                 FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.purchase_order_id
                 WHERE po.id = ${poId} AND po.supplier_id = ${supplierId} ORDER BY i.product_id, i.id`
    : Prisma.sql`SELECT ps0.product_id, NULL::text AS po_item_id FROM product_suppliers ps0 WHERE ps0.supplier_id = ${supplierId}`;
  const rows: CandidateRow[] = await db.$queryRaw`
    WITH c AS (${base})
    SELECT p.id AS "productId", p.name, p.sku, p.manufacturer_name AS "manufacturerName",
      ps.supplier_product_name AS "supplierProductName", ps.supplier_sku AS "supplierSku", c.po_item_id AS "purchaseOrderItemId",
      (ps.supplier_sku IS NOT NULL AND lower(regexp_replace(btrim(ps.supplier_sku), '\\s+', ' ', 'g')) = ${lowered}) AS "codeExact",
      (lower(p.sku) = ${lowered}
        OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND lower(b.barcode) = ${lowered})
        OR EXISTS (SELECT 1 FROM product_packaging_units u WHERE u.product_id = p.id AND lower(u.barcode) = ${lowered})) AS "barcodeExact",
      ${sim('ps.supplier_product_name')} AS "simSupplier",
      ${sim('p.manufacturer_name')} AS "simManufacturer",
      ${sim('p.name')} AS "simShop"
    FROM c
    JOIN products p ON p.id = c.product_id
    LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.supplier_id = ${supplierId}`;

  const scored = rows.map((r): SupplierLineMatch => {
    const s = trgm
      ? { supplierName: Number(r.simSupplier) || 0, manufacturerName: Number(r.simManufacturer) || 0, shopName: Number(r.simShop) || 0 }
      : {
          supplierName: r.supplierProductName ? trigramSimilarity(r.supplierProductName, text) : 0,
          manufacturerName: r.manufacturerName ? trigramSimilarity(r.manufacturerName, text) : 0,
          shopName: trigramSimilarity(r.name, text),
        };
    let matchedBy: SupplierLineMatch['matchedBy'];
    let score: number;
    if (r.codeExact) {
      matchedBy = 'supplierCode';
      score = 1;
    } else if (r.barcodeExact) {
      matchedBy = 'barcode';
      score = 0.99;
    } else {
      // best name; ties prefer the supplier's own name, then the manufacturer's
      const order: Array<keyof typeof s> = ['supplierName', 'manufacturerName', 'shopName'];
      matchedBy = order.reduce((best, k) => (s[k] > s[best] ? k : best), order[0]);
      score = Math.round(Math.min(0.98, s[matchedBy]) * 10000) / 10000;
    }
    return {
      productId: r.productId,
      name: r.name,
      sku: r.sku,
      manufacturerName: r.manufacturerName,
      supplierProductName: r.supplierProductName,
      supplierSku: r.supplierSku,
      purchaseOrderItemId: r.purchaseOrderItemId,
      matchedBy,
      score,
    };
  });
  return scored
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'th') || a.productId.localeCompare(b.productId))
    .slice(0, limit);
}
