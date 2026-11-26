import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { deleteCheck } from './product-delete';

/**
 * Delete a USED product with a replacement (owner 2026-11-26, docs/round-shift-today-bundle-replace.md).
 *
 * Old bills / documents keep the name, code and prices they were written with (snapshot_name / snapshot_sku on the
 * lines, filled from the deleted product just before the lines are moved; prices and amounts are never touched).
 * Reports by product and the stock card count the history under the replacement (product_id / audit_logs.entity_id
 * moved). A product with stock on hand is refused (adjust it to 0 first). Everything in ONE transaction with both
 * product rows locked. `product_replacements` keeps old id -> replacement for lines that still carry the old id
 * (held bills, offline outbox, online shop carts): checkout and the online shop map them.
 */

/** Document lines that carry a product (table, label, unit) - what the confirmation counts. */
export const REPLACE_COUNTS = [
  { code: 'SALE', label: 'บิลขาย', unit: 'ใบ' },
  { code: 'SALE_LINE', label: 'รายการในบิลขาย', unit: 'รายการ' },
  { code: 'SALE_RETURN', label: 'ใบคืนสินค้า/ลดหนี้', unit: 'ใบ' },
  { code: 'ONLINE_ORDER', label: 'ออเดอร์ออนไลน์', unit: 'ใบ' },
  { code: 'PURCHASE_ORDER', label: 'ใบสั่งซื้อ', unit: 'ใบ' },
  { code: 'SUPPLIER_RETURN', label: 'ใบคืนสินค้าผู้จำหน่าย', unit: 'ใบ' },
  { code: 'CLAIM', label: 'ใบเคลม', unit: 'ใบ' },
  { code: 'CLAIM_STOCK', label: 'รายการในคลังเคลม', unit: 'รายการ' },
  { code: 'WARRANTY', label: 'ประกันสินค้าทดแทน', unit: 'รายการ' },
  { code: 'BUNDLE', label: 'ชุดสินค้าที่มีสินค้านี้', unit: 'ชุด' },
  { code: 'MOVEMENT', label: 'ความเคลื่อนไหวสต็อก', unit: 'รายการ' },
  { code: 'BATCH', label: 'ล็อตสต็อก (ประวัติรับเข้า)', unit: 'ล็อต' },
] as const;
export type ReplaceCountCode = (typeof REPLACE_COUNTS)[number]['code'];

export interface ReplaceCheck {
  product: { id: string; name: string; sku: string; unit: string; stock: number; isBundle: boolean };
  replacement: { id: string; name: string; sku: string; unit: string; isBundle: boolean; isActive: boolean } | null;
  counts: Record<ReplaceCountCode, number>;
  /** "บิลขาย 3 ใบ" for the non-zero counts */
  texts: string[];
  barcodes: string[];
  /** why it cannot be done now (empty = it can) */
  problems: { code: string; message: string }[];
  canReplace: boolean;
}

async function countsOf(db: any, id: string): Promise<Record<ReplaceCountCode, number>> {
  const [r] = await db.$queryRaw(Prisma.sql`
    SELECT
      (SELECT COUNT(DISTINCT order_id)::int FROM order_items WHERE product_id = ${id}) AS "SALE",
      (SELECT COUNT(*)::int FROM order_items WHERE product_id = ${id}) AS "SALE_LINE",
      (SELECT COUNT(DISTINCT return_id)::int FROM order_return_items WHERE product_id = ${id}) AS "SALE_RETURN",
      (SELECT COUNT(DISTINCT online_order_id)::int FROM online_order_items WHERE product_id = ${id}) AS "ONLINE_ORDER",
      (SELECT COUNT(DISTINCT purchase_order_id)::int FROM purchase_order_items WHERE product_id = ${id}) AS "PURCHASE_ORDER",
      (SELECT COUNT(DISTINCT note_id)::int FROM supplier_return_note_items WHERE product_id = ${id}) AS "SUPPLIER_RETURN",
      (SELECT COUNT(*)::int FROM customer_claims WHERE product_id = ${id} OR replacement_product_id = ${id}) AS "CLAIM",
      (SELECT COUNT(*)::int FROM claim_inventory WHERE product_id = ${id}) AS "CLAIM_STOCK",
      (SELECT COUNT(*)::int FROM replacement_warranties WHERE product_id = ${id}) AS "WARRANTY",
      (SELECT COUNT(*)::int FROM product_bundle_items WHERE child_product_id = ${id}) AS "BUNDLE",
      (SELECT COUNT(*)::int FROM audit_logs WHERE entity_id = ${id} AND left(action, 6) = 'STOCK_') AS "MOVEMENT",
      (SELECT COUNT(*)::int FROM stock_batches WHERE product_id = ${id}) AS "BATCH"`);
  const out = {} as Record<ReplaceCountCode, number>;
  for (const c of REPLACE_COUNTS) out[c.code] = Number(r?.[c.code]) || 0;
  return out;
}

