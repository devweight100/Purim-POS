import { businessTransaction } from '../prisma/business-transaction';
import { calculatePurchaseBill, stockCostPerUnit } from './po-calc';
import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { clampInt, rethrowPrismaError } from '../products/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { POStatus, PaymentStatus } from '@prisma/client';

/** Sanity limits (PO unit cost column is Decimal(10,2), totals Decimal(12,2), quantities Int). */
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
          items: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: { include: { product: true } },
        stockBatches: true,
        voucherItems: { include: { voucher: true } },
      },
    });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อนี้');
    return po;
  }

  async create(data: any) {
    return businessTransaction(this.prisma, async (tx) => {
    this.validateItems(data.items);
    if (data.status && ![POStatus.DRAFT, POStatus.ISSUED, POStatus.ORDERED].includes(data.status)) throw new BadRequestException('สถานะเริ่มต้นไม่ถูกต้อง');
    await this.assertSupplier(tx, data.supplierId);
    await this.assertProducts(tx, data.items);
    const billDate = parseOptionalDate(data.billDate, 'วันที่บิล');
    const dueDate = parseOptionalDate(data.dueDate, 'วันครบกำหนดชำระ');
    if (data.poNumber !== undefined && data.poNumber !== null && data.poNumber !== '') {
      if (typeof data.poNumber !== 'string' || !data.poNumber.trim() || data.poNumber.trim().length > 50) throw new BadRequestException('เลขที่ใบสั่งซื้อไม่ถูกต้อง');
      data.poNumber = data.poNumber.trim();
      const dup = await tx.purchaseOrder.findUnique({ where: { poNumber: data.poNumber }, select: { id: true } });
      if (dup) throw new ConflictException(`เลขที่ใบสั่งซื้อ "${data.poNumber}" ถูกใช้แล้ว`);
    }
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const prefix = `PO-${yy}${mm}`;
    const lastPo = await tx.purchaseOrder.findFirst({ where: { poNumber: { startsWith: prefix } }, orderBy: { poNumber: 'desc' } });
    const poCount = lastPo ? Number(lastPo.poNumber.slice(prefix.length)) : 0;
    const poNumber = data.poNumber || `${prefix}${String(poCount + 1).padStart(5, '0')}`;

    const bill = this.priceBill(data.items, data.billDiscountType, data.billDiscountValue);
    const totalAmount = bill.totals.totalAmount;

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
        items: { create: bill.items },
      },
      include: { items: { include: { product: true } }, supplier: true },
    });
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
    if (Object.keys(data).some(key => !['items', 'supplierId', 'supplierInvoiceNo', 'billDate', 'dueDate', 'notes', 'billDiscountType', 'billDiscountValue'].includes(key))) throw new BadRequestException('ไม่สามารถแก้สถานะหรือยอดชำระผ่านการแก้ไขใบสั่งซื้อ');
    if (!EDITABLE_PO_STATUSES.includes(po.status)) throw new BadRequestException('ไม่สามารถแก้ไขใบสั่งซื้อที่ยกเลิกหรือเสร็จสิ้นแล้ว');
    if (data.supplierId !== undefined) {
      await this.assertSupplier(tx, data.supplierId);
      if (data.supplierId !== po.supplierId && (po.items.some((i) => i.receivedQty > 0) || Number(po.paidAmount) > 0)) throw new BadRequestException('ไม่สามารถเปลี่ยนผู้จำหน่ายของใบสั่งซื้อที่รับสินค้าหรือชำระเงินแล้ว');
    }
    if (data.billDate !== undefined) {
      const d = parseOptionalDate(data.billDate, 'วันที่บิล');
      if (!d) throw new BadRequestException('วันที่บิลไม่ถูกต้อง');
      data.billDate = d;
    }
    if (data.dueDate !== undefined) data.dueDate = parseOptionalDate(data.dueDate, 'วันครบกำหนดชำระ');
    if (data.notes !== undefined && data.notes !== null && typeof data.notes !== 'string') throw new BadRequestException('หมายเหตุไม่ถูกต้อง');
    if (data.supplierInvoiceNo !== undefined && data.supplierInvoiceNo !== null && typeof data.supplierInvoiceNo !== 'string') throw new BadRequestException('เลขที่ใบแจ้งหนี้ไม่ถูกต้อง');
    const repricing = data.items || data.billDiscountType !== undefined || data.billDiscountValue !== undefined;
    if (data.items) this.validateItems(data.items);
    if (po.status !== POStatus.DRAFT && repricing) {
      throw new BadRequestException('ไม่สามารถแก้ไขรายการ ส่วนลด หรือ VAT ของ PO ที่ไม่อยู่ในสถานะ DRAFT');
    }
    if (data.items) await this.assertProducts(tx, data.items);

    if (repricing) {
      const lines = data.items || po.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitCost: Number(i.unitCost), discountType: i.discountType, discountValue: Number(i.discountValue), vatType: i.vatType, vatRate: Number(i.vatRate) }));
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
        include: { items: { include: { product: true } }, supplier: true },
      });
    }

    return tx.purchaseOrder.update({
      where: { id },
      data,
      include: { items: { include: { product: true } }, supplier: true },
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
    if (po.status === POStatus.COMPLETED || po.items.some(item => item.receivedQty > 0) || Number(po.paidAmount) > 0) {
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
      include: { items: { include: { product: true } }, supplier: true },
    });
    });
  }

  private validateItems(items: any[]) {
    if (!Array.isArray(items) || !items.length || items.some(item => !item.productId || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unitCost)) || Number(item.unitCost) < 0)) {
      throw new BadRequestException('รายการสินค้า จำนวน หรือต้นทุนไม่ถูกต้อง');
    }
    for (const item of items) {
      if (typeof item.productId !== 'string') throw new BadRequestException('รายการสินค้าไม่ถูกต้อง');
      if (Number(item.quantity) > MAX_PO_QTY) throw new BadRequestException(`จำนวนสั่งซื้อต้องไม่เกิน ${MAX_PO_QTY.toLocaleString('en-US')}`);
      if (Number(item.unitCost) > MAX_PO_UNIT_COST) throw new BadRequestException(`ต้นทุนต่อหน่วยต้องไม่เกิน ${MAX_PO_UNIT_COST.toLocaleString('en-US')} บาท`);
      if (item.discountType !== undefined && item.discountType !== null && !['baht', 'percent'].includes(String(item.discountType))) throw new BadRequestException('ประเภทส่วนลดรายการไม่ถูกต้อง');
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
    if (!Array.isArray(data.items) || !data.items.length || data.items.some(item => !Number.isSafeInteger(item.receivedQty) || item.receivedQty <= 0 || !Number.isFinite(item.unitCost) || item.unitCost < 0)) throw new BadRequestException('จำนวนรับและต้นทุนไม่ถูกต้อง');
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
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: { include: { product: true } } } });
      if (!po || !([POStatus.ISSUED, POStatus.PARTIALLY_RECEIVED, POStatus.ORDERED] as POStatus[]).includes(po.status)) throw new BadRequestException('สถานะ PO ไม่ถูกต้องสำหรับการรับสินค้า');
      if (data.adjustAndComplete && Number(po.paidAmount) > 0) throw new BadRequestException('ไม่สามารถปรับลดใบสั่งซื้อที่มีการชำระเงินแล้ว');
      for (const item of data.items) {
        const original = po.items.find(row => row.id === item.purchaseOrderItemId);
        if (!original || original.receivedQty + item.receivedQty > original.quantity) throw new BadRequestException('รายการรับไม่อยู่ในใบสั่งซื้อหรือจำนวนรับเกินยอดคงเหลือ');
        if (Math.abs(item.unitCost - Number(original.unitCost)) > 0.001) throw new BadRequestException('ต้นทุนรับไม่ตรงกับใบสั่งซื้อ กรุณาตรวจสอบเอกสาร');
      }
      // VAT paid on purchases is part of the stock cost unless the shop is VAT-registered (claims it back)
      const shopVatRegistered = (await tx.storeSettings.findFirst())?.vatEnabled === true;
      for (const item of data.items) {
        const original = po.items.find(row => row.id === item.purchaseOrderItemId)!;
        const costPerUnit = stockCostPerUnit({ quantity: original.quantity, total: original.total, netAmount: original.netAmount, unitCost: original.unitCost }, shopVatRegistered);
        const prevStockAgg = await tx.stockBatch.aggregate({
          where: { productId: original.productId },
          _sum: { quantityRemaining: true },
        });
        const previousStock = Number(prevStockAgg._sum.quantityRemaining || 0);
        const product = (original as any).product || (await tx.product.findUnique({ where: { id: original.productId }, select: { sku: true, name: true, unit: true } }));
        await tx.stockBatch.create({ data: { productId: original.productId, quantityReceived: item.receivedQty, quantityRemaining: item.receivedQty, unitCost: costPerUnit, supplierId: po.supplierId, purchaseOrderId: id, note: 'รับเข้าจาก PO ' + po.poNumber } });
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
              quantityChange: item.receivedQty,
              previousStock,
              currentStock: previousStock + item.receivedQty,
              referenceType: 'PO',
              referenceNo: po.poNumber,
              reason: 'รับเข้าจากใบสั่งซื้อ ' + po.poNumber,
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
          items.map((i) => ({ productId: i.productId, quantity: i.receivedQty, unitCost: Number(i.unitCost), discountType: i.discountType, discountValue: Number(i.discountValue), vatType: i.vatType, vatRate: Number(i.vatRate) })),
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
        status: data.adjustAndComplete || items.every(item => item.receivedQty === item.quantity) ? POStatus.COMPLETED : POStatus.PARTIALLY_RECEIVED,
        ...(adjusted || {}),
        ...(data.supplierInvoiceNo ? { supplierInvoiceNo: data.supplierInvoiceNo.trim() } : {}),
      }, include: { items: { include: { product: true } }, supplier: true } });
      await tx.auditLog.create({ data: { id: receiptId, action: 'RECEIVE', entity: 'PurchaseOrder', entityId: id, details: { fingerprint, result: JSON.parse(JSON.stringify(result)) } } });
      return result;
    });
  }
}
