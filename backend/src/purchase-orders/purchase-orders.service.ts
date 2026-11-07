import { businessTransaction } from '../prisma/business-transaction';
import { calculatePurchaseBill, stockCostPerUnit } from './po-calc';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { POStatus, PaymentStatus } from '@prisma/client';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
  ) {}

  async findAll(query?: any) {
    const page = query?.page ? parseInt(query.page, 10) : 1;
    const limit = query?.limit ? parseInt(query.limit, 10) : 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status && query.status !== 'ALL') where.status = query.status as POStatus;
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
        billDate: data.billDate ? new Date(data.billDate) : new Date(),
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
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
    });
  }

  async update(id: string, data: any) {
    return businessTransaction(this.prisma, async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อนี้');

    if (Object.keys(data).some(key => !['items', 'supplierId', 'supplierInvoiceNo', 'billDate', 'dueDate', 'notes', 'billDiscountType', 'billDiscountValue'].includes(key))) throw new BadRequestException('ไม่สามารถแก้สถานะหรือยอดชำระผ่านการแก้ไขใบสั่งซื้อ');
    const repricing = data.items || data.billDiscountType !== undefined || data.billDiscountValue !== undefined;
    if (data.items) this.validateItems(data.items);
    if (po.status !== POStatus.DRAFT && repricing) {
      throw new BadRequestException('ไม่สามารถแก้ไขรายการ ส่วนลด หรือ VAT ของ PO ที่ไม่อยู่ในสถานะ DRAFT');
    }

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
    });
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
      if (item.vatType !== undefined && !['NONE', 'INCLUDED', 'EXCLUDED', 'none', 'include', 'exclude'].includes(String(item.vatType))) throw new BadRequestException('ประเภท VAT ของรายการไม่ถูกต้อง');
      if (item.vatRate !== undefined && (!Number.isFinite(Number(item.vatRate)) || Number(item.vatRate) < 0 || Number(item.vatRate) > 30)) throw new BadRequestException('อัตรา VAT ต้องอยู่ระหว่าง 0-30%');
      if (item.discountValue !== undefined && (!Number.isFinite(Number(item.discountValue)) || Number(item.discountValue) < 0)) throw new BadRequestException('ส่วนลดรายการไม่ถูกต้อง');
    }
  }

  /** Server-side pricing of a purchase bill: discounts, VAT per line, totals. */
  private priceBill(items: any[], billDiscountType?: unknown, billDiscountValue?: unknown) {
    const totals = calculatePurchaseBill(
      (items || []).map((i: any) => ({ quantity: Number(i.quantity), unitCost: Number(i.unitCost), discountType: i.discountType, discountValue: i.discountValue, vatType: i.vatType, vatRate: i.vatRate })),
      { type: billDiscountType as string, value: billDiscountValue as number },
    );
    if (billDiscountValue !== undefined && (!Number.isFinite(Number(billDiscountValue)) || Number(billDiscountValue) < 0)) throw new BadRequestException('ส่วนลดท้ายบิลไม่ถูกต้อง');
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
