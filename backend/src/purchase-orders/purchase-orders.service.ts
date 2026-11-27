import { businessTransaction } from '../prisma/business-transaction';
import { baseQtyOf, calculatePurchaseBill, poUnitOptions, stockCostPerUnit, unitFactorOf } from '../../../shared/src/po-calc';
import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { clampInt, rethrowPrismaError } from '../products/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { POStatus, PaymentStatus } from '@prisma/client';
import { addQty, decimalQtyAllowed, parseQty, qn, toHund } from '../common/qty';
import { nextDocNumber } from '../common/doc-number';
import { matchSupplierLine, type SupplierLineQuery } from './supplier-line-match';
import { docLineName, isDocNameMode, normDocNameMode, type DocNameMode } from '../../../shared/src/product-names';

/** PO lines with what the product-name rule needs (docs/product-names.md): the product and its supplier names / codes. */
export const PO_ITEMS = {
  include: {
    product: { include: { suppliers: { select: { supplierId: true, supplierProductName: true, supplierSku: true } } } },
  },
};

/**
 * Each line gets the name the documents print for the PO's stored mode: `docName` (shop name, or the supplier's
 * name / code -> manufacturer name -> shop name), `docCode` (that supplier's product code, SUPPLIER mode only) and
 * `docNameSource`. The screen, the A4 PDF and every reprint read these, so they always match the stored mode.
 */
export function withDocNames<T extends { supplierId: string; docNameMode: string; items?: any[] }>(po: T): T {
  if (!po || !Array.isArray(po.items)) return po;
  return {
    ...po,
    items: po.items.map((item) => {
      if (!item?.product) return item;
      const n = docLineName(po.docNameMode, item.product, po.supplierId);
      return { ...item, docName: n.name, docCode: n.code, docNameSource: n.source };
    }),
  };
}

/** Mode sent by a client: undefined = not sent; anything else must be SHOP / SUPPLIER. */
export function parseDocNameMode(value: unknown): DocNameMode | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!isDocNameMode(value)) throw new BadRequestException('ชื่อสินค้าบนเอกสารต้องเป็น "ใช้ชื่อร้าน" หรือ "ใช้ชื่อผู้ผลิต"');
  return value;
}

/** The store's default name mode for new supplier documents (ตั้งค่า > สินค้าและสต็อก). */
export async function defaultDocNameMode(db: any): Promise<DocNameMode> {
  const s = await db.storeSettings.findFirst({ select: { supplierDocNameMode: true } });
  return normDocNameMode(s?.supplierDocNameMode);
}

/** Sanity limits (PO unit cost column is Decimal(10,2), totals Decimal(12,2), quantities Decimal(12,2)). */
const MAX_PO_UNIT_COST = 10_000_000;
const MAX_PO_QTY = 1_000_000;
const MAX_PO_TOTAL = 9_999_999_999;
const EDITABLE_PO_STATUSES: POStatus[] = [POStatus.DRAFT, POStatus.ISSUED, POStatus.ORDERED, POStatus.PARTIALLY_RECEIVED];