export function countTexts(counts: Record<ReplaceCountCode, number>): string[] {
  return REPLACE_COUNTS.filter((c) => counts[c.code] > 0 && c.code !== 'SALE_LINE').map(
    (c) => `${c.label} ${counts[c.code].toLocaleString('en-US')} ${c.unit}`,
  );
}

/** What deleting `id` with `replacementId` would move, and why it cannot be done (if so). */
export async function replaceCheck(db: any, id: string, replacementId?: string | null): Promise<ReplaceCheck> {
  const [row] = await deleteCheck(db, [id]);
  if (!row) throw new NotFoundException('ไม่พบสินค้านี้');
  const own = await db.product.findUnique({ where: { id }, select: { isBundle: true, barcodes: { select: { barcode: true } } } });
  const counts = await countsOf(db, id);
  const problems: { code: string; message: string }[] = [];
  if (row.stock !== 0) {
    problems.push({
      code: 'STOCK_NOT_ZERO',
      message: `สินค้านี้ยังมีสต็อก ${row.stock.toLocaleString('en-US')} ${row.unit || 'ชิ้น'} ต้องปรับสต็อกให้เป็น 0 ก่อน แล้วจึงลบและย้ายประวัติไปสินค้าทดแทน`,
    });
  }
  let replacement: ReplaceCheck['replacement'] = null;
  if (replacementId) {
    const r = await db.product.findUnique({ where: { id: replacementId }, select: { id: true, name: true, sku: true, unit: true, isBundle: true, isActive: true } });
    if (!r) problems.push({ code: 'REPLACEMENT_NOT_FOUND', message: 'ไม่พบสินค้าทดแทน (อาจถูกลบไปแล้ว)' });
    else {
      replacement = { id: r.id, name: r.name, sku: r.sku, unit: r.unit || '', isBundle: !!r.isBundle, isActive: r.isActive !== false };
      if (r.id === id) problems.push({ code: 'SAME_PRODUCT', message: 'สินค้าทดแทนต้องไม่ใช่สินค้าตัวเดียวกัน' });
      else {
        if (!!r.isBundle !== !!own?.isBundle) {
          problems.push({
            code: 'KIND_MISMATCH',
            message: own?.isBundle ? 'สินค้าชุดต้องแทนด้วยสินค้าชุดเท่านั้น' : 'สินค้าทดแทนต้องไม่ใช่สินค้าชุด (ชุดสินค้าห้ามซ้อนกัน)',
          });
        }
        if (r.isActive === false) problems.push({ code: 'REPLACEMENT_INACTIVE', message: 'สินค้าทดแทนปิดการใช้งานอยู่ เปิดใช้งานก่อน หรือเลือกสินค้าอื่น' });
        // bundle cycle: the replacement (a bundle) must not contain the product, nor be contained by it
        if (r.isBundle) {
          const loop = await db.productBundleItem.count({
            where: { OR: [{ bundleProductId: r.id, childProductId: id }, { bundleProductId: id, childProductId: r.id }] },
          });
          if (loop) problems.push({ code: 'BUNDLE_CYCLE', message: 'สินค้าทดแทนเป็นชุดที่มีสินค้านี้อยู่ (จะเกิดชุดซ้อนตัวเอง)' });
        }
      }
    }
  } else {
    problems.push({ code: 'REPLACEMENT_REQUIRED', message: 'กรุณาเลือกสินค้าทดแทน' });
  }
  return {
    product: { id: row.id, name: row.name, sku: row.sku, unit: row.unit, stock: row.stock, isBundle: !!own?.isBundle },
    replacement,
    counts,
    texts: countTexts(counts),
    barcodes: (own?.barcodes || []).map((b: any) => b.barcode),
    problems,
    canReplace: problems.length === 0,
  };
}

/**
 * Delete `id` and move its history to `replacementId` (one transaction, both rows locked). Throws 409 with the
 * problems when it cannot be done (stock not 0, same product, kind mismatch, inactive replacement, bundle cycle).
 */
