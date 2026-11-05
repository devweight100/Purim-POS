import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [todayOrders, monthOrders, products] = await Promise.all([
      this.prisma.order.findMany({ where: { createdAt: { gte: today }, status: OrderStatus.COMPLETED } }),
      this.prisma.order.findMany({ where: { createdAt: { gte: startOfMonth }, status: OrderStatus.COMPLETED } }),
      this.prisma.product.findMany({
        where: { isActive: true },
        include: { stockBatches: { where: { quantityRemaining: { not: 0 } } } }
      })
    ]);

    const todaySales = todayOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const monthSales = monthOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const totalProducts = products.length;

    let lowStockCount = 0;
    for (const p of products) {
      const stock = p.stockBatches.reduce((sum, b) => sum + b.quantityRemaining, 0);
      if (stock < 20) {
        lowStockCount++;
      }
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const recentOrders = await this.prisma.order.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, status: OrderStatus.COMPLETED },
      select: { createdAt: true, totalAmount: true }
    });

    const salesChart: { date: string, sales: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const nextD = new Date(d);
      nextD.setDate(d.getDate() + 1);

      const dayOrders = recentOrders.filter(o => o.createdAt >= d && o.createdAt < nextD);
      const sales = dayOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
      
      const dayName = d.toLocaleDateString('th-TH', { weekday: 'short' });
      const dayNum = d.getDate().toString().padStart(2, '0');

      salesChart.push({
        date: `${dayName} ${dayNum}`,
        sales
      });
    }

    const monthOrderItems = await this.prisma.orderItem.findMany({
      where: {
        order: {
          createdAt: { gte: startOfMonth },
          status: OrderStatus.COMPLETED
        }
      },
      include: { product: true }
    });

    const productSalesMap = new Map<string, { name: string, quantity: number }>();
    for (const item of monthOrderItems) {
      const existing = productSalesMap.get(item.productId);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        productSalesMap.set(item.productId, { name: item.product.name, quantity: item.quantity });
      }
    }

    const topProducts = Array.from(productSalesMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    return {
      todaySales,
      todayOrders: todayOrders.length,
      monthSales,
      totalProducts,
      lowStockCount,
      salesChart,
      topProducts
    };
  }

  async getSalesSummary(startDate?: string, endDate?: string) {
    const whereClause: any = {};
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        whereClause.createdAt.lte = end;
      }
    }

    const allOrdersInPeriod = await this.prisma.order.findMany({
      where: whereClause,
      include: { payments: true }
    });

    const completedOrders = allOrdersInPeriod.filter(o => o.status === OrderStatus.COMPLETED);
    const voidedOrders = allOrdersInPeriod.filter(o => o.status === OrderStatus.VOIDED).length;

    const totalRevenue = completedOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const totalOrders = completedOrders.length;
    const totalCogs = completedOrders.reduce((sum, o) => sum + Number(o.totalCogs), 0);
    const grossProfit = totalRevenue - totalCogs;

    const paymentBreakdownMap = new Map<string, number>();
    for (const order of completedOrders) {
      for (const payment of order.payments) {
        const current = paymentBreakdownMap.get(payment.method) || 0;
        paymentBreakdownMap.set(payment.method, current + Number(payment.amount));
      }
    }

    const paymentBreakdown = Array.from(paymentBreakdownMap.entries()).map(([method, total]) => ({
      method,
      total
    }));

    return {
      totalRevenue,
      totalOrders,
      totalCogs,
      grossProfit,
      paymentBreakdown,
      voidedOrders
    };
  }

  async getFullAnalytics(startDate?: string, endDate?: string) {
    const whereClause: any = {};
    const hasDateFilter = Boolean(startDate || endDate);

    if (hasDateFilter) {
      whereClause.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          whereClause.createdAt.gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          whereClause.createdAt.lte = end;
        }
      }
    }

    const [orders, activeBatches, products] = await Promise.all([
      this.prisma.order.findMany({
        where: whereClause,
        ...(hasDateFilter ? {} : { take: 50000 }),
        orderBy: { createdAt: 'desc' },
        include: {
          items: { include: { product: true } },
          payments: true,
          customer: { select: { id: true, name: true, phone: true } },
          user: { select: { id: true, fullName: true } },
        },
      }),
      // Include negative (oversold) batches so they net against positive stock.
      this.prisma.stockBatch.findMany({
        where: { quantityRemaining: { not: 0 } },
        select: {
          productId: true,
          quantityRemaining: true,
          unitCost: true,
        },
      }),
      this.prisma.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          sku: true,
          name: true,
          costPrice: true,
          basePrice: true,
          priceLevel1: true,
        },
      }),
    ]);

    const batchValuationByProduct: Record<
      string,
      { quantityRemaining: number; totalCostValue: number; averageUnitCost: number }
    > = {};

    const netByProduct: Record<string, { qty: number; value: number; positiveQty: number; positiveValue: number }> = {};
    for (const batch of activeBatches) {
      const qty = Number(batch.quantityRemaining || 0);
      if (!qty) continue;
      const unitCost = Number(batch.unitCost ?? 0);
      const row = netByProduct[batch.productId] || { qty: 0, value: 0, positiveQty: 0, positiveValue: 0 };
      row.qty += qty;
      row.value += qty * unitCost;
      if (qty > 0) {
        row.positiveQty += qty;
        row.positiveValue += qty * unitCost;
      }
      netByProduct[batch.productId] = row;
    }
    for (const [productId, row] of Object.entries(netByProduct)) {
      // Net on-hand = positive batches minus oversold units. Nothing on hand => no inventory value.
      const quantityRemaining = Math.max(0, row.qty);
      const averageUnitCost = row.positiveQty > 0 ? row.positiveValue / row.positiveQty : 0;
      batchValuationByProduct[productId] = {
        quantityRemaining,
        totalCostValue: quantityRemaining > 0 ? quantityRemaining * averageUnitCost : 0,
        averageUnitCost,
      };
    }

    let totalInventoryCostValue = 0;
    for (const p of products) {
      const batchInfo = batchValuationByProduct[p.id];
      if (batchInfo && batchInfo.quantityRemaining > 0) {
        totalInventoryCostValue +=
          batchInfo.totalCostValue > 0
            ? batchInfo.totalCostValue
            : batchInfo.quantityRemaining * Number(p.costPrice ?? 0);
      }
    }

    // Claim accounting: cost of replacement goods handed out, cash/transfer refunds paid to
    // customers, and value recovered from suppliers via credit notes for defective goods.
    const claimDateWhere = whereClause.createdAt ? { createdAt: whereClause.createdAt } : {};
    const [claimRows, defectiveReturnItems] = await Promise.all([
      this.prisma.customerClaim.findMany({
        where: claimDateWhere,
        select: { claimNumber: true, createdAt: true, metadata: true },
      }),
      this.prisma.supplierReturnNoteItem.findMany({
        where: { itemType: 'DEFECTIVE', note: { status: { not: 'CANCELLED' }, ...claimDateWhere } },
        select: { total: true, note: { select: { returnNumber: true, createdAt: true } } },
      }),
    ]);
    const claimEvents = claimRows
      .map((c) => {
        const acc = ((c.metadata as any) || {}).accounting || {};
        return {
          createdAt: c.createdAt.toISOString(),
          claimNumber: c.claimNumber,
          replacementCost: Number(acc.replacementCost) || 0,
          refundPaid: Number(acc.refundPaid) || 0,
        };
      })
      .filter((e) => e.replacementCost > 0 || e.refundPaid > 0);
    const supplierRecoveries = defectiveReturnItems.map((i) => ({
      createdAt: i.note.createdAt.toISOString(),
      returnNumber: i.note.returnNumber,
      amount: Number(i.total) || 0,
    }));

    return {
      orders,
      claimAccounting: { events: claimEvents, supplierRecoveries },
      stockBatchValuation: {
        byProductId: batchValuationByProduct,
        totalInventoryCostValue,
      },
    };
  }
}
