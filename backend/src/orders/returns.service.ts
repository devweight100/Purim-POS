import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { businessTransaction } from '../prisma/business-transaction';
import * as ledger from '../finance/ledger';

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
        include: { items: { include: { product: true } }, debt: true, returns: { include: { items: true } } },
      });
      if (!order) throw new NotFoundException('ไม่พบบิลนี้');
      if (order.status !== 'COMPLETED') throw new BadRequestException('คืนสินค้าได้เฉพาะบิลที่สำเร็จแล้ว');

      const returnedQty = new Map<string, number>();
      for (const r of order.returns) for (const it of r.items) returnedQty.set(it.orderItemId, (returnedQty.get(it.orderItemId) || 0) + it.quantity);
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
        const qty = Number(line.quantity);
        const left = item.quantity - (returnedQty.get(item.id) || 0);
        if (!Number.isSafeInteger(qty) || qty <= 0 || qty > left) throw new BadRequestException(`${item.product.name} คืนได้ไม่เกิน ${left} ${item.unitName || item.product.unit || 'ชิ้น'}`);
        const factor = (item.baseQuantity ?? item.quantity) / item.quantity;
        const baseQty = Math.round(qty * factor);
        const lineRefund = round2((Number(item.total) * qty / item.quantity) * billFactor);
        const unitCost = Number(item.unitCost);
        const restock = line.restock !== false;
        refund += lineRefund;

        if (restock) {
          const bundle = Array.isArray(item.bundleData) ? (item.bundleData as any[]) : [];
          const parts = bundle.length
            ? bundle.map((c) => ({ productId: c.productId, name: c.productName, qty: Math.round(Number(c.totalQuantity) * qty / item.quantity), cost: Number(c.unitCost) || 0 }))
            : [{ productId: item.productId, name: item.product.name, qty: baseQty, cost: unitCost }];
          for (const part of parts) {
            if (part.qty <= 0) continue;
            const agg = await tx.stockBatch.aggregate({ where: { productId: part.productId }, _sum: { quantityRemaining: true } });
            const previousStock = Number(agg._sum.quantityRemaining || 0);
            await tx.stockBatch.create({ data: { productId: part.productId, quantityReceived: part.qty, quantityRemaining: part.qty, unitCost: part.cost, note: `รับคืนจากลูกค้า ${returnNumber} (บิล ${order.orderNumber})` } });
            cogsReturned += part.qty * part.cost;
            await tx.auditLog.create({
              data: {
                userId: actor?.id ?? null, action: 'STOCK_IN_RETURN', entity: 'Product', entityId: part.productId,
                details: { productId: part.productId, productName: part.name, type: 'IN_RETURN', quantityChange: part.qty, previousStock, currentStock: previousStock + part.qty, referenceType: 'RETURN', referenceNo: returnNumber, reason: `ลูกค้าคืนสินค้า: ${reason}`, userName: actorName },
              },
            });
          }
        }
        itemRows.push({ orderItemId: item.id, productId: item.productId, quantity: qty, baseQuantity: baseQty, refundAmount: lineRefund, unitCost, restock });
      }
      refund = round2(Math.min(refund, Number(order.totalAmount) - Number(order.returnedAmount)));
      if (refund <= 0) throw new BadRequestException('ยอดคืนเงินไม่ถูกต้อง');
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

      // take back points earned on the returned part
      if (order.customerId && order.pointsEarned > 0 && Number(order.totalAmount) > 0) {
        const customer = await tx.customer.findUnique({ where: { id: order.customerId } });
        const back = Math.min(customer?.points || 0, Math.floor(order.pointsEarned * refund / Number(order.totalAmount)));
        if (back > 0) await tx.customer.update({ where: { id: order.customerId }, data: { points: { decrement: back } } });
      }

      await tx.order.update({ where: { id: orderId }, data: { returnedAmount: { increment: refund } } });
      const result = { success: true, returnNumber, refundAmount: refund, refundMethod: method, vatAmount, cogsReturned: round2(cogsReturned), id: created.id };
      await tx.auditLog.create({ data: { id: key, action: 'ORDER_RETURN', entity: 'Order', entityId: orderId, userId: actor?.id ?? null, details: { result } } });
      return result;
    });
  }
}