export async function replaceProduct(
  tx: any,
  id: string,
  replacementId: string,
  opts: { moveBarcodes: boolean; actor?: { id?: string; fullName?: string; username?: string } },
) {
  // lock both rows (fixed order: no deadlock between two replaces of the same pair)
  const locked: { id: string }[] = await tx.$queryRaw(
    Prisma.sql`SELECT id FROM products WHERE id IN (${id}, ${replacementId}) ORDER BY id FOR UPDATE`,
  );
  if (!locked.some((r: { id: string }) => r.id === id)) throw new NotFoundException('ไม่พบสินค้านี้');
  const check = await replaceCheck(tx, id, replacementId);
  if (!check.canReplace) {
    throw new ConflictException({
      statusCode: 409,
      code: check.problems[0].code,
      message: check.problems.map((p) => p.message).join(' / '),
      problems: check.problems,
      productId: id,
    });
  }
  const old = await tx.product.findUnique({ where: { id } });
  const name = old.name as string;
  const sku = old.sku as string;
  const R = replacementId;

  // 1. snapshot the original name / code on every line BEFORE moving it (lines already holding one keep theirs)
  for (const table of ['order_items', 'order_return_items', 'online_order_items', 'purchase_order_items', 'customer_claims', 'claim_inventory']) {
    await tx.$executeRawUnsafe(
      `UPDATE "${table}" SET snapshot_name = COALESCE(snapshot_name, $1), snapshot_sku = COALESCE(snapshot_sku, $2) WHERE product_id = $3`,
      name, sku, id,
    );
  }
  // claims shown from claim_records fall back to the product's price / unit: keep those of the old product
  await tx.$executeRaw(Prisma.sql`
    UPDATE customer_claims SET unit_price = COALESCE(unit_price, ${old.priceLevel1 ?? old.basePrice}), unit_name = COALESCE(unit_name, NULLIF(${old.unit || ''}, ''))
    WHERE product_id = ${id}`);
  // documents with their own name / code columns: fill them where empty
  await tx.$executeRaw(Prisma.sql`UPDATE supplier_return_note_items SET product_name = COALESCE(NULLIF(product_name, ''), ${name}), sku = COALESCE(NULLIF(sku, ''), ${sku}) WHERE product_id = ${id}`);
  await tx.$executeRaw(Prisma.sql`UPDATE replacement_warranties SET product_name = COALESCE(NULLIF(product_name, ''), ${name}), sku = COALESCE(NULLIF(sku, ''), ${sku}) WHERE product_id = ${id}`);

  // 2. move the lines / history to the replacement
  const moved: Record<string, number> = {};
  for (const [key, sql] of [
    ['orderItems', Prisma.sql`UPDATE order_items SET product_id = ${R} WHERE product_id = ${id}`],
    ['returnItems', Prisma.sql`UPDATE order_return_items SET product_id = ${R} WHERE product_id = ${id}`],
    ['onlineOrderItems', Prisma.sql`UPDATE online_order_items SET product_id = ${R} WHERE product_id = ${id}`],
    ['purchaseOrderItems', Prisma.sql`UPDATE purchase_order_items SET product_id = ${R} WHERE product_id = ${id}`],
    ['supplierReturnItems', Prisma.sql`UPDATE supplier_return_note_items SET product_id = ${R} WHERE product_id = ${id}`],
    ['claims', Prisma.sql`UPDATE customer_claims SET product_id = ${R} WHERE product_id = ${id}`],
    ['claimReplacements', Prisma.sql`UPDATE customer_claims SET replacement_product_id = ${R} WHERE replacement_product_id = ${id}`],
    ['claimInventory', Prisma.sql`UPDATE claim_inventory SET product_id = ${R} WHERE product_id = ${id}`],
    ['warranties', Prisma.sql`UPDATE replacement_warranties SET product_id = ${R} WHERE product_id = ${id}`],
    // stock is 0 in total: batches that only net to 0 (an oversold batch + a later receipt) are settled at 0 first,
    // so the replacement's stock and FIFO cost do not change; the receipt history moves with them
    ['batchesSettled', Prisma.sql`UPDATE stock_batches SET quantity_remaining = 0 WHERE product_id = ${id} AND quantity_remaining <> 0`],
    ['batches', Prisma.sql`UPDATE stock_batches SET product_id = ${R} WHERE product_id = ${id}`],
    // stock card: the movements of the old product (their details keep its name / code) show under the replacement
    ['movements', Prisma.sql`UPDATE audit_logs SET entity_id = ${R}, details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('replacedProductId', ${id}::text) WHERE entity_id = ${id} AND left(action, 6) = 'STOCK_'`],
  ] as [string, Prisma.Sql][]) {
    moved[key] = await tx.$executeRaw(sql);
  }

  // 3. bundles that contain the product: the replacement takes its place (quantities added when already in the set)
  const bundleRows = await tx.productBundleItem.findMany({ where: { childProductId: id } });
  for (const b of bundleRows) {
    const existing = await tx.productBundleItem.findFirst({ where: { bundleProductId: b.bundleProductId, childProductId: R } });
    if (existing) {
      await tx.productBundleItem.update({ where: { id: existing.id }, data: { quantity: new Prisma.Decimal(existing.quantity).add(b.quantity) } });
      await tx.productBundleItem.delete({ where: { id: b.id } });
    } else {
      await tx.productBundleItem.update({ where: { id: b.id }, data: { childProductId: R } });
    }
  }
  moved.bundles = bundleRows.length;

  // 4. supplier links: merged into the replacement (a supplier it already has keeps the replacement's row)
  moved.suppliers = await tx.$executeRaw(Prisma.sql`
    INSERT INTO product_suppliers (id, product_id, supplier_id, unit_cost, supplier_sku, supplier_product_name, is_preferred, created_at)
    SELECT gen_random_uuid()::text, ${R}, ps.supplier_id, ps.unit_cost, ps.supplier_sku, ps.supplier_product_name, false, ps.created_at
    FROM product_suppliers ps WHERE ps.product_id = ${id}
    ON CONFLICT (product_id, supplier_id) DO NOTHING`);

  // 5. barcodes (option "ย้ายบาร์โค้ดไปสินค้าทดแทน", default on): base-unit barcodes move; barcodes are unique shop-wide,
  // so none can clash. Pack barcodes go with the old packs (their unit does not exist on the replacement).
  moved.barcodes = opts.moveBarcodes ? await tx.$executeRaw(Prisma.sql`UPDATE product_barcodes SET product_id = ${R} WHERE product_id = ${id}`) : 0;

  // 6. tombstone: old id -> replacement; earlier tombstones that pointed at the old id follow it
  await tx.$executeRaw(Prisma.sql`UPDATE product_replacements SET replacement_product_id = ${R} WHERE replacement_product_id = ${id}`);
  const userName = opts.actor?.fullName || opts.actor?.username || 'ระบบ';
  const details = {
    productId: id, sku, productName: name, replacementId: R, replacementName: check.replacement!.name, replacementSku: check.replacement!.sku,
    moveBarcodes: opts.moveBarcodes, counts: check.counts, moved, userName,
  };
  await tx.productReplacement.upsert({
    where: { oldProductId: id },
    create: { oldProductId: id, replacementProductId: R, oldName: name, oldSku: sku, userId: opts.actor?.id || null, details },
    update: { replacementProductId: R, oldName: name, oldSku: sku, userId: opts.actor?.id || null, details },
  });

  // 7. the product itself (packs, photos, wholesale prices, remaining supplier rows / barcodes, own bundle rows by cascade)
  await tx.product.delete({ where: { id } });
  await tx.auditLog.create({ data: { userId: opts.actor?.id || null, action: 'PRODUCT_REPLACE', entity: 'Product', entityId: id, details } });
  await tx.auditLog.create({ data: { userId: opts.actor?.id || null, action: 'PRODUCT_REPLACE', entity: 'Product', entityId: R, details } });
  return { replaced: true, id, name, sku, replacement: check.replacement, counts: check.counts, texts: check.texts, moved };
}

