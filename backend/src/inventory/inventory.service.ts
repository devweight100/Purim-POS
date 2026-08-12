import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async addStockBatch(data: any) {
    return this.prisma.stockBatch.create({
      data: {
        productId: data.productId,
        quantityReceived: data.quantity,
        quantityRemaining: data.quantity,
        unitCost: data.unitCost,
        supplierId: data.supplierId,
        note: data.note,
      }
    });
  }

  async getStockLevel(productId: string) {
    const batches = await this.prisma.stockBatch.findMany({
      where: { productId, quantityRemaining: { gt: 0 } }
    });
    return batches.reduce((sum, batch) => sum + batch.quantityRemaining, 0);
  }

  async deductFIFO(productId: string, quantity: number, tx: any = this.prisma) {
    const batches = await tx.stockBatch.findMany({
      where: { productId, quantityRemaining: { gt: 0 } },
      orderBy: { receivedAt: 'asc' }
    });

    let remainingToDeduct = quantity;
    let totalCost = 0;
    const deductedBatches: any[] = [];

    for (const batch of batches) {
      if (remainingToDeduct <= 0) break;

      const deductAmount = Math.min(batch.quantityRemaining, remainingToDeduct);
      
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { quantityRemaining: batch.quantityRemaining - deductAmount }
      });

      totalCost += deductAmount * Number(batch.unitCost);
      remainingToDeduct -= deductAmount;
      
      deductedBatches.push({
        batchId: batch.id,
        deducted: deductAmount,
        unitCost: batch.unitCost
      });
    }

    if (remainingToDeduct > 0) {
      throw new BadRequestException(`Insufficient stock for product ${productId}`);
    }

    return { totalCost, batches: deductedBatches };
  }
}
