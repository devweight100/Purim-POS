import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  private mapProductWithStock(product: any) {
    if (!product) return null;
    const stock = product.stockBatches?.reduce((sum: number, batch: any) => sum + batch.quantityRemaining, 0) || 0;
    return { ...product, computedStock: stock };
  }

  async create(createProductDto: CreateProductDto) {
    const { barcodes, ...data } = createProductDto;
    const product = await this.prisma.product.create({
      data: {
        ...data,
        barcodes: barcodes ? {
          create: barcodes.map(b => ({ barcode: b }))
        } : undefined
      },
      include: { barcodes: true, category: true, stockBatches: true }
    });
    return this.mapProductWithStock(product);
  }

  async findAll(search?: string, categoryId?: string) {
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (categoryId) {
      where.categoryId = categoryId;
    }
    const products = await this.prisma.product.findMany({
      where,
      include: { barcodes: true, category: true, stockBatches: true },
    });
    return products.map(p => this.mapProductWithStock(p));
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { barcodes: true, category: true, stockBatches: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.mapProductWithStock(product);
  }

  async findByBarcode(barcode: string) {
    const pBarcode = await this.prisma.productBarcode.findUnique({
      where: { barcode },
      include: { product: { include: { barcodes: true, category: true, stockBatches: true } } },
    });
    if (!pBarcode) throw new NotFoundException('Product not found for barcode');
    return this.mapProductWithStock(pBarcode.product);
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    const { barcodes, ...data } = updateProductDto;
    
    // Simple update for simplicity. Barcodes might need separate management in real app
    if (barcodes) {
      await this.prisma.productBarcode.deleteMany({ where: { productId: id } });
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        ...(barcodes && { barcodes: { create: barcodes.map(b => ({ barcode: b })) } })
      },
      include: { barcodes: true, category: true, stockBatches: true },
    });
    return this.mapProductWithStock(product);
  }

  async remove(id: string) {
    return this.prisma.product.delete({ where: { id } });
  }

  async getStock(id: string) {
    const product = await this.findOne(id);
    return { productId: id, computedStock: product?.computedStock };
  }

  async getProductSuppliers(productId: string) {
    return this.prisma.productSupplier.findMany({
      where: { productId },
      include: {
        supplier: true
      }
    });
  }
}
