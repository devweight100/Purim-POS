import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { businessTransaction } from '../prisma/business-transaction';
import * as ledger from '../finance/ledger';
import { addQty, decimalQtyAllowed, mulQty, parseQty, qn, roundQty, subQty } from '../common/qty';

const round2 = (n: number) => Math.round(n * 100) / 100;
const CLIENT_ID = /^[a-zA-Z0-9-]{16,80}$/;
const REFUND_METHODS = ['CASH', 'TRANSFER', 'DEBT_REDUCTION'];

export interface ReturnInput {
  clientReturnId?: string;
  items?: { orderItemId: string; quantity: number; restock?: boolean }[];
  refundMethod?: string;
  bankAccountId?: string;
  shiftId?: string;
  reason?: string;
}

/**
 * Partial return of a completed bill. Refund = the line's paid amount for the returned
 * quantity, including its share of the bill discount. Returned goods go back to stock at their
 * original FIFO cost (or are left out of stock when damaged), money is paid back from the
 * drawer / bank or deducted from the customer's debt, earned points are taken back pro rata.
 */
@Injectable()
export class ReturnsService {
  constructor(private prisma: PrismaService) {}

  async listForOrder(orderId: string) {
    return this.prisma.orderReturn.findMany({ where: { orderId }, include: { items: true }, orderBy: { createdAt: 'asc' } });
  }

