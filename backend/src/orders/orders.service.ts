import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrderStatus, PaymentMethod } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService
  ) {}

  async checkout(data: any, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Generate Order Number
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const count = await tx.order.count({
        where: { orderNumber: { startsWith: `ORD-${dateStr}` } }
      });
      const orderNumber = `ORD-${dateStr}-${String(count + 1).padStart(4, '0')}`;

      let totalCogs = 0;
      const orderItems: any[] = [];

      let subtotal = 0;

      // 2. Deduct FIFO
      for (const item of data.items) {
        const fifoResult = await this.inventory.deductFIFO(item.productId, item.quantity, tx);
        const itemTotal = item.quantity * item.unitPrice;
        subtotal += itemTotal;
        totalCogs += fifoResult.totalCost;
        
        const unitCost = item.quantity > 0 ? fifoResult.totalCost / item.quantity : 0;

        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: unitCost,
          total: itemTotal
        });
      }

      const discountAmount = data.discountAmount || 0;
      const totalAmount = subtotal - discountAmount;

      // 3. Create Order
      const order = await tx.order.create({
        data: {
          orderNumber,
          userId,
          customerId: data.customerId,
          status: OrderStatus.COMPLETED,
          subtotal,
          discountAmount,
          totalAmount,
          totalCogs,
          note: data.note,
          items: {
            create: orderItems
          },
          payments: {
            create: data.payments.map((p: any) => ({
              method: p.method,
              amount: p.amount,
              referenceNo: p.referenceNo
            }))
          }
        },
        include: { items: true, payments: true, customer: true, user: true }
      });

      return order;
    });
  }

  async voidOrder(id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!order) throw new BadRequestException('Order not found');
      if (order.status !== OrderStatus.COMPLETED) throw new BadRequestException('Can only void COMPLETED orders');

      // Restore stock
      for (const item of order.items) {
        // Find newest active batch to restore to, or just create a new adjustment batch
        await tx.stockBatch.create({
          data: {
            productId: item.productId,
            quantityReceived: item.quantity,
            quantityRemaining: item.quantity,
            unitCost: item.unitCost,
            note: `Voided order ${order.orderNumber}`
          }
        });
      }

      return tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.VOIDED,
          voidReason: reason
        }
      });
    });
  }

  async findAll(query: any) {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.startDate && query.endDate) {
      where.createdAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate)
      };
    }
    return this.prisma.order.findMany({
      where,
      include: { items: true, payments: true, customer: true, user: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOne(id: string) {
    return this.prisma.order.findUnique({
      where: { id },
      include: { items: true, payments: true, customer: true, user: true }
    });
  }
}
