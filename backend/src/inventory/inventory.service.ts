import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async addStockBatch(data: any) {
    return this.prisma.stockBatch.create({
      data: {
        productId: data.productId,
        quantityReceived: Number(data.quantity ?? data.quantityReceived) || 0,
        quantityRemaining: Number(data.quantity ?? data.quantityRemaining ?? data.quantityReceived) || 0,
        unitCost: Number(data.unitCost) || 0,
        supplierId: data.supplierId || null,
        note: data.note || null,
      }
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
      const fallbackCost = Number(product.costPrice || product.basePrice || 0);
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
      throw new NotFoundException(`Product with ID/SKU "${dto.productId}" not found`);
    }

    const previousStock = product.stockBatches.reduce((sum, b) => sum + b.quantityRemaining, 0);
    const rawType = (dto.adjustmentType || dto.type || 'SET').toUpperCase();
    const normalizedType = (rawType === 'SUBTRACT' || rawType === 'SUB') ? 'SUB' : (rawType === 'ADD' ? 'ADD' : 'SET');
    
    let rawAmount = Number(dto.amount ?? dto.deltaQuantity ?? dto.newQuantity ?? 0);
    const amount = Math.abs(rawAmount);

    let newStock = previousStock;
    let delta = 0;
    let movementType = 'ADJUST_SET';

    if (normalizedType === 'ADD') {
      delta = amount;
      newStock = previousStock + delta;
      movementType = 'ADJUST_ADD';

      await db.stockBatch.create({
        data: {
          productId: product.id,
          quantityReceived: delta,
          quantityRemaining: delta,
          unitCost: dto.unitCost !== undefined ? dto.unitCost : (Number(product.costPrice) || 0),
          note: dto.reason || 'ปรับเพิ่มสต็อก',
        }
      });
    } else if (normalizedType === 'SUB') {
      delta = -amount;
      newStock = Math.max(0, previousStock - amount);
      movementType = 'ADJUST_SUB';

      // Deduct from batches
      let remainingToDeduct = amount;
      for (const batch of product.stockBatches.filter(b => b.quantityRemaining > 0)) {
        if (remainingToDeduct <= 0) break;
        const deduct = Math.min(batch.quantityRemaining, remainingToDeduct);
        await db.stockBatch.update({
          where: { id: batch.id },
          data: { quantityRemaining: { decrement: deduct } }
        });
        remainingToDeduct -= deduct;
      }
    } else if (normalizedType === 'SET') {
      newStock = Math.max(0, rawAmount);
      delta = newStock - previousStock;
      movementType = delta >= 0 ? 'ADJUST_ADD' : 'ADJUST_SUB';

      if (delta > 0) {
        await db.stockBatch.create({
          data: {
            productId: product.id,
            quantityReceived: delta,
            quantityRemaining: delta,
            unitCost: dto.unitCost !== undefined ? dto.unitCost : (Number(product.costPrice) || 0),
            note: dto.reason || 'ปรับยอดคงเหลือตามตรวจนับจริง',
          }
        });
      } else if (delta < 0) {
        let remainingToDeduct = Math.abs(delta);
        for (const batch of product.stockBatches.filter(b => b.quantityRemaining > 0)) {
          if (remainingToDeduct <= 0) break;
          const deduct = Math.min(batch.quantityRemaining, remainingToDeduct);
          await db.stockBatch.update({
            where: { id: batch.id },
            data: { quantityRemaining: { decrement: deduct } }
          });
          remainingToDeduct -= deduct;
        }
      }
    }

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
