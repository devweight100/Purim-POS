import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { POStatus, PaymentStatus } from '@prisma/client';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
  ) {}

  async findAll(query?: any) {
    const page = query?.page ? parseInt(query.page, 10) : 1;
    const limit = query?.limit ? parseInt(query.limit, 10) : 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status && query.status !== 'ALL') where.status = query.status as POStatus;
    if (query?.supplierId && query.supplierId !== 'ALL') where.supplierId = query.supplierId;
    if (query?.search && query.search.trim()) {
      where.OR = [
        { poNumber: { contains: query.search.trim(), mode: 'insensitive' } },
        { supplierInvoiceNo: { contains: query.search.trim(), mode: 'insensitive' } },
        { supplier: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        include: {
          supplier: true,
          items: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: { include: { product: true } },
        stockBatches: true,
        voucherItems: { include: { voucher: true } },
      },
    });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อนี้');
    return po;
  }

  async create(data: any) {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const poCount = await this.prisma.purchaseOrder.count();
    const poNumber = data.poNumber || `PO${new Date().getFullYear()}${(poCount + 1).toString().padStart(4, '0')}`;

    const totalAmount = (data.items || []).reduce(
      (sum: number, item: any) => sum + (Number(item.quantity) * Number(item.unitCost)),
      0,
    );

    return this.prisma.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: data.supplierId,
        supplierInvoiceNo: data.supplierInvoiceNo || null,
        billDate: data.billDate ? new Date(data.billDate) : new Date(),
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        status: data.status || POStatus.DRAFT,
        paymentStatus: PaymentStatus.UNPAID,
        totalAmount,
        paidAmount: 0,
        remainingPayable: totalAmount,
        notes: data.notes || null,
        items: {
          create: (data.items || []).map((item: any) => ({
            productId: item.productId,
            quantity: Number(item.quantity),
            unitCost: Number(item.unitCost),
            total: Number(item.quantity) * Number(item.unitCost),
          })),
        },
      },
      include: { items: { include: { product: true } }, supplier: true },
    });
  }

  async update(id: string, data: any) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อนี้');

    if (po.status !== POStatus.DRAFT && data.items) {
      throw new BadRequestException('ไม่สามารถแก้ไขรายการของ PO ที่ไม่อยู่ในสถานะ DRAFT');
    }

    if (data.items) {
      await this.prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      const totalAmount = data.items.reduce(
        (sum: number, item: any) => sum + (Number(item.quantity) * Number(item.unitCost)),
        0,
      );

      const { items, ...restData } = data;
      const remainingPayable = Math.max(0, totalAmount - Number(po.paidAmount));

      return this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          ...restData,
          totalAmount,
          remainingPayable,
          items: {
            create: data.items.map((item: any) => ({
              productId: item.productId,
              quantity: Number(item.quantity),
              unitCost: Number(item.unitCost),
              total: Number(item.quantity) * Number(item.unitCost),
            })),
          },
        },
        include: { items: { include: { product: true } }, supplier: true },
      });
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data,
      include: { items: { include: { product: true } }, supplier: true },
    });
  }

  async issue(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po || po.status !== POStatus.DRAFT) throw new BadRequestException('สถานะ PO ไม่ถูกต้องสำหรับการออกเอกสาร');
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: POStatus.ISSUED },
    });
  }

  async receive(id: string, data: { items: { purchaseOrderItemId: string; receivedQty: number; unitCost: number }[] }) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po || (po.status !== POStatus.ISSUED && po.status !== POStatus.PARTIALLY_RECEIVED && po.status !== POStatus.ORDERED)) {
      throw new BadRequestException('สถานะ PO ไม่ถูกต้องสำหรับการรับสินค้า');
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
          note: `รับเข้าจาก PO ${po.poNumber}`,
        });

        await this.prisma.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: {
            receivedQty: poItem.receivedQty + receivedItem.receivedQty,
          },
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
      include: { items: { include: { product: true } }, supplier: true },
    });
  }
}
