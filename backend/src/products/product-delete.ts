import { Prisma } from '@prisma/client';

/**
 * Deleting a product (owner 2026-11-19, docs/product-delete.md).
 *
 * A product may be deleted for good only while no business document names it. Its own data (stock batches from
 * adjustments / the opening stock, barcodes, packs, photos, supplier rows, wholesale prices, bundle rows of a bundle)
 * goes with it in one transaction. A product that appears in a document is refused with the documents listed, and
 * can be disabled instead (products.is_active = false): it then leaves the POS, the online shop and the pickers but
 * stays in every document and report.
 */

/** One kind of business document that keeps a product from being deleted, with how many there are. */
export interface DeleteBlocker {
  code: BlockerCode;
  /** Thai text, e.g. "บิลขาย 3 ใบ" */
  text: string;
  count: number;
}

/** Documents that name a product, in the order they are listed to the user. */
export const BLOCKERS = [
  { code: 'SALE', label: 'บิลขาย', unit: 'ใบ' },
  { code: 'SALE_RETURN', label: 'ใบคืนสินค้า/ลดหนี้', unit: 'ใบ' },
  { code: 'ONLINE_ORDER', label: 'ออเดอร์ออนไลน์', unit: 'ใบ' },
  { code: 'PURCHASE_ORDER', label: 'ใบสั่งซื้อ', unit: 'ใบ' },
  { code: 'GOODS_RECEIPT', label: 'การรับสินค้าเข้าจากใบสั่งซื้อ', unit: 'ครั้ง' },
  { code: 'SUPPLIER_RETURN', label: 'ใบคืนสินค้าผู้จำหน่าย', unit: 'ใบ' },
  { code: 'CLAIM', label: 'ใบเคลม', unit: 'ใบ' },
  { code: 'CLAIM_STOCK', label: 'รายการในคลังเคลม', unit: 'รายการ' },
  { code: 'WARRANTY', label: 'ประกันสินค้าทดแทน', unit: 'รายการ' },
  { code: 'BUNDLE', label: 'ชุดสินค้าที่ใช้สินค้านี้เป็นส่วนประกอบ', unit: 'ชุด' },
] as const;
export type BlockerCode = (typeof BLOCKERS)[number]['code'];

/** "มีบิลขาย 3 ใบ, ใบสั่งซื้อ 1 ใบ" for the blockers with a count. */
export function blockerTexts(counts: Partial<Record<BlockerCode, number>>): DeleteBlocker[] {
  return BLOCKERS.filter((b) => (counts[b.code] || 0) > 0).map((b) => ({
    code: b.code,
    count: counts[b.code]!,
    text: `${b.label} ${counts[b.code]!.toLocaleString('en-US')} ${b.unit}`,
  }));
}

/** The refusal message of a product that is named in documents. */
export function inUseMessage(name: string, blockers: DeleteBlocker[]): string {
  return `ลบสินค้า "${name}" ไม่ได้ เพราะมี${blockers.map((b) => b.text).join(', ')} ที่อ้างถึงสินค้านี้ ` +
    'เอกสารเหล่านี้ต้องเก็บไว้ จึงลบสินค้าไม่ได้ ให้ "ปิดการใช้งาน" แทน: สินค้าจะหายจากหน้าขาย ร้านออนไลน์ และการค้นหาเลือกสินค้า แต่ยังอยู่ในประวัติและรายงาน';
}

/** Stock on hand text for the delete confirmation, e.g. "ยังมีสต็อก 24 ชิ้น มูลค่าทุน ฿288 จะถูกลบออกจากคลัง". */
export function stockWarning(qty: number, unit: string, value?: number | null): string {
  const q = qty.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const v = value !== undefined && value !== null
    ? ` มูลค่าทุน ฿${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    : '';
  return `ยังมีสต็อก ${q} ${unit || 'ชิ้น'}${v} จะถูกลบออกจากคลัง`;
}

export interface DeleteCheckRow {
  id: string;
  name: string;
  sku: string;
  unit: string;
  isActive: boolean;
  /** stock on hand (sum of batches; never a bundle's computed stock) */
  stock: number;
  /** cost of the stock on hand (positive batches x their cost); a cost field */
  stockValue: number;
  blockers: DeleteBlocker[];
  canDelete: boolean;
}

/**
 * Delete check of products (`ids`, at most a few hundred): documents that name each one and the stock it holds.
 * Products not found are left out. One statement, so a bulk check costs one round trip.
 */
export async function deleteCheck(db: { $queryRaw: (q: Prisma.Sql) => Promise<unknown> } | any, ids: string[]): Promise<DeleteCheckRow[]> {
  if (!ids.length) return [];
  const rows: any[] = await db.$queryRaw(Prisma.sql`
    WITH ids AS (SELECT DISTINCT unnest(${ids}::text[]) AS id)
    SELECT p.id, p.name, p.sku, COALESCE(p.unit, '') AS unit, p.is_active AS "isActive",
      (SELECT COALESCE(SUM(b.quantity_remaining), 0)::float8 FROM stock_batches b WHERE b.product_id = p.id) AS stock,
      (SELECT COALESCE(SUM(b.quantity_remaining * b.unit_cost) FILTER (WHERE b.quantity_remaining > 0), 0)::float8
         FROM stock_batches b WHERE b.product_id = p.id) AS "stockValue",
      (SELECT COUNT(DISTINCT oi.order_id)::int FROM order_items oi WHERE oi.product_id = p.id) AS "SALE",
      (SELECT COUNT(DISTINCT ri.return_id)::int FROM order_return_items ri WHERE ri.product_id = p.id) AS "SALE_RETURN",
      (SELECT COUNT(DISTINCT oo.online_order_id)::int FROM online_order_items oo WHERE oo.product_id = p.id) AS "ONLINE_ORDER",
      (SELECT COUNT(DISTINCT pi.purchase_order_id)::int FROM purchase_order_items pi WHERE pi.product_id = p.id) AS "PURCHASE_ORDER",
      (SELECT COUNT(*)::int FROM stock_batches b WHERE b.product_id = p.id AND b.purchase_order_id IS NOT NULL) AS "GOODS_RECEIPT",
      (SELECT COUNT(DISTINCT si.note_id)::int FROM supplier_return_note_items si WHERE si.product_id = p.id) AS "SUPPLIER_RETURN",
      (SELECT COUNT(*)::int FROM customer_claims c WHERE c.product_id = p.id OR c.replacement_product_id = p.id) AS "CLAIM",
      (SELECT COUNT(*)::int FROM claim_inventory ci WHERE ci.product_id = p.id) AS "CLAIM_STOCK",
      (SELECT COUNT(*)::int FROM replacement_warranties w WHERE w.product_id = p.id) AS "WARRANTY",
      (SELECT COUNT(*)::int FROM product_bundle_items bi WHERE bi.child_product_id = p.id) AS "BUNDLE"
    FROM products p JOIN ids ON ids.id = p.id`);
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows
    .map((r) => {
      const counts: Partial<Record<BlockerCode, number>> = {};
      for (const b of BLOCKERS) counts[b.code] = Number(r[b.code]) || 0;
      const blockers = blockerTexts(counts);
      return {
        id: r.id,
        name: r.name,
        sku: r.sku,
        unit: r.unit,
        isActive: !!r.isActive,
        stock: Math.round(Number(r.stock) * 100) / 100,
        stockValue: Math.round(Number(r.stockValue) * 100) / 100,
        blockers,
        canDelete: blockers.length === 0,
      };
    })
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
