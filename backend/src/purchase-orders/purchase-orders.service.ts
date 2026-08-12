import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { POStatus } from '@prisma/client';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
  ) {}

  async findAll() {
    return this.prisma.purchaseOrder.findMany({
      include: { supplier: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { supplier: true, items: true },
    });
  }

  async create(data: any) {
    const poCount = await this.prisma.purchaseOrder.count();
    const poNumber = `PO${new Date().getFullYear()}${(poCount + 1).toString().padStart(4, '0')}`;
    
    return this.prisma.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: data.supplierId,
        status: POStatus.DRAFT,
        notes: data.notes,
        totalAmount: data.items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitCost), 0),
        items: {
          create: data.items.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitCost: item.unitCost,
          })),
        },
      },
      include: { items: true },
    });
  }

  async update(id: string, data: any) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw new BadRequestException('PO not found');
    
    if (po.status !== POStatus.DRAFT && data.items) {
      throw new BadRequestException('Cannot edit items of a non-draft PO');
    }

    if (data.items) {
      await this.prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      const totalAmount = data.items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitCost), 0);
      
      const { items, ...restData } = data;
      return this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          ...restData,
          totalAmount,
          items: {
            create: data.items.map((item: any) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitCost: item.unitCost,
            })),
          },
        },
        include: { items: true },
      });
    }

    return this.prisma.purchaseOrder.update({ where: { id }, data });
  }

  async issue(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po || po.status !== POStatus.DRAFT) throw new BadRequestException('Invalid PO for issue');
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: POStatus.ISSUED },
    });
  }

  async receive(id: string, data: { items: { purchaseOrderItemId: string; receivedQty: number; unitCost: number }[] }) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po || (po.status !== POStatus.ISSUED && po.status !== POStatus.PARTIALLY_RECEIVED)) {
      throw new BadRequestException('Invalid PO for receiving');
    }

    for (const receivedItem of data.items) {
      const poItem = po.items.find(i => i.id === receivedItem.purchaseOrderItemId);
      if (!poItem) continue;

      if (receivedItem.receivedQty > 0) {
        await this.inventoryService.addStockBatch({
          productId: poItem.productId,
          quantity: receivedItem.receivedQty,
          unitCost: receivedItem.unitCost,
          supplierId: po.supplierId,
          note: `Received from PO ${po.poNumber}`,
        });

        await this.prisma.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: {
            receivedQty: poItem.receivedQty + receivedItem.receivedQty,
          }
        });
      }
    }

    const updatedPo = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!updatedPo) throw new BadRequestException('PO not found after receiving');

    const allFullyReceived = updatedPo.items.every(i => i.receivedQty >= i.quantity);

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: allFullyReceived ? POStatus.COMPLETED : POStatus.PARTIALLY_RECEIVED,
      },
    });
  }
}
