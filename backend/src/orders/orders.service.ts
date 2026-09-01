import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrderStatus, PaymentMethod, DebtStatus } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService
  ) {}

  async checkout(data: any, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Idempotency check for offline sync (clientOrderId)
      if (data.clientOrderId) {
        const existing = await tx.order.findUnique({
          where: { clientOrderId: data.clientOrderId },
          include: { items: { include: { product: true } }, payments: true, customer: true, user: true },
        });
        if (existing) {
          // Already synced! Return existing order directly to avoid duplicate processing.
          return existing;
        }
      }

      // 2. Generate or use Order Number
      let orderNumber = data.orderNumber;
      if (!orderNumber) {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const count = await tx.order.count({
          where: { orderNumber: { startsWith: `ORD-${dateStr}` } },
        });
        orderNumber = `ORD-${dateStr}-${String(count + 1).padStart(4, '0')}`;
      }

      let totalCogs = 0;
      const orderItems: any[] = [];
      let subtotal = 0;

      // 3. Deduct FIFO Inventory
      for (const item of data.items) {
        const fifoResult = await this.inventory.deductFIFO(item.productId, item.quantity, tx);
        const itemTotal = item.quantity * Number(item.unitPrice);
        subtotal += itemTotal;
        totalCogs += fifoResult.totalCost;

        const unitCost = item.quantity > 0 ? fifoResult.totalCost / item.quantity : 0;

        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: unitCost,
          total: itemTotal,
        });
      }

      const discountAmount = Number(data.discountAmount) || 0;
      const totalAmount = Math.max(0, subtotal - discountAmount);

      // 4. Create Order
      const order = await tx.order.create({
        data: {
          clientOrderId: data.clientOrderId || null,
          orderNumber,
          userId,
          customerId: data.customerId || null,
          shiftId: data.shiftId || null,
          status: OrderStatus.COMPLETED,
          subtotal,
          discountAmount,
          totalAmount,
          totalCogs,
          note: data.note || null,
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
          items: {
            create: orderItems,
          },
          payments: {
            create: (data.payments || []).map((p: any) => ({
              method: p.method,
              amount: Number(p.amount) || 0,
              referenceNo: p.referenceNo || null,
            })),
          },
        },
        include: { items: true, payments: true, customer: true, user: true },
      });

      // 5. Check for Debt payment method (CREDIT_DEBT)
      const debtPayment = (data.payments || []).find((p: any) => p.method === PaymentMethod.CREDIT_DEBT);
      if (debtPayment && data.customerId) {
        const debtAmount = Number(debtPayment.amount) || totalAmount;
        await tx.customerDebt.create({
          data: {
            customerId: data.customerId,
            orderId: order.id,
            totalDebt: debtAmount,
            paidAmount: 0,
            remainingAmount: debtAmount,
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            status: DebtStatus.PENDING,
            note: data.debtNote || `หนี้จากการขายบิล ${orderNumber}`,
          },
        });
      }

      return order;
    });
  }

  async syncOfflineOrders(orders: any[], userId: string) {
    const results: any[] = [];
    let syncedCount = 0;
    let failedCount = 0;

    for (const orderData of orders) {
      try {
        const syncedOrder = await this.checkout(orderData, userId);
        results.push({ clientOrderId: orderData.clientOrderId, success: true, orderNumber: syncedOrder.orderNumber });
        syncedCount++;
      } catch (err: any) {
        results.push({ clientOrderId: orderData.clientOrderId, success: false, error: err.message });
        failedCount++;
      }
    }

    return {
      success: true,
      syncedCount,
      failedCount,
      results,
    };
  }

  async voidOrder(id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!order) throw new NotFoundException('ไม่พบออเดอร์นี้');
      if (order.status !== OrderStatus.COMPLETED) throw new BadRequestException('สามารถยกเลิกได้เฉพาะออเดอร์ที่สำเร็จแล้วเท่านั้น');

      // Restore stock
      for (const item of order.items) {
        await tx.stockBatch.create({
          data: {
            productId: item.productId,
            quantityReceived: item.quantity,
            quantityRemaining: item.quantity,
            unitCost: item.unitCost,
            note: `คืนสต็อกจากการยกเลิกบิล ${order.orderNumber}`,
          },
        });
      }

      return tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.VOIDED,
          voidReason: reason,
        },
      });
    });
  }

  async findAll(query: any) {
    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status && query.status !== 'ALL') {
      where.status = query.status as OrderStatus;
    }

    if (query.startDate && query.endDate) {
      where.createdAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    if (query.search && query.search.trim()) {
      where.OR = [
        { orderNumber: { contains: query.search.trim(), mode: 'insensitive' } },
        { customer: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
        { customer: { phone: { contains: query.search.trim() } } },
      ];
    }

    const [orders, total, aggregate] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          payments: true,
          customer: { select: { id: true, name: true, phone: true } },
          user: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.aggregate({
        where: { ...where, status: OrderStatus.COMPLETED },
        _sum: { totalAmount: true, totalCogs: true },
      }),
    ]);

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalSales: Number(aggregate._sum.totalAmount) || 0,
        totalCogs: Number(aggregate._sum.totalCogs) || 0,
        grossProfit: (Number(aggregate._sum.totalAmount) || 0) - (Number(aggregate._sum.totalCogs) || 0),
        orderCount: total,
      },
    };
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        payments: true,
        customer: true,
        user: true,
        debt: true,
      },
    });
    if (!order) throw new NotFoundException('ไม่พบบิลนี้');
    return order;
  }
}
