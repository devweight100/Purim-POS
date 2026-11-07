import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Largest quantity accepted by a manual stock adjustment (stock columns are 32-bit ints). */
export const MAX_ADJUST_QTY = 10_000_000;

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  /** Add received stock as a new FIFO batch. Goes through adjustStock so it is audited. */
  async addStockBatch(data: any, user?: { id?: string; fullName?: string; username?: string }) {
    const quantity = Number(data.quantity ?? data.quantityReceived);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new BadRequestException('จำนวนรับเข้าต้องเป็นจำนวนเต็มมากกว่า 0');
    const unitCost = Number(data.unitCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new BadRequestException('ต้นทุนต่อหน่วยไม่ถูกต้อง');
    return this.adjustStock({
      productId: data.productId,
      type: 'ADD',
      amount: quantity,
      unitCost,
      reason: data.note || 'รับสินค้าเข้า (stock batch)',
      userId: user?.id,
      userName: user?.fullName || user?.username,
    });
  }

  async getStockLevel(productId: string) {
    const batches = await this.prisma.stockBatch.findMany({
      where: { productId }
    });
    return batches.reduce((sum, batch) => sum + batch.quantityRemaining, 0);
  }

  async deductFIFO(productId: string, quantity: number, tx: any = this.prisma) {
    if (tx === this.prisma) return businessTransaction(this.prisma, inner => this.deductFIFO(productId, quantity, inner));
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new BadRequestException('จำนวนตัดสต็อกต้องมากกว่า 0');

    // 1. Lock the product row first
    const products = await tx.$queryRaw<{ id: string; costPrice: any; basePrice: any }[]>`
      SELECT id, cost_price AS "costPrice", base_price AS "basePrice"
      FROM products
      WHERE id = ${productId}
      FOR UPDATE
    `;
    const product = products[0];
    if (!product) throw new NotFoundException(`ไม่พบสินค้า "${productId}"`);

    // 2. Lock and retrieve all stock batches in FIFO order
    const batches = await tx.$queryRaw<{ id: string; quantityRemaining: number; unitCost: any }[]>`
      SELECT id, quantity_remaining AS "quantityRemaining", unit_cost AS "unitCost"
      FROM stock_batches
      WHERE product_id = ${productId}
      ORDER BY received_at ASC, id ASC
      FOR UPDATE
    `;

    let remainingToDeduct = quantity;
    let totalCost = 0;
    const deductedBatches: any[] = [];

    // 3. Deduct from available positive batches
    for (const batch of batches) {
      if (remainingToDeduct <= 0) break;
      if (batch.quantityRemaining <= 0) continue;

      const deductAmount = Math.min(batch.quantityRemaining, remainingToDeduct);
      
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { quantityRemaining: { decrement: deductAmount } }
      });

      const unitCost = Number(batch.unitCost);
      totalCost += deductAmount * unitCost;
      remainingToDeduct -= deductAmount;
      
      deductedBatches.push({
        batchId: batch.id,
        deducted: deductAmount,
        unitCost: unitCost
      });
    }

    // 4. If remainingToDeduct > 0: Allow stock to go negative (ขายเกินสต็อกได้)
    if (remainingToDeduct > 0) {
      // Cost for units sold beyond stock: product cost, else the latest known purchase cost.
      // Never the selling price (basePrice), which would make the sale look like zero profit.
      const latestCostBatch = batches.slice().reverse().find(b => Number(b.unitCost) > 0);
      const fallbackCost = Number(product.costPrice) > 0
        ? Number(product.costPrice)
        : Number(latestCostBatch?.unitCost || 0);
      const negativeBatch = batches.slice().reverse().find(b => b.quantityRemaining < 0);

      if (negativeBatch) {
        await tx.stockBatch.update({
          where: { id: negativeBatch.id },
          data: { quantityRemaining: { decrement: remainingToDeduct } }
        });
        const unitCost = Number(negativeBatch.unitCost || fallbackCost);
        totalCost += remainingToDeduct * unitCost;
        deductedBatches.push({
          batchId: negativeBatch.id,
          deducted: remainingToDeduct,
          unitCost: unitCost
        });
      } else {
        const overdraftBatch = await tx.stockBatch.create({
          data: {
            productId,
            quantityReceived: 0,
            quantityRemaining: -remainingToDeduct,
            unitCost: fallbackCost,
            note: 'ขายตอนสต็อกไม่พอ (สต็อกติดลบ)'
          }
        });
        totalCost += remainingToDeduct * fallbackCost;
        deductedBatches.push({
          batchId: overdraftBatch.id,
          deducted: remainingToDeduct,
          unitCost: fallbackCost
        });
      }
    }

    return { totalCost, batches: deductedBatches };
  }

  async adjustStock(dto: {
    productId: string;
    type?: string;
    adjustmentType?: string;
    amount?: number;
    deltaQuantity?: number;
    newQuantity?: number;
    reason?: string;
    unitCost?: number;
    userName?: string;
    userId?: string;
  }, db: any = this.prisma) {
    if (db === this.prisma) return businessTransaction(this.prisma, tx => this.adjustStock(dto, tx));
    // 1. Find product by id or sku
    const product = await db.product.findFirst({
      where: {
        OR: [
          { id: dto.productId },
          { sku: dto.productId },
        ]
      },
      include: {
        stockBatches: true,
      }
    });

    if (!product) {
      throw new NotFoundException(`ไม่พบสินค้า "${dto.productId}"`);
    }

    const previousStock = product.stockBatches.reduce((sum, b) => sum + b.quantityRemaining, 0);
    const rawType = String(dto.adjustmentType || dto.type || '').trim().toUpperCase();
    const normalizedType = rawType === 'SUBTRACT' || rawType === 'SUB' ? 'SUB' : rawType === 'ADD' || rawType === 'SET' ? rawType : null;
    if (!normalizedType) throw new BadRequestException('ประเภทการปรับสต็อกต้องเป็น ADD, SUB หรือ SET');

    const amountInput = dto.amount ?? dto.deltaQuantity ?? dto.newQuantity;
    if (amountInput === undefined || amountInput === null || String(amountInput).trim() === '') {
      throw new BadRequestException('กรุณาระบุจำนวน');
    }
    const rawAmount = Number(amountInput);
    if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount)) throw new BadRequestException('จำนวนต้องเป็นจำนวนเต็ม');
    if (Math.abs(rawAmount) > MAX_ADJUST_QTY) throw new BadRequestException(`จำนวนต้องไม่เกิน ${MAX_ADJUST_QTY.toLocaleString('en-US')}`);
    if (normalizedType !== 'SET' && rawAmount <= 0) {
      throw new BadRequestException(normalizedType === 'ADD' ? 'จำนวนปรับเพิ่มต้องมากกว่า 0' : 'จำนวนปรับลดต้องมากกว่า 0');
    }
    const amount = rawAmount;
    const fallbackCost = dto.unitCost !== undefined && dto.unitCost !== null ? Number(dto.unitCost) : (Number(product.costPrice) || 0);
    if (!Number.isFinite(fallbackCost) || fallbackCost < 0 || fallbackCost > 10_000_000) throw new BadRequestException('ต้นทุนต่อหน่วยไม่ถูกต้อง');

    // Positive batches in FIFO order (oldest first)
    const fifo = product.stockBatches
      .filter((b: any) => b.quantityRemaining > 0)
      .sort((x: any, y: any) => new Date(x.receivedAt).getTime() - new Date(y.receivedAt).getTime() || String(x.id).localeCompare(String(y.id)));
    const onHand = fifo.reduce((sum: number, b: any) => sum + b.quantityRemaining, 0);
    // Oversold (negative) batches, oldest first: stock coming in settles these before a new batch is opened
    const overdraft = product.stockBatches
      .filter((b: any) => b.quantityRemaining < 0)
      .sort((x: any, y: any) => new Date(x.receivedAt).getTime() - new Date(y.receivedAt).getTime() || String(x.id).localeCompare(String(y.id)));

    const addBatch = async (qty: number, note: string) => {
      let left = qty;
      for (const batch of overdraft) {
        if (left <= 0) break;
        const fill = Math.min(-batch.quantityRemaining, left);
        if (fill <= 0) continue;
        await db.stockBatch.update({ where: { id: batch.id }, data: { quantityRemaining: { increment: fill } } });
        batch.quantityRemaining += fill;
        left -= fill;
      }
      if (left > 0) {
        await db.stockBatch.create({
          data: { productId: product.id, quantityReceived: left, quantityRemaining: left, unitCost: fallbackCost, note },
        });
      }
      return qty * fallbackCost;
    };
    const deductFifo = async (qty: number) => {
      const available = Math.min(onHand, Math.max(0, previousStock)); // net of oversold (negative) batches
      if (qty > available) throw new BadRequestException(`สต็อกคงเหลือไม่พอให้ปรับลด (มี ${available} ต้องการลด ${qty})`);
      let left = qty;
      let cost = 0;
      for (const batch of fifo) {
        if (left <= 0) break;
        const take = Math.min(batch.quantityRemaining, left);
        await db.stockBatch.update({ where: { id: batch.id }, data: { quantityRemaining: { decrement: take } } });
        cost += take * Number(batch.unitCost);
        left -= take;
      }
      return cost;
    };

    let delta = 0;
    let movementType = 'ADJUST_SET';
    let costValue = 0; // cost of units added (+) or written off (-)

    if (normalizedType === 'ADD') {
      delta = amount;
      movementType = 'ADJUST_ADD';
      costValue = await addBatch(amount, dto.reason || 'ปรับเพิ่มสต็อก');
    } else if (normalizedType === 'SUB') {
      delta = -amount;
      movementType = 'ADJUST_SUB';
      costValue = -(await deductFifo(amount));
    } else {
      if (rawAmount < 0) throw new BadRequestException('ยอดตรวจนับต้องไม่ติดลบ');
      delta = rawAmount - previousStock;
      movementType = delta >= 0 ? 'ADJUST_ADD' : 'ADJUST_SUB';
      if (delta > 0) costValue = await addBatch(delta, dto.reason || 'ปรับยอดคงเหลือตามตรวจนับจริง');
      else if (delta < 0) costValue = -(await deductFifo(-delta));
    }
    const newStock = previousStock + delta;

    // Record AuditLog
    await db.auditLog.create({
      data: {
        userId: dto.userId || null,
        action: `STOCK_${movementType}`,
        entity: 'Product',
        entityId: product.id,
        details: {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          unitName: product.unit || 'ชิ้น',
          type: movementType,
          quantityChange: delta,
          previousStock,
          currentStock: newStock,
          costValue: Math.round(costValue * 100) / 100,
          reason: dto.reason || 'ปรับสต็อก',
          userName: dto.userName || 'ผู้ดูแลระบบ',
        }
      }
    });

    return {
      success: true,
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      previousStock,
      newStock,
      delta,
      costValue: Math.round(costValue * 100) / 100,
    };
  }

  async getMovements(productId?: string, limit = 100) {
    const where: any = {
      action: { startsWith: 'STOCK_' }
    };
    if (productId) {
      where.entityId = productId;
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return logs.map((log: any) => {
      const details = (log.details as any) || {};
      return {
        id: log.id,
        productId: log.entityId,
        sku: details.sku || '-',
        productName: details.productName || 'สินค้า',
        unitName: details.unitName || 'ชิ้น',
        type: details.type || log.action.replace('STOCK_', ''),
        quantityChange: details.quantityChange || 0,
        previousStock: details.previousStock || 0,
        currentStock: details.currentStock || 0,
        referenceType: details.referenceType || 'ADJUST',
        referenceNo: details.referenceNo || '-',
        reason: details.reason || '-',
        userName: details.userName || 'ระบบ',
        createdAt: log.createdAt.toISOString(),
      };
    });
  }
}
