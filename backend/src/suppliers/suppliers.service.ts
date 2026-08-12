import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.supplier.findMany({ where: { isActive: true } });
  }

  async findOne(id: string) {
    return this.prisma.supplier.findUnique({ where: { id } });
  }

  async create(data: any) {
    return this.prisma.supplier.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.supplier.update({ where: { id }, data });
  }

  async remove(id: string) {
    return this.prisma.supplier.update({ where: { id }, data: { isActive: false } });
  }

  async getSupplierProducts(supplierId: string) {
    const links = await this.prisma.productSupplier.findMany({
      where: { supplierId },
      include: {
        product: {
          include: {
            stockBatches: { select: { quantityRemaining: true } }
          }
        }
      }
    });
    return links.map(link => ({
      id: link.product.id,
      name: link.product.name,
      sku: link.product.sku,
      basePrice: link.product.basePrice,
      supplierSku: link.supplierSku,
      unitCost: link.unitCost,
      isPreferred: link.isPreferred,
      stock: link.product.stockBatches.reduce((sum, b) => sum + b.quantityRemaining, 0)
    }));
  }

  async linkProduct(supplierId: string, data: { productId: string, supplierSku?: string, unitCost?: number, isPreferred?: boolean }) {
    return this.prisma.productSupplier.create({
      data: {
        supplierId,
        productId: data.productId,
        supplierSku: data.supplierSku,
        unitCost: data.unitCost,
        isPreferred: data.isPreferred,
      }
    });
  }

  async unlinkProduct(supplierId: string, productId: string) {
    return this.prisma.productSupplier.delete({
      where: {
        productId_supplierId: {
          productId,
          supplierId,
        }
      }
    });
  }

  async updateProductLink(supplierId: string, productId: string, data: { supplierSku?: string, unitCost?: number, isPreferred?: boolean }) {
    return this.prisma.productSupplier.update({
      where: {
        productId_supplierId: {
          productId,
          supplierId,
        }
      },
      data
    });
  }
}
