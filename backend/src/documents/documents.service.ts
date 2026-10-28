import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UnifiedDocumentSearchResult {
  type: 'ORDER' | 'CLAIM' | 'SHIFT' | 'DEBT' | 'PURCHASE_ORDER' | 'SUPPLIER_RETURN' | 'PAYMENT_VOUCHER';
  typeName: string;
  id: string;
  docNumber: string;
  date: string | Date;
  status: string;
  amount?: number;
  customerName?: string;
  description: string;
  rawData: any;
}

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(rawQuery: string): Promise<UnifiedDocumentSearchResult[]> {
    const query = (rawQuery || '').trim();
    if (!query) return [];

    const results: UnifiedDocumentSearchResult[] = [];

    // Search in parallel across all 7 document sources
    const [
      orders,
      claims,
      shifts,
      debts,
      debtPayments,
      purchaseOrders,
      supplierReturns,
      paymentVouchers,
    ] = await Promise.all([
      // 1. Orders
      this.prisma.order.findMany({
        where: {
          OR: [
            { orderNumber: { contains: query, mode: 'insensitive' } },
            { id: { contains: query, mode: 'insensitive' } },
            { clientOrderId: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          customer: true,
          user: true,
          items: {
            include: { product: true },
          },
          payments: true,
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),

      // 2. Customer Claims
      this.prisma.customerClaim.findMany({
        where: {
          OR: [
            { claimNumber: { contains: query, mode: 'insensitive' } },
            { id: { contains: query, mode: 'insensitive' } },
            { orderId: { contains: query, mode: 'insensitive' } },
            { order: { orderNumber: { contains: query, mode: 'insensitive' } } },
          ],
        },
        include: {
          order: true,
          customer: true,
          product: true,
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),

      // 3. Shifts
      this.prisma.shift.findMany({
        where: {
          OR: [
            { shiftNumber: { contains: query, mode: 'insensitive' } },
            { id: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          user: true,
          cashMovements: true,
        },
        take: 10,
        orderBy: { openedAt: 'desc' },
      }).catch(() => []),

      // 4. Customer Debts
      this.prisma.customerDebt.findMany({
        where: {
          OR: [
            { id: { contains: query, mode: 'insensitive' } },
            { orderId: { contains: query, mode: 'insensitive' } },
            { order: { orderNumber: { contains: query, mode: 'insensitive' } } },
            { customer: { name: { contains: query, mode: 'insensitive' } } },
            { customer: { phone: { contains: query, mode: 'insensitive' } } },
          ],
        },
        include: {
          customer: true,
          order: true,
          payments: true,
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),

      // 4b. Debt Payments by Receipt No
      this.prisma.debtPayment.findMany({
        where: {
          receiptNo: { contains: query, mode: 'insensitive' },
        },
        include: {
          debt: {
            include: {
              customer: true,
              order: true,
            },
          },
        },
        take: 10,
        orderBy: { paymentDate: 'desc' },
      }).catch(() => []),

      // 5. Purchase Orders
      this.prisma.purchaseOrder.findMany({
        where: {
          OR: [
            { poNumber: { contains: query, mode: 'insensitive' } },
            { id: { contains: query, mode: 'insensitive' } },
            { supplierInvoiceNo: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          supplier: true,
          items: {
            include: { product: true },
          },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),

      // 6. Supplier Returns (Debit Notes)
      this.prisma.supplierReturnNote.findMany({
        where: {
          OR: [
            { returnNumber: { contains: query, mode: 'insensitive' } },
            { id: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          supplier: true,
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),

      // 7. Payment Vouchers
      this.prisma.paymentVoucher.findMany({
        where: {
          OR: [
            { voucherNumber: { contains: query, mode: 'insensitive' } },
            { id: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          supplier: true,
          items: {
            include: { purchaseOrder: true },
          },
          debitNotes: {
            include: { returnNote: true },
          },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),
    ]);

    // Format Orders
    for (const order of orders) {
      results.push({
        type: 'ORDER',
        typeName: 'ใบเสร็จรับเงิน / บิลขาย (Order Receipt)',
        id: order.id,
        docNumber: order.orderNumber,
        date: order.createdAt,
        status: order.status,
        amount: Number(order.totalAmount),
        customerName: order.customer?.name || 'ลูกค้าทั่วไป',
        description: `สินค้า ${order.items?.length || 0} รายการ • ผู้ขาย: ${order.user?.fullName || order.user?.username || '-'}`,
        rawData: order,
      });
    }

    // Format Claims
    for (const claim of claims) {
      results.push({
        type: 'CLAIM',
        typeName: 'ใบรับเคลมสินค้า (Product Claim)',
        id: claim.id,
        docNumber: claim.claimNumber || claim.id,
        date: claim.createdAt,
        status: claim.status,
        customerName: claim.customer?.name || 'ลูกค้าทั่วไป',
        description: `สินค้า: ${claim.product?.name || '-'} • อาการ: ${claim.problemDescription || '-'} • บิลอ้างอิง: ${claim.order?.orderNumber || claim.orderId || '-'}`,
        rawData: claim,
      });
    }

    // Format Shifts
    for (const shift of shifts) {
      results.push({
        type: 'SHIFT',
        typeName: 'รายงานสรุปกะ / ยอดลิ้นชัก (Shift Report)',
        id: shift.id,
        docNumber: shift.shiftNumber || shift.id,
        date: shift.openedAt,
        status: shift.status,
        amount: Number(shift.totalSales),
        customerName: shift.user?.fullName || shift.user?.username || 'แคชเชียร์',
        description: `เริ่ม: ${new Date(shift.openedAt).toLocaleString('th-TH')} • ยอดขายรวม: ฿${Number(shift.totalSales).toLocaleString()}`,
        rawData: shift,
      });
    }

    // Format Debts
    const seenDebtIds = new Set<string>();
    for (const debt of debts) {
      seenDebtIds.add(debt.id);
      results.push({
        type: 'DEBT',
        typeName: 'ใบเสร็จรับเงินชำระหนี้ (Debt Record)',
        id: debt.id,
        docNumber: debt.order?.orderNumber || debt.id,
        date: debt.createdAt,
        status: debt.status,
        amount: Number(debt.totalDebt),
        customerName: debt.customer?.name || 'ลูกค้าเงินเชื่อ',
        description: `ยอดหนี้ ฿${Number(debt.totalDebt).toLocaleString()} • ชำระแล้ว ฿${Number(debt.paidAmount).toLocaleString()} • ค้างชำระ ฿${Number(debt.remainingAmount).toLocaleString()}`,
        rawData: debt,
      });
    }

    // Format Debt Payments from receipt query
    for (const dp of debtPayments) {
      if (!seenDebtIds.has(dp.debt.id)) {
        seenDebtIds.add(dp.debt.id);
        results.push({
          type: 'DEBT',
          typeName: `ใบเสร็จรับชำระหนี้ #${dp.receiptNo || dp.id}`,
          id: dp.debt.id,
          docNumber: dp.receiptNo || dp.debt.order?.orderNumber || dp.debt.id,
          date: dp.paymentDate,
          status: dp.debt.status,
          amount: Number(dp.amount),
          customerName: dp.debt.customer?.name || 'ลูกค้าเงินเชื่อ',
          description: `ชำระครั้งนี้ ฿${Number(dp.amount).toLocaleString()} • ใบเสร็จ: ${dp.receiptNo || '-'}`,
          rawData: dp.debt,
        });
      }
    }

    // Format Purchase Orders
    for (const po of purchaseOrders) {
      results.push({
        type: 'PURCHASE_ORDER',
        typeName: 'ใบสั่งซื้อสินค้า (Purchase Order)',
        id: po.id,
        docNumber: po.poNumber,
        date: po.billDate || po.createdAt,
        status: po.status,
        amount: Number(po.totalAmount),
        customerName: po.supplier?.name || 'ไม่ระบุผู้จำหน่าย',
        description: `ผู้จำหน่าย: ${po.supplier?.name || '-'} • สินค้า ${po.items?.length || 0} รายการ • สถานะ: ${po.status}`,
        rawData: po,
      });
    }

    // Format Supplier Returns
    for (const sr of supplierReturns) {
      results.push({
        type: 'SUPPLIER_RETURN',
        typeName: 'ใบส่งคืนสินค้า / ใบลดหนี้ (Debit Note)',
        id: sr.id,
        docNumber: sr.returnNumber || sr.id,
        date: sr.createdAt,
        status: sr.status,
        amount: Number(sr.totalAmount),
        customerName: sr.supplier?.name || 'ผู้จำหน่าย',
        description: `ผู้จำหน่าย: ${sr.supplier?.name || '-'} • ยอดเงินคืน/ลดหนี้: ฿${Number(sr.totalAmount).toLocaleString()}`,
        rawData: sr,
      });
    }

    // Format Payment Vouchers
    for (const pv of paymentVouchers) {
      results.push({
        type: 'PAYMENT_VOUCHER',
        typeName: 'ใบสำคัญจ่าย (Payment Voucher)',
        id: pv.id,
        docNumber: pv.voucherNumber,
        date: pv.paymentDate || pv.createdAt,
        status: pv.status,
        amount: Number(pv.netPaidAmount),
        customerName: pv.supplier?.name || 'ผู้รับเงิน',
        description: `จ่ายให้: ${pv.supplier?.name || '-'} • ชำระสุทธิ: ฿${Number(pv.netPaidAmount).toLocaleString()}`,
        rawData: pv,
      });
    }

    return results;
  }
}