function parseOptionalDate(value: unknown, label: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value as any);
  if (typeof value !== 'string' && !(value instanceof Date)) throw new BadRequestException(`${label}ไม่ถูกต้อง`);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2200) throw new BadRequestException(`${label}ไม่ถูกต้อง`);
  return d;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
  ) {}

  async findAll(query?: any) {
    const page = clampInt(query?.page, 1, 1, 1_000_000);
    const limit = clampInt(query?.limit, 50, 1, 500);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status && query.status !== 'ALL') {
      const status = String(query.status).toUpperCase();
      if (!(Object.values(POStatus) as string[]).includes(status)) throw new BadRequestException('สถานะใบสั่งซื้อที่ค้นหาไม่ถูกต้อง');
      where.status = status as POStatus;
    }
    if (query?.search !== undefined && typeof query.search !== 'string') throw new BadRequestException('คำค้นหาไม่ถูกต้อง');
    if (query?.supplierId !== undefined && typeof query.supplierId !== 'string') throw new BadRequestException('ผู้จำหน่ายที่ค้นหาไม่ถูกต้อง');
    if (query?.supplierId && query.supplierId !== 'ALL') where.supplierId = query.supplierId;
    if (query?.search && query.search.trim()) {
      where.OR = [
        { poNumber: { contains: query.search.trim(), mode: 'insensitive' } },
        { supplierInvoiceNo: { contains: query.search.trim(), mode: 'insensitive' } },
        { supplier: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        include: {
          supplier: true,
          items: PO_ITEMS,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    // ?counts=1: POs per status (status tabs of the PO page), with the supplier / search filters but not the status
    let counts: Record<string, number> | undefined;
    if (query?.counts === '1' || query?.counts === 'true') {
      const countWhere = { ...where };
      delete countWhere.status;
      const groups = await this.prisma.purchaseOrder.groupBy({ by: ['status'], where: countWhere, _count: { _all: true } });
      counts = { ALL: 0 };
      for (const g of groups) {
        counts[g.status] = g._count._all;
        counts.ALL += g._count._all;
      }
    }

    return {
      data: orders.map(withDocNames),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        ...(counts ? { counts } : {}),
      },
    };
  }

  /** Newest PO (createdAt desc, id desc, any status) containing each product -> its supplier. At most 500 ids. */
  async latestSupplierByProduct(rawIds?: unknown) {
    if (rawIds !== undefined && typeof rawIds !== 'string') throw new BadRequestException('รายการสินค้าไม่ถูกต้อง');
    const ids = [...new Set(String(rawIds || '').split(',').map((s) => s.trim()).filter(Boolean))];
    if (ids.length > 500) throw new BadRequestException('ขอได้ครั้งละไม่เกิน 500 สินค้า');
    if (!ids.length) return [];
    return this.prisma.$queryRaw<{ productId: string; supplierId: string; supplierName: string | null }[]>`
      SELECT DISTINCT ON (i.product_id) i.product_id AS "productId", po.supplier_id AS "supplierId", s.name AS "supplierName"
        FROM purchase_order_items i
        JOIN purchase_orders po ON po.id = i.purchase_order_id
        LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE i.product_id = ANY(${ids})
       ORDER BY i.product_id, po.created_at DESC, po.id DESC`;
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: PO_ITEMS,
        stockBatches: true,
        voucherItems: { include: { voucher: true } },
      },
    });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อนี้');
    return withDocNames(po);
  }

  /** Candidate products for one supplier-invoice line (supplier-line-match.ts). */
  matchLine(q: SupplierLineQuery) {
    return matchSupplierLine(this.prisma, q);
  }

  /**
   * PATCH /purchase-orders/:id/doc-name-mode: which product names this PO prints ("ใช้ชื่อร้าน / ใช้ชื่อผู้ผลิต").
   * Any status (it changes only how the document reads); stored on the PO so reprints stay the same.
   */
  async setDocNameMode(id: string, mode: unknown) {
    const docNameMode = parseDocNameMode(mode);
    if (!docNameMode) throw new BadRequestException('กรุณาเลือกชื่อสินค้าบนเอกสาร');
    const found = await this.prisma.purchaseOrder.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('ไม่พบใบสั่งซื้อนี้');
    await this.prisma.purchaseOrder.update({ where: { id }, data: { docNameMode } });
    return this.findOne(id);
  }

  async create(data: any) {
    return businessTransaction(this.prisma, async (tx) => {
    this.validateItems(data.items, await decimalQtyAllowed(tx));
    if (data.status && ![POStatus.DRAFT, POStatus.ISSUED, POStatus.ORDERED].includes(data.status)) throw new BadRequestException('สถานะเริ่มต้นไม่ถูกต้อง');
    await this.assertSupplier(tx, data.supplierId);
    await this.assertProducts(tx, data.items);
    await this.resolveUnits(tx, data.items, []);
    const billDate = parseOptionalDate(data.billDate, 'วันที่บิล');
    const dueDate = parseOptionalDate(data.dueDate, 'วันครบกำหนดชำระ');
    if (data.poNumber !== undefined && data.poNumber !== null && data.poNumber !== '') {
      if (typeof data.poNumber !== 'string' || !data.poNumber.trim() || data.poNumber.trim().length > 50) throw new BadRequestException('เลขที่ใบสั่งซื้อไม่ถูกต้อง');
      data.poNumber = data.poNumber.trim();
      const dup = await tx.purchaseOrder.findUnique({ where: { poNumber: data.poNumber }, select: { id: true } });
      if (dup) throw new ConflictException(`เลขที่ใบสั่งซื้อ "${data.poNumber}" ถูกใช้แล้ว`);
    }
    // PO<YYMM>-<NNNN> unless a number was typed (docs/document-numbers.md)
    const poNumber = data.poNumber || await nextDocNumber(tx, 'PURCHASE_ORDER', {
      taken: async (n) => !!(await tx.purchaseOrder.findUnique({ where: { poNumber: n }, select: { id: true } })),
    });

    const bill = this.priceBill(data.items, data.billDiscountType, data.billDiscountValue);
    const totalAmount = bill.totals.totalAmount;
    const docNameMode = parseDocNameMode(data.docNameMode) ?? (await defaultDocNameMode(tx));

    return tx.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: data.supplierId,
        supplierInvoiceNo: data.supplierInvoiceNo || null,
        billDate: billDate || new Date(),
        dueDate: dueDate || null,
        status: data.status || POStatus.DRAFT,
        paymentStatus: PaymentStatus.UNPAID,
        ...bill.header,
        paidAmount: 0,
        remainingPayable: totalAmount,
        notes: data.notes || null,
        docNameMode,
        items: { create: bill.items },
      },
      include: { items: PO_ITEMS, supplier: true },
    }).then(withDocNames);
    }).catch((err) => rethrowPrismaError(err, { conflict: 'เลขที่ใบสั่งซื้อซ้ำ กรุณาลองใหม่', badRef: 'ผู้จำหน่ายหรือสินค้าที่อ้างอิงไม่ถูกต้อง' }));
  }

  private async assertSupplier(tx: any, supplierId: unknown) {
    if (typeof supplierId !== 'string' || !supplierId.trim()) throw new BadRequestException('กรุณาเลือกผู้จำหน่าย');
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) throw new BadRequestException('ไม่พบผู้จำหน่ายที่เลือก');
  }

  private async assertProducts(tx: any, items: any[]) {
    const ids = Array.from(new Set(items.map((i) => String(i.productId))));
    const found = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const ok = new Set(found.map((p: any) => p.id));
    const missing = ids.filter((id) => !ok.has(id));
    if (missing.length) throw new BadRequestException(`ไม่พบสินค้าในรายการสั่งซื้อ: ${missing.join(', ')}`);
  }

  async update(id: string, data: any) {
    return businessTransaction(this.prisma, async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อนี้');

    if (!data || typeof data !== 'object') throw new BadRequestException('ข้อมูลไม่ถูกต้อง');
    if (Object.keys(data).some(key => !['items', 'supplierId', 'supplierInvoiceNo', 'billDate', 'dueDate', 'notes', 'billDiscountType', 'billDiscountValue', 'docNameMode'].includes(key))) throw new BadRequestException('ไม่สามารถแก้สถานะหรือยอดชำระผ่านการแก้ไขใบสั่งซื้อ');
    if (!EDITABLE_PO_STATUSES.includes(po.status)) throw new BadRequestException('ไม่สามารถแก้ไขใบสั่งซื้อที่ยกเลิกหรือเสร็จสิ้นแล้ว');
    if (data.supplierId !== undefined) {
      await this.assertSupplier(tx, data.supplierId);
      if (data.supplierId !== po.supplierId && (po.items.some((i) => qn(i.receivedQty) > 0) || Number(po.paidAmount) > 0)) throw new BadRequestException('ไม่สามารถเปลี่ยนผู้จำหน่ายของใบสั่งซื้อที่รับสินค้าหรือชำระเงินแล้ว');
    }
    if (data.billDate !== undefined) {
      const d = parseOptionalDate(data.billDate, 'วันที่บิล');
      if (!d) throw new BadRequestException('วันที่บิลไม่ถูกต้อง');
      data.billDate = d;
    }
    if (data.dueDate !== undefined) data.dueDate = parseOptionalDate(data.dueDate, 'วันครบกำหนดชำระ');
    if (data.docNameMode !== undefined) {
      const mode = parseDocNameMode(data.docNameMode);
      if (mode) data.docNameMode = mode;
      else delete data.docNameMode;
    }
    if (data.notes !== undefined && data.notes !== null && typeof data.notes !== 'string') throw new BadRequestException('หมายเหตุไม่ถูกต้อง');
    if (data.supplierInvoiceNo !== undefined && data.supplierInvoiceNo !== null && typeof data.supplierInvoiceNo !== 'string') throw new BadRequestException('เลขที่ใบแจ้งหนี้ไม่ถูกต้อง');
    const repricing = data.items || data.billDiscountType !== undefined || data.billDiscountValue !== undefined;
    if (data.items) this.validateItems(data.items, await decimalQtyAllowed(tx));
    if (po.status !== POStatus.DRAFT && repricing) {
      throw new BadRequestException('ไม่สามารถแก้ไขรายการ ส่วนลด หรือ VAT ของ PO ที่ไม่อยู่ในสถานะ DRAFT');
    }
    if (data.items) {
      await this.assertProducts(tx, data.items);
      await this.resolveUnits(tx, data.items, po.items);
    }

    if (repricing) {
      const lines = data.items || po.items.map((i) => ({ productId: i.productId, quantity: qn(i.quantity), unitCost: Number(i.unitCost), discountType: i.discountType, discountValue: Number(i.discountValue), vatType: i.vatType, vatRate: Number(i.vatRate), unitId: i.unitId, unitName: i.unitName, unitFactor: i.unitFactor }));
      const bill = this.priceBill(lines, data.billDiscountType ?? po.billDiscountType, data.billDiscountValue ?? Number(po.billDiscountValue));
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      const { items, billDiscountType, billDiscountValue, ...restData } = data;
      const remainingPayable = Math.max(0, bill.totals.totalAmount - Number(po.paidAmount));

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...restData,
          ...bill.header,
          remainingPayable,
          items: { create: bill.items },
        },
        include: { items: PO_ITEMS, supplier: true },
      });
    }

    return tx.purchaseOrder.update({
      where: { id },
      data,
      include: { items: PO_ITEMS, supplier: true },
    });
    }).catch((err) => rethrowPrismaError(err, { notFound: 'ไม่พบใบสั่งซื้อนี้', badRef: 'ผู้จำหน่ายหรือสินค้าที่อ้างอิงไม่ถูกต้อง' }));
  }

  async issue(id: string) {
    return businessTransaction(this.prisma, async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!po || po.status !== POStatus.DRAFT) throw new BadRequestException('สถานะ PO ไม่ถูกต้องสำหรับการออกเอกสาร');
    return tx.purchaseOrder.update({
      where: { id },
      data: { status: POStatus.ISSUED },
    });
    });
  }

  async cancel(id: string, reason?: string) {
    return businessTransaction(this.prisma, async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อนี้');
    if (po.status === POStatus.COMPLETED || po.items.some(item => qn(item.receivedQty) > 0) || Number(po.paidAmount) > 0) {
      throw new BadRequestException('ไม่สามารถยกเลิกใบสั่งซื้อที่รับสินค้าหรือชำระเงินแล้วได้');
    }
    if (po.status === POStatus.CANCELLED) {
      return po;
    }

    const cancelNote = reason?.trim() ? `ยกเลิก: ${reason.trim()}` : 'ยกเลิกโดยผู้ใช้งาน';
    const notes = po.notes ? `${po.notes}\n${cancelNote}` : cancelNote;

    return tx.purchaseOrder.update({
      where: { id },
      data: {
        status: POStatus.CANCELLED,
        notes,
      },
      include: { items: PO_ITEMS, supplier: true },
    });
    });
  }

  /**
   * The unit of each line, decided by the server from the product's packaging units (never the client's factor):
   * `unitId` (or else `unitName`) names a pack -> its name and factor (chain of qtyPerPrev); nothing / the base unit
   * -> base unit (unitName null, factor 1). Editing a DRAFT may keep a line's stored pack even when the product's
   * packs changed since (same product, name and factor as a line of this PO). Rewrites the items in place.
   */
  private async resolveUnits(tx: any, items: any[], existing: { productId: string; unitName: string | null; unitFactor: number }[]) {
    const ids = [...new Set(items.filter((i) => i.unitId || i.unitName || unitFactorOf(i.unitFactor) > 1).map((i) => String(i.productId)))];
    const products: { id: string; unit: string | null; packagingUnits: any[] }[] = ids.length
      ? await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, unit: true, packagingUnits: { orderBy: { sortOrder: 'asc' } } } })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const item of items) {
      const p = byId.get(String(item.productId));
      const wantId = item.unitId ? String(item.unitId) : null;
      const wantName = typeof item.unitName === 'string' ? item.unitName.trim() : '';
      const wantFactor = unitFactorOf(item.unitFactor);
      const base = { unitId: null, unitName: null, unitFactor: 1 };
      if (!p) { Object.assign(item, base); continue; }
      const options = poUnitOptions(p.unit, p.packagingUnits);
      let hit = wantId ? options.find((o) => o.id === wantId) : undefined;
      if (!hit && wantName) hit = options.find((o) => o.name === wantName && o.factor === wantFactor);
      if (!hit && !wantId && !wantName && wantFactor === 1) hit = options[0];
      const kept = hit ? undefined : existing.find((e) => e.productId === item.productId && e.unitName === (wantName || null) && unitFactorOf(e.unitFactor) === wantFactor);
      if (kept) {
        Object.assign(item, { unitId: wantId, unitName: kept.unitName, unitFactor: unitFactorOf(kept.unitFactor) });
        continue;
      }
      if (!hit && wantName) hit = options.find((o) => o.name === wantName);
      if (hit) {
        Object.assign(item, hit.factor === 1 && !hit.id ? base : { unitId: hit.id, unitName: hit.name, unitFactor: hit.factor });
        continue;
      }
      throw new BadRequestException(`ไม่พบหน่วย "${wantName || wantId}" ของสินค้านี้ กรุณาเลือกหน่วยใหม่`);
    }
  }

  /**
   * GET /purchase-orders/last-prices?productId=&supplierId=&excludePoId=: the newest unit price paid to this supplier
   * for the product in each unit (not cancelled POs), newest first, plus the product's cost - what the grid needs for
   * the default price of a new line (shared defaultPoUnitPrice).
   */
  async lastPrices(q: { productId?: unknown; supplierId?: unknown; excludePoId?: unknown }) {
    for (const k of ['productId', 'supplierId', 'excludePoId'] as const) {
      if (q[k] !== undefined && typeof q[k] !== 'string') throw new BadRequestException('เงื่อนไขไม่ถูกต้อง');
    }
    const productId = String(q.productId || '');
    if (!productId) throw new BadRequestException('กรุณาระบุสินค้า');
    const supplierId = String(q.supplierId || '');
    const exclude = String(q.excludePoId || '');
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { costPrice: true } });
    if (!product) throw new NotFoundException('ไม่พบสินค้านี้');
    const rows = supplierId
      ? await this.prisma.$queryRaw<{ unitFactor: number; unitName: string | null; unitCost: string; poNumber: string; at: Date }[]>`
          SELECT * FROM (
            SELECT DISTINCT ON (i.unit_factor) i.unit_factor AS "unitFactor", i.unit_name AS "unitName", i.unit_cost::text AS "unitCost",
                   po.po_number AS "poNumber", po.created_at AS at
              FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.purchase_order_id
             WHERE i.product_id = ${productId} AND po.supplier_id = ${supplierId} AND po.status <> 'CANCELLED' AND po.id <> ${exclude}
             ORDER BY i.unit_factor, po.created_at DESC, po.id DESC
          ) x ORDER BY x.at DESC`
      : [];
    return {
      productId,
      costPrice: Number(product.costPrice || 0),
      history: rows.map((r) => ({ unitFactor: Number(r.unitFactor), unitName: r.unitName, unitCost: Number(r.unitCost), poNumber: r.poNumber, at: r.at })),
    };
  }

  private validateItems(items: any[], allowDecimal: boolean) {
    if (!Array.isArray(items) || !items.length || items.some(item => !item.productId || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unitCost)) || Number(item.unitCost) < 0)) {
      throw new BadRequestException('รายการสินค้า จำนวน หรือต้นทุนไม่ถูกต้อง');
    }
    for (const item of items) {
      if (typeof item.productId !== 'string') throw new BadRequestException('รายการสินค้าไม่ถูกต้อง');
      if (Number(item.quantity) > MAX_PO_QTY) throw new BadRequestException(`จำนวนสั่งซื้อต้องไม่เกิน ${MAX_PO_QTY.toLocaleString('en-US')}`);
      item.quantity = parseQty(item.quantity, { allowDecimal, max: MAX_PO_QTY, message: 'รายการสินค้า จำนวน หรือต้นทุนไม่ถูกต้อง' });
      if (Number(item.quantity) > MAX_PO_QTY) throw new BadRequestException(`จำนวนสั่งซื้อต้องไม่เกิน ${MAX_PO_QTY.toLocaleString('en-US')}`);
      if (Number(item.unitCost) > MAX_PO_UNIT_COST) throw new BadRequestException(`ต้นทุนต่อหน่วยต้องไม่เกิน ${MAX_PO_UNIT_COST.toLocaleString('en-US')} บาท`);
      if (item.discountType !== undefined && item.discountType !== null && !['baht', 'percent', 'unit'].includes(String(item.discountType))) throw new BadRequestException('ประเภทส่วนลดรายการไม่ถูกต้อง');
      // per-unit discount (grid entry): baht off each unit, never more than the unit price
      if (item.discountType === 'unit' && Number(item.discountValue) > Number(item.unitCost) + 0.0001) throw new BadRequestException('ส่วนลดต่อหน่วยต้องไม่เกินราคาต่อหน่วย');
      if (item.unitFactor !== undefined && item.unitFactor !== null && (!Number.isInteger(Number(item.unitFactor)) || Number(item.unitFactor) < 1 || Number(item.unitFactor) > 1_000_000)) throw new BadRequestException('หน่วยสั่งซื้อไม่ถูกต้อง');
      if (item.unitId !== undefined && item.unitId !== null && typeof item.unitId !== 'string') throw new BadRequestException('หน่วยสั่งซื้อไม่ถูกต้อง');
      if (item.unitName !== undefined && item.unitName !== null && (typeof item.unitName !== 'string' || item.unitName.length > 50)) throw new BadRequestException('หน่วยสั่งซื้อไม่ถูกต้อง');
      if (item.discountType === 'percent' && Number(item.discountValue) > 100) throw new BadRequestException('ส่วนลดรายการต้องไม่เกิน 100%');
      if (item.vatType !== undefined && !['NONE', 'INCLUDED', 'EXCLUDED', 'none', 'include', 'exclude'].includes(String(item.vatType))) throw new BadRequestException('ประเภท VAT ของรายการไม่ถูกต้อง');
      if (item.vatRate !== undefined && (!Number.isFinite(Number(item.vatRate)) || Number(item.vatRate) < 0 || Number(item.vatRate) > 30)) throw new BadRequestException('อัตรา VAT ต้องอยู่ระหว่าง 0-30%');
      if (item.discountValue !== undefined && (!Number.isFinite(Number(item.discountValue)) || Number(item.discountValue) < 0)) throw new BadRequestException('ส่วนลดรายการไม่ถูกต้อง');
    }
  }

  /** Server-side pricing of a purchase bill: discounts, VAT per line, totals. */
  private priceBill(items: any[], billDiscountType?: unknown, billDiscountValue?: unknown, strict = true) {
    const totals = calculatePurchaseBill(
      (items || []).map((i: any) => ({ quantity: Number(i.quantity), unitCost: Number(i.unitCost), discountType: i.discountType, discountValue: i.discountValue, vatType: i.vatType, vatRate: i.vatRate })),
      { type: billDiscountType as string, value: billDiscountValue as number },
    );
    if (billDiscountValue !== undefined && billDiscountValue !== null && (!Number.isFinite(Number(billDiscountValue)) || Number(billDiscountValue) < 0)) throw new BadRequestException('ส่วนลดท้ายบิลไม่ถูกต้อง');
    if (billDiscountType !== undefined && billDiscountType !== null && !['baht', 'percent'].includes(String(billDiscountType))) throw new BadRequestException('ประเภทส่วนลดท้ายบิลไม่ถูกต้อง');
    const bdValue = Number(billDiscountValue) || 0;
    const afterLineDiscounts = Math.round((totals.baseAmount - totals.lineDiscountAmount) * 100) / 100;
    if (strict && (billDiscountType === 'percent' ? bdValue > 100 : bdValue > afterLineDiscounts + 0.001)) {
      throw new BadRequestException(`ส่วนลดท้ายบิลมากกว่ายอดรวม (${afterLineDiscounts.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท)`);
    }
    if (totals.totalAmount > MAX_PO_TOTAL) throw new BadRequestException('ยอดรวมใบสั่งซื้อสูงเกินกว่าที่ระบบรองรับ');
    const items2 = (items || []).map((item: any, idx: number) => {
      const l = totals.lines[idx];
      return {
        productId: item.productId,
        unitId: item.unitId ?? null,
        unitName: item.unitName ?? null,
        unitFactor: unitFactorOf(item.unitFactor),
        quantity: l.quantity,
        unitCost: l.unitCost,
        discountType: l.discountType,
        discountValue: l.discountValue,
        discountAmount: l.discountAmount,
        vatType: l.vatType,
        vatRate: l.vatRate,
        netAmount: l.netAmount,
        vatAmount: l.vatAmount,
        total: l.total,
      };
    });
    const header = {
      billDiscountType: billDiscountType === 'percent' ? 'percent' : 'baht',
      billDiscountValue: Math.max(0, Number(billDiscountValue) || 0),
      discountAmount: totals.discountAmount,
      subtotalAmount: totals.subtotalAmount,
      vatAmount: totals.vatAmount,
      totalAmount: totals.totalAmount,
    };
    return { totals, items: items2, header };
  }

  async receive(id: string, data: { clientReceiptId?: string; adjustAndComplete?: boolean; supplierInvoiceNo?: string; items: { purchaseOrderItemId: string; receivedQty: number; unitCost: number }[] }) {
    if (!data.clientReceiptId || !/^[a-zA-Z0-9-]{16,80}$/.test(data.clientReceiptId)) throw new BadRequestException('กรุณาระบุรหัสการรับสินค้าเพื่อป้องกันการบันทึกซ้ำ');
    if (!Array.isArray(data.items) || !data.items.length || data.items.some(item => typeof item?.receivedQty !== 'number' || !Number.isFinite(item.receivedQty) || item.receivedQty <= 0 || !Number.isFinite(item.unitCost) || item.unitCost < 0)) throw new BadRequestException('จำนวนรับและต้นทุนไม่ถูกต้อง');
    if (new Set(data.items.map(item => item.purchaseOrderItemId)).size !== data.items.length) throw new BadRequestException('รายการรับสินค้าซ้ำกัน');
    const fingerprint = JSON.stringify({ id, adjustAndComplete: !!data.adjustAndComplete, supplierInvoiceNo: data.supplierInvoiceNo || '', items: [...data.items].sort((a,b) => a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId)).map(item => ({ id: item.purchaseOrderItemId, qty: item.receivedQty, cost: item.unitCost })) });
    return businessTransaction(this.prisma, async tx => {
      // Keep the receipt ledger in the same transaction as stock and PO changes.
      const receiptId = 'po-receive-' + data.clientReceiptId;
      const previous = await tx.auditLog.findUnique({ where: { id: receiptId } });
      if (previous) {
        const details = previous.details as any;
        if (previous.entityId !== id || details?.fingerprint !== fingerprint) throw new BadRequestException('รหัสรับสินค้านี้ถูกใช้กับรายการอื่นแล้ว กรุณาตรวจสอบผลการรับเดิม');
        return details.result;
      }
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: PO_ITEMS } });
      if (!po || !([POStatus.ISSUED, POStatus.PARTIALLY_RECEIVED, POStatus.ORDERED] as POStatus[]).includes(po.status)) throw new BadRequestException('สถานะ PO ไม่ถูกต้องสำหรับการรับสินค้า');
      if (data.adjustAndComplete && Number(po.paidAmount) > 0) throw new BadRequestException('ไม่สามารถปรับลดใบสั่งซื้อที่มีการชำระเงินแล้ว');
      const allowDecimal = await decimalQtyAllowed(tx);
      for (const item of data.items) {
        item.receivedQty = parseQty(item.receivedQty, { allowDecimal, message: 'จำนวนรับและต้นทุนไม่ถูกต้อง' });
        const original = po.items.find(row => row.id === item.purchaseOrderItemId);
        if (!original || toHund(original.receivedQty) + toHund(item.receivedQty) > toHund(original.quantity)) throw new BadRequestException('รายการรับไม่อยู่ในใบสั่งซื้อหรือจำนวนรับเกินยอดคงเหลือ');
        if (Math.abs(item.unitCost - Number(original.unitCost)) > 0.001) throw new BadRequestException('ต้นทุนรับไม่ตรงกับใบสั่งซื้อ กรุณาตรวจสอบเอกสาร');
      }
      // VAT paid on purchases is part of the stock cost unless the shop is VAT-registered (claims it back)
      const shopVatRegistered = (await tx.storeSettings.findFirst())?.vatEnabled === true;
      for (const item of data.items) {
        const original = po.items.find(row => row.id === item.purchaseOrderItemId)!;
        // a line in a pack unit (2 ลัง x12) receives 24 base units at the pack price / 12 (stock is in base units)
        const factor = unitFactorOf(original.unitFactor);
        const baseQty = baseQtyOf(item.receivedQty, factor);
        const costPerUnit = stockCostPerUnit({ quantity: original.quantity, total: original.total, netAmount: original.netAmount, unitCost: original.unitCost, unitFactor: factor }, shopVatRegistered);
        const prevStockAgg = await tx.stockBatch.aggregate({
          where: { productId: original.productId },
          _sum: { quantityRemaining: true },
        });
        const previousStock = qn(prevStockAgg._sum.quantityRemaining);
        const product = (original as any).product || (await tx.product.findUnique({ where: { id: original.productId }, select: { sku: true, name: true, unit: true } }));
        const packNote = factor > 1 ? ` (${qn(item.receivedQty)} ${original.unitName || ''} x${factor})` : '';
        await tx.stockBatch.create({ data: { productId: original.productId, quantityReceived: baseQty, quantityRemaining: baseQty, unitCost: costPerUnit, supplierId: po.supplierId, purchaseOrderId: id, note: 'รับเข้าจาก PO ' + po.poNumber + packNote } });
        await tx.purchaseOrderItem.update({ where: { id: original.id }, data: { receivedQty: { increment: item.receivedQty } } });
        await tx.auditLog.create({
          data: {
            action: 'STOCK_IN_PO',
            entity: 'Product',
            entityId: original.productId,
            details: {
              productId: original.productId,
              sku: product?.sku || '-',
              productName: product?.name || 'สินค้า',
              unitName: product?.unit || 'ชิ้น',
              type: 'IN_PO',
              quantityChange: baseQty,
              previousStock,
              currentStock: addQty(previousStock, baseQty),
              referenceType: 'PO',
              referenceNo: po.poNumber,
              reason: 'รับเข้าจากใบสั่งซื้อ ' + po.poNumber + packNote,
              ...(factor > 1 ? { orderedUnit: original.unitName, orderedUnitQty: item.receivedQty, unitFactor: factor } : {}),
              userName: 'คลังสินค้า',
            },
          },
        });
      }
      const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
      let adjusted: Record<string, number | string> | null = null;
      if (data.adjustAndComplete) {
        // re-price the bill for what was actually delivered (same discounts and VAT settings)
        const bill = this.priceBill(
          items.map((i) => ({ productId: i.productId, quantity: qn(i.receivedQty), unitCost: Number(i.unitCost), discountType: i.discountType, discountValue: Number(i.discountValue), vatType: i.vatType, vatRate: Number(i.vatRate), unitId: i.unitId, unitName: i.unitName, unitFactor: i.unitFactor })),
          po.billDiscountType,
          Number(po.billDiscountValue),
          false, // re-pricing what was delivered: the bill discount is capped, never rejected
        );
        for (let k = 0; k < items.length; k++) {
          const { productId, ...line } = bill.items[k];
          void productId;
          await tx.purchaseOrderItem.update({ where: { id: items[k].id }, data: line });
        }
        adjusted = { ...bill.header, remainingPayable: bill.totals.totalAmount };
      }
      const result = await tx.purchaseOrder.update({ where: { id }, data: {
        status: data.adjustAndComplete || items.every(item => toHund(item.receivedQty) >= toHund(item.quantity)) ? POStatus.COMPLETED : POStatus.PARTIALLY_RECEIVED,
        ...(adjusted || {}),
        ...(data.supplierInvoiceNo ? { supplierInvoiceNo: data.supplierInvoiceNo.trim() } : {}),
      }, include: { items: PO_ITEMS, supplier: true } });
      await tx.auditLog.create({ data: { id: receiptId, action: 'RECEIVE', entity: 'PurchaseOrder', entityId: id, details: { fingerprint, result: JSON.parse(JSON.stringify(result)) } } });
      return result;
    });
  }
}