/**
 * Lines that carry a deleted product's id (held bill, offline outbox, online shop cart) -> the replacement's id.
 * Follows chains (A replaced by B, B later by C) and stops on a loop. Returns the mapped id per old id.
 */
export async function replacementMap(db: any, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter((x) => typeof x === 'string' && x))];
  if (!unique.length) return out;
  const existing = new Set((await db.product.findMany({ where: { id: { in: unique } }, select: { id: true } })).map((p: any) => p.id));
  const gone = unique.filter((x) => !existing.has(x));
  for (const start of gone) {
    let cur = start;
    const seen = new Set<string>([cur]);
    for (let i = 0; i < 10; i++) {
      const row = await db.productReplacement.findUnique({ where: { oldProductId: cur }, select: { replacementProductId: true } });
      if (!row || seen.has(row.replacementProductId)) break;
      cur = row.replacementProductId;
      seen.add(cur);
      if (await db.product.count({ where: { id: cur } })) {
        out.set(start, cur);
        break;
      }
    }
  }
  return out;
}

/** Checkout lines: product ids of replaced products mapped (a pack id of the old product is dropped). */
export async function mapReplacedLines<T extends { productId?: unknown; unitId?: unknown }>(db: any, lines: T[]): Promise<T[]> {
  if (!Array.isArray(lines) || !lines.length) return lines;
  const map = await replacementMap(db, lines.map((l) => String(l?.productId ?? '')));
  if (!map.size) return lines;
  return lines.map((l) => {
    const to = map.get(String(l?.productId ?? ''));
    if (!to) return l;
    const copy: any = { ...l, productId: to, replacedProductId: String(l.productId) };
    if (copy.unitId) delete copy.unitId;
    return copy;
  });
}

export function assertMoveBarcodes(v: unknown): boolean {
  if (v === undefined || v === null) return true; // default on
  if (typeof v !== 'boolean') throw new BadRequestException('ตัวเลือกย้ายบาร์โค้ดไม่ถูกต้อง');
  return v;
}