  async createReturn(orderId: string, dto: ReturnInput, actor: { id?: string; role?: string; fullName?: string; username?: string }) {
    if (!dto.clientReturnId || !CLIENT_ID.test(dto.clientReturnId)) throw new BadRequestException('ต้องระบุรหัสรายการคืนสินค้า (clientReturnId)');
    const method = String(dto.refundMethod || '').toUpperCase();
    if (!REFUND_METHODS.includes(method)) throw new BadRequestException('วิธีคืนเงินต้องเป็น เงินสด / โอน / หักจากหนี้');
    const reason = String(dto.reason || '').trim();
    if (!reason) throw new BadRequestException('กรุณาระบุเหตุผลการคืนสินค้า');
    const lines = Array.isArray(dto.items) ? dto.items.filter((i) => Number(i.quantity) > 0) : [];
    if (!lines.length) throw new BadRequestException('กรุณาเลือกสินค้าที่ลูกค้าคืนอย่างน้อย 1 รายการ');
    if (new Set(lines.map((l) => l.orderItemId)).size !== lines.length) throw new BadRequestException('มีรายการสินค้าซ้ำ');

    return businessTransaction(this.prisma, async (tx) => {
      const key = 'order-return-' + dto.clientReturnId;
      const prev = await tx.auditLog.findUnique({ where: { id: key } });
      if (prev) return (prev.details as any).result;

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { product: true } }, debt: true, payments: true, returns: { include: { items: true } } },
      });
      if (!order) throw new NotFoundException('ไม่พบบิลนี้');
      if (order.status !== 'COMPLETED') throw new BadRequestException('คืนสินค้าได้เฉพาะบิลที่สำเร็จแล้ว');

      const returnedQty = new Map<string, number>();
      const returnedBase = new Map<string, number>();
      for (const r of order.returns) for (const it of r.items) {
        returnedQty.set(it.orderItemId, addQty(returnedQty.get(it.orderItemId) || 0, it.quantity));
        returnedBase.set(it.orderItemId, addQty(returnedBase.get(it.orderItemId) || 0, it.baseQuantity));
      }
      const allowDecimal = await decimalQtyAllowed(tx);
      const billFactor = Number(order.subtotal) > 0 ? Number(order.totalAmount) / Number(order.subtotal) : 1; // bill-level discount share

      const now = new Date();
      const prefix = `RET-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const last = await tx.orderReturn.findFirst({ where: { returnNumber: { startsWith: prefix } }, orderBy: { returnNumber: 'desc' } });
      const returnNumber = prefix + String((Number(last?.returnNumber.slice(prefix.length)) || 0) + 1).padStart(5, '0');
      const actorName = actor?.fullName || actor?.username || 'พนักงาน';

      let refund = 0;
      let cogsReturned = 0;
      const itemRows: any[] = [];
      for (const line of lines) {
        const item = order.items.find((i) => i.id === line.orderItemId);
        if (!item) throw new BadRequestException('รายการสินค้าไม่อยู่ในบิลนี้');
        const itemQty = qn(item.quantity);
        const itemBase = qn(item.baseQuantity ?? item.quantity);
        const left = subQty(itemQty, returnedQty.get(item.id) || 0);
        const overMsg = `${item.product.name} คืนได้ไม่เกิน ${left} ${item.unitName || item.product.unit || 'ชิ้น'}`;
        const qty = parseQty(line.quantity, { allowDecimal, message: overMsg });
        if (qty > left) throw new BadRequestException(overMsg);
        const factor = itemQty > 0 ? itemBase / itemQty : 1;
        // the last part of a line returns exactly what is left in base units (no rounding residue)
        const baseQty = qty === left ? subQty(itemBase, returnedBase.get(item.id) || 0) : mulQty(qty, factor);
        const lineRefund = round2((Number(item.total) * qty / itemQty) * billFactor);
        const unitCost = Number(item.unitCost);
        const restock = line.restock !== false;
        refund += lineRefund;

        if (restock) {
          const bundle = Array.isArray(item.bundleData) ? (item.bundleData as any[]) : [];
          const parts = bundle.length
            ? bundle.map((c) => ({ productId: c.productId, name: c.productName, qty: roundQty(Number(c.totalQuantity) * qty / itemQty), cost: Number(c.unitCost) || 0 }))
            : [{ productId: item.productId, name: item.product.name, qty: baseQty, cost: unitCost }];
          for (const part of parts) {
            if (part.qty <= 0) continue;
            const agg = await tx.stockBatch.aggregate({ where: { productId: part.productId }, _sum: { quantityRemaining: true } });
            const previousStock = qn(agg._sum.quantityRemaining);
            await tx.stockBatch.create({ data: { productId: part.productId, quantityReceived: part.qty, quantityRemaining: part.qty, unitCost: part.cost, note: `รับคืนจากลูกค้า ${returnNumber} (บิล ${order.orderNumber})` } });
            cogsReturned += part.qty * part.cost;
            await tx.auditLog.create({
              data: {
                userId: actor?.id ?? null, action: 'STOCK_IN_RETURN', entity: 'Product', entityId: part.productId,
                details: { productId: part.productId, productName: part.name, type: 'IN_RETURN', quantityChange: part.qty, previousStock, currentStock: addQty(previousStock, part.qty), referenceType: 'RETURN', referenceNo: returnNumber, reason: `ลูกค้าคืนสินค้า: ${reason}`, userName: actorName },
              },
            });
          }
        }
        itemRows.push({ orderItemId: item.id, productId: item.productId, quantity: qty, baseQuantity: baseQty, refundAmount: lineRefund, unitCost, restock });
      }
      const remainingRefundable = round2(Number(order.totalAmount) - Number(order.returnedAmount));
      // the last return of a bill refunds exactly what is left (no rounding residue)
      const fullyReturned = order.items.every((i) => {
        const now = itemRows.find((r) => r.orderItemId === i.id)?.quantity || 0;
        return addQty(returnedQty.get(i.id) || 0, now) >= qn(i.quantity);
      });
      if (fullyReturned && itemRows.length) {
        const diff = round2(remainingRefundable - refund);
        refund = remainingRefundable;
        const last = itemRows[itemRows.length - 1];
        last.refundAmount = Math.max(0, round2(last.refundAmount + diff));
      }
      refund = round2(Math.min(refund, remainingRefundable));
      if (refund <= 0) throw new BadRequestException('ยอดคืนเงินไม่ถูกต้อง');

      // Money can only go back the way it came in: cash / transfer up to what the customer actually
      // paid (at the till or later against the debt), the unpaid credit part only by reducing the debt.
      if (method === 'CASH' || method === 'TRANSFER') {
        const paidAtSale = order.payments.filter((p) => p.method !== 'CREDIT_DEBT').reduce((s, p) => s + Number(p.amount), 0);
        const paidOnDebt = order.debt ? Number(order.debt.paidAmount) : 0;
        const refundedMoney = order.returns.filter((r) => r.refundMethod === 'CASH' || r.refundMethod === 'TRANSFER').reduce((s, r) => s + Number(r.refundAmount), 0);
        const maxMoney = round2(paidAtSale + paidOnDebt - refundedMoney);
        if (refund > maxMoney + 0.001) {
          throw new BadRequestException(maxMoney > 0
            ? `คืนเป็นเงินสด/โอนได้ไม่เกินยอดที่ลูกค้าจ่ายจริง ฿${maxMoney.toFixed(2)} ส่วนที่ค้างชำระต้องคืนโดยหักจากหนี้`
            : 'บิลนี้ลูกค้ายังไม่ได้จ่ายเงิน ต้องคืนโดยหักจากหนี้เท่านั้น');
        }
      }
      const vatAmount = Number(order.vatRate) > 0 ? round2(refund * Number(order.vatRate) / (100 + Number(order.vatRate))) : 0;

      const created = await tx.orderReturn.create({
        data: {
          returnNumber, orderId, userId: actor?.id ?? null, refundMethod: method, bankAccountId: method === 'TRANSFER' ? dto.bankAccountId || null : null,
          shiftId: method === 'CASH' ? dto.shiftId || null : null, refundAmount: refund, vatAmount, cogsReturned: round2(cogsReturned), reason,
          items: { create: itemRows },
        },
        include: { items: true },
      });

      // money back to the customer
      const refType = 'ORDER_RETURN';
      if (method === 'CASH') {
        const shift = dto.shiftId ? await tx.shift.findUnique({ where: { id: dto.shiftId }, include: { cashMovements: true } }) : null;
        if (!shift || shift.status !== 'OPEN') throw new BadRequestException('คืนเงินสดต้องมีกะที่เปิดอยู่');
        if (shift.userId !== actor?.id && actor?.role !== 'ADMIN' && actor?.role !== 'MANAGER') throw new BadRequestException('คืนเงินสดได้จากกะของตัวเองเท่านั้น');
        const drawer = await ledger.drawerAccount(tx, shift.terminalId);
        const inDrawer = await ledger.balanceOf(tx, drawer.id);
        if (inDrawer + 0.001 < refund) throw new BadRequestException(`เงินสดในลิ้นชักไม่พอคืน (มี ฿${inDrawer.toFixed(2)})`);
        await tx.cashMovement.create({ data: { shiftId: shift.id, type: 'OUT', category: 'REFUND', amount: refund, reason: `คืนเงินสดคืนสินค้า ${returnNumber} (บิล ${order.orderNumber})` } });
        await ledger.post(tx, { accountId: drawer.id, direction: 'OUT', amount: refund, type: 'SALE_REFUND', refType, refId: created.id, note: `คืนสินค้า ${returnNumber} (บิล ${order.orderNumber})`, userId: actor?.id });
      } else if (method === 'TRANSFER') {
        const bank = await ledger.bankMoneyAccount(tx, dto.bankAccountId);
        await ledger.post(tx, { accountId: bank.id, direction: 'OUT', amount: refund, type: 'SALE_REFUND', refType, refId: created.id, note: `โอนคืนเงินคืนสินค้า ${returnNumber} (บิล ${order.orderNumber})`, userId: actor?.id });
      } else {
        if (!order.debt || Number(order.debt.remainingAmount) + 0.001 < refund) {
          throw new BadRequestException(`หักจากหนี้ได้ไม่เกินยอดหนี้คงเหลือของบิลนี้ (฿${Number(order.debt?.remainingAmount || 0).toFixed(2)})`);
        }
        const remaining = round2(Number(order.debt.remainingAmount) - refund);
        await tx.customerDebt.update({
          where: { id: order.debt.id },
          data: { totalDebt: round2(Number(order.debt.totalDebt) - refund), remainingAmount: remaining, status: remaining <= 0 ? 'PAID' : order.debt.status },
        });
      }

      // points, pro rata to the refunded share of the bill (all of them once the whole bill is back):
      // earned points are taken back, redeemed points are given back
      let pointsBack = 0;
      let pointsRestored = 0;
      if (order.customerId && (order.pointsEarned > 0 || order.pointsUsed > 0) && Number(order.totalAmount) > 0) {
        const earlier = await tx.auditLog.findMany({ where: { action: 'ORDER_RETURN', entityId: orderId } });
        const share = (amount: number) => amount / Number(order.totalAmount);
        let backBefore = 0;
        let restoredBefore = 0;
        for (const log of earlier) {
          const r = (log.details as any)?.result || {};
          backBefore += r.pointsBack ?? Math.floor(order.pointsEarned * share(Number(r.refundAmount) || 0));
          restoredBefore += r.pointsRestored ?? 0;
        }
        const cumulative = Number(order.returnedAmount) + refund;
        const full = fullyReturned || cumulative >= Number(order.totalAmount) - 0.001;
        const backTarget = full ? order.pointsEarned : Math.floor(order.pointsEarned * share(cumulative));
        const restoreTarget = full ? order.pointsUsed : Math.floor(order.pointsUsed * share(cumulative));
        const customer = await tx.customer.findUnique({ where: { id: order.customerId } });
        pointsRestored = Math.max(0, restoreTarget - restoredBefore);
        pointsBack = Math.min((customer?.points || 0) + pointsRestored, Math.max(0, backTarget - backBefore));
        const delta = pointsRestored - pointsBack;
        if (delta !== 0) await tx.customer.update({ where: { id: order.customerId }, data: { points: { increment: delta } } });
      }

      await tx.order.update({ where: { id: orderId }, data: { returnedAmount: { increment: refund } } });
      const result = { success: true, returnNumber, refundAmount: refund, refundMethod: method, vatAmount, cogsReturned: round2(cogsReturned), id: created.id, pointsBack, pointsRestored };
      await tx.auditLog.create({ data: { id: key, action: 'ORDER_RETURN', entity: 'Order', entityId: orderId, userId: actor?.id ?? null, details: { result } } });
      return result;
    });
  }
}
