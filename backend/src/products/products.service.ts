import { businessTransaction } from '../prisma/business-transaction';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  private readonly productInclude = {
    barcodes: true,
    packagingUnits: { orderBy: { sortOrder: 'asc' as const } },
    images: { orderBy: { sortOrder: 'asc' as const } },
    wholesalePrices: { orderBy: { sortOrder: 'asc' as const } },
    category: true,
    stockBatches: true,
    suppliers: {
      include: {
        supplier: true,
      },
      orderBy: [{ isPreferred: 'desc' as const }, { createdAt: 'asc' as const }],
    },
    bundleItems: {
      include: {
        childProduct: {
          include: {
            stockBatches: true,
            barcodes: true,
          },
        },
      },
    },
  };

  private mapProductWithStock(product: any) {
    if (!product) return null;
    let stock = 0;
    if (product.isBundle && product.bundleItems && product.bundleItems.length > 0) {
      const possibleSets = product.bundleItems.map((bi: any) => {
        const childStock =
          bi.childProduct?.stockBatches?.reduce(
            (sum: number, batch: any) => sum + batch.quantityRemaining,
            0,
          ) || 0;
        const requiredPerSet = Number(bi.quantity) || 1;
        return Math.floor(childStock / requiredPerSet);
      });
      stock = Math.min(...possibleSets);
    } else {
      const sum = product.stockBatches?.reduce(
        (acc: number, batch: any) => acc + Number(batch.quantityRemaining || 0),
        0,
      );
      stock = typeof sum === 'number' && !isNaN(sum) ? sum : 0;
    }

    const rawSuppliers = Array.isArray(product.suppliers) ? product.suppliers : [];
    const supplierEntries = rawSuppliers.map((ps: any) => {
      const unitCostNum =
        ps.unitCost !== null && ps.unitCost !== undefined && ps.unitCost !== ''
          ? Number(ps.unitCost)
          : Number(product.costPrice || 0);
      return {
        id: ps.id,
        supplierId: ps.supplierId,
        supplierName: ps.supplier?.name || '',
        supplierSku: ps.supplierSku || '',
        unitCost: unitCostNum,
        lastCost: unitCostNum,
        isPreferred: Boolean(ps.isPreferred),
        notes: ps.supplierSku || '',
        supplier: ps.supplier || null,
      };
    });

    const preferredSupplier =
      supplierEntries.find((s: any) => s.isPreferred) || supplierEntries[0] || null;

    return {
      ...product,
      computedStock: stock,
      stock,
      supplierEntries,
      supplierId: product.supplierId || preferredSupplier?.supplierId || null,
    };
  }

  private buildBarcodeCreates(barcodes: any[] = []) {
    const seen = new Set<string>();
    const result: Array<{ barcode: string; label?: string | null }> = [];
    for (const item of barcodes) {
      const rawCode = typeof item === 'string' ? item : item?.barcode;
      const code = rawCode ? String(rawCode).trim() : '';
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const label = typeof item === 'object' && item?.label ? String(item.label).trim() : null;
      result.push({ barcode: code, ...(label ? { label } : {}) });
    }
    return result;
  }

  private buildBundleItemCreates(bundleItems: any[] = []) {
    return bundleItems
      .filter((item) => item?.childProductId && Number(item?.quantity) > 0)
      .map((item) => ({
        childProductId: String(item.childProductId).trim(),
        quantity: Math.max(1, Math.round(Number(item.quantity))),
      }));
  }

  private buildPackagingUnitCreates(units: any[] = []) {
    return units
      .filter((unit) => unit?.name)
      .map((unit, index) => ({
        name: String(unit.name).trim(),
        qtyPerPrev: Number(unit.qtyPerPrev) || 1,
        barcode: unit.barcode ? String(unit.barcode).trim() : null,
        priceLevel1: unit.priceLevel1 !== undefined && unit.priceLevel1 !== null && unit.priceLevel1 !== '' ? Number(unit.priceLevel1) : null,
        priceLevel2: unit.priceLevel2 !== undefined && unit.priceLevel2 !== null && unit.priceLevel2 !== '' ? Number(unit.priceLevel2) : null,
        priceLevel3: unit.priceLevel3 !== undefined && unit.priceLevel3 !== null && unit.priceLevel3 !== '' ? Number(unit.priceLevel3) : null,
        priceLevel4: unit.priceLevel4 !== undefined && unit.priceLevel4 !== null && unit.priceLevel4 !== '' ? Number(unit.priceLevel4) : null,
        priceLevel5: unit.priceLevel5 !== undefined && unit.priceLevel5 !== null && unit.priceLevel5 !== '' ? Number(unit.priceLevel5) : null,
        sortOrder: index,
      }));
  }

  private buildImageCreates(images: any[] = []) {
    return images
      .filter((image) => image?.dataUrl)
      .map((image, index) => ({
        dataUrl: String(image.dataUrl),
        name: image.name ? String(image.name) : null,
        isCover: Boolean(image.isCover),
        sortOrder: index,
      }));
  }

  private buildWholesalePriceCreates(prices: any[] = []) {
    return prices
      .filter((price) => Number(price?.minQuantity) > 0 && Number(price?.unitPrice) > 0)
      .map((price, index) => ({
        minQuantity: Number(price.minQuantity),
        unitPrice: Number(price.unitPrice),
        sortOrder: index,
      }));
  }

  private async syncProductSuppliers(
    tx: any,
    productId: string,
    payload: {
      supplierEntries?: any[];
      suppliers?: any[];
      supplierId?: string | null;
      barcodes?: any[];
      costPrice?: number | null;
    },
  ) {
    const hasExplicitSuppliers =
      payload.supplierEntries !== undefined ||
      payload.suppliers !== undefined ||
      payload.supplierId !== undefined ||
      (Array.isArray(payload.barcodes) &&
        payload.barcodes.some((b: any) => typeof b === 'object' && b?.supplierId));

    if (!hasExplicitSuppliers) return;

    const rawList: any[] = [];
    if (Array.isArray(payload.supplierEntries)) {
      rawList.push(...payload.supplierEntries);
    }
    if (Array.isArray(payload.suppliers)) {
      rawList.push(...payload.suppliers);
    }
    if (payload.supplierId && String(payload.supplierId).trim()) {
      rawList.push({
        supplierId: String(payload.supplierId).trim(),
        unitCost: payload.costPrice,
        isPreferred: true,
      });
    }
    if (Array.isArray(payload.barcodes)) {
      for (const b of payload.barcodes) {
        if (typeof b === 'object' && b?.supplierId && String(b.supplierId).trim()) {
          rawList.push({
            supplierId: String(b.supplierId).trim(),
            supplierSku: b.barcode ? String(b.barcode).trim() : undefined,
            unitCost: payload.costPrice,
          });
        }
      }
    }

    const deduped = new Map<
      string,
      { supplierId: string; supplierSku: string | null; unitCost: number | null; isPreferred: boolean }
    >();

    rawList.forEach((entry, index) => {
      const sid = String(entry?.supplierId || entry?.id || '').trim();
      if (!sid || deduped.has(sid)) return;

      const rawCost =
        entry?.unitCost !== undefined && entry?.unitCost !== null && entry?.unitCost !== ''
          ? Number(entry.unitCost)
          : entry?.lastCost !== undefined && entry?.lastCost !== null && entry?.lastCost !== ''
          ? Number(entry.lastCost)
          : payload.costPrice !== undefined && payload.costPrice !== null
          ? Number(payload.costPrice)
          : null;

      const unitCost = rawCost !== null && Number.isFinite(rawCost) ? rawCost : null;
      const supplierSku =
        entry?.supplierSku !== undefined && entry?.supplierSku !== null && String(entry.supplierSku).trim()
          ? String(entry.supplierSku).trim()
          : entry?.notes !== undefined && entry?.notes !== null && String(entry.notes).trim()
          ? String(entry.notes).trim()
          : null;

      deduped.set(sid, {
        supplierId: sid,
        supplierSku,
        unitCost,
        isPreferred: entry?.isPreferred !== undefined ? Boolean(entry.isPreferred) : index === 0,
      });
    });

    await tx.productSupplier.deleteMany({ where: { productId } });

    const candidateIds = Array.from(deduped.keys());
    if (candidateIds.length === 0) return;

    const existingSuppliers = await tx.supplier.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true },
    });
    const validSupplierIds = new Set(existingSuppliers.map((s: any) => s.id));

    const rowsToCreate = Array.from(deduped.values())
      .filter((item) => validSupplierIds.has(item.supplierId))
      .map((item, idx) => ({
        productId,
        supplierId: item.supplierId,
        supplierSku: item.supplierSku,
        unitCost: item.unitCost,
        isPreferred: item.isPreferred || idx === 0,
      }));

    if (rowsToCreate.length > 0) {
      await tx.productSupplier.createMany({
        data: rowsToCreate,
        skipDuplicates: true,
      });
    }
  }

  async create(createProductDto: CreateProductDto) {
    const {
      barcodes,
      packagingUnits,
      images,
      wholesalePrices,
      bundleItems,
      supplierEntries,
      suppliers,
      supplierId,
      ...data
    } = createProductDto as any;

    const product = await businessTransaction(this.prisma, async (tx) => {
      const created = await tx.product.create({
        data: {
          ...data,
          barcodes: barcodes
            ? {
                create: this.buildBarcodeCreates(barcodes),
              }
            : undefined,
          packagingUnits: packagingUnits
            ? {
                create: this.buildPackagingUnitCreates(packagingUnits),
              }
            : undefined,
          images: images
            ? {
                create: this.buildImageCreates(images),
              }
            : undefined,
          wholesalePrices: wholesalePrices
            ? {
                create: this.buildWholesalePriceCreates(wholesalePrices),
              }
            : undefined,
          bundleItems: bundleItems
            ? {
                create: this.buildBundleItemCreates(bundleItems),
              }
            : undefined,
        },
      });

      await this.syncProductSuppliers(tx, created.id, {
        supplierEntries,
        suppliers,
        supplierId,
        barcodes,
        costPrice: data.costPrice,
      });

      return tx.product.findUnique({
        where: { id: created.id },
        include: this.productInclude,
      });
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
      include: this.productInclude,
    });
    return products.map((p) => this.mapProductWithStock(p));
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: this.productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.mapProductWithStock(product);
  }

  async findByBarcode(barcode: string) {
    const pBarcode = await this.prisma.productBarcode.findUnique({
      where: { barcode },
      include: { product: { include: this.productInclude } },
    });
    if (!pBarcode) throw new NotFoundException('Product not found for barcode');
    return this.mapProductWithStock(pBarcode.product);
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    const {
      barcodes,
      packagingUnits,
      images,
      wholesalePrices,
      bundleItems,
      supplierEntries,
      suppliers,
      supplierId,
      ...data
    } = updateProductDto as any;

    const product = await businessTransaction(this.prisma, async (tx) => {
      if (barcodes) {
        await tx.productBarcode.deleteMany({ where: { productId: id } });
      }
      if (packagingUnits) {
        await tx.productPackagingUnit.deleteMany({ where: { productId: id } });
      }
      if (images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
      }
      if (wholesalePrices) {
        await tx.productWholesalePrice.deleteMany({ where: { productId: id } });
      }
      if (bundleItems) {
        await tx.productBundleItem.deleteMany({ where: { bundleProductId: id } });
      }

      await this.syncProductSuppliers(tx, id, {
        supplierEntries,
        suppliers,
        supplierId,
        barcodes,
        costPrice: data.costPrice,
      });

      return tx.product.update({
        where: { id },
        data: {
          ...data,
          ...(barcodes && { barcodes: { create: this.buildBarcodeCreates(barcodes) } }),
          ...(packagingUnits && { packagingUnits: { create: this.buildPackagingUnitCreates(packagingUnits) } }),
          ...(images && { images: { create: this.buildImageCreates(images) } }),
          ...(wholesalePrices && { wholesalePrices: { create: this.buildWholesalePriceCreates(wholesalePrices) } }),
          ...(bundleItems && {
            bundleItems: {
              create: this.buildBundleItemCreates(bundleItems),
            },
          }),
        },
        include: this.productInclude,
      });
    });
    return this.mapProductWithStock(product);
  }

  async remove(id: string) {
    return this.prisma.product.delete({ where: { id } });
  }

  async removeAll() {
    return businessTransaction(this.prisma, async (tx) => {
      const result = await tx.product.deleteMany({});
      return { deleted: result.count };
    });
  }

  async getStock(id: string) {
    const product = await this.findOne(id);
    return { productId: id, computedStock: product?.computedStock };
  }

  async getProductSuppliers(productId: string) {
    return this.prisma.productSupplier.findMany({
      where: { productId },
      include: {
        supplier: true,
      },
      orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async bulkUpsert(items: any[]) {
    let created = 0;
    let updated = 0;

    for (const item of items) {
      const sku = item.sku ? String(item.sku).trim() : null;
      const name = item.name ? String(item.name).trim() : 'สินค้าไม่มีชื่อ';
      if (!sku && !item.id && !item.barcode) continue;

      let existing: any = null;
      if (item.id) {
        existing = await this.prisma.product.findUnique({ where: { id: item.id } });
      }
      if (!existing && sku) {
        existing = await this.prisma.product.findUnique({ where: { sku } });
      }
      if (!existing && item.barcode) {
        const pbc = await this.prisma.productBarcode.findUnique({
          where: { barcode: String(item.barcode).trim() },
          include: { product: true },
        });
        if (pbc?.product) existing = pbc.product;
      }

      // Handle category lookup/creation if category name string provided
      let categoryId = item.categoryId || null;
      if (item.categoryName && !categoryId) {
        const catName = String(item.categoryName).trim();
        let cat = await this.prisma.category.findUnique({ where: { name: catName } });
        if (!cat) {
          cat = await this.prisma.category.create({ data: { name: catName } });
        }
        categoryId = cat.id;
      }

      const costPrice = item.costPrice !== undefined ? Number(item.costPrice) : item.cost !== undefined ? Number(item.cost) : 0;
      const priceLevel1 = item.priceLevel1 !== undefined && item.priceLevel1 !== null && item.priceLevel1 !== ''
        ? Number(item.priceLevel1)
        : item.retailPrice !== undefined ? Number(item.retailPrice) : null;
      const basePrice = priceLevel1 !== null ? priceLevel1 : (item.retailPrice !== undefined ? Number(item.retailPrice) : (item.basePrice !== undefined ? Number(item.basePrice) : 0));
      const priceLevel2 = item.priceLevel2 !== undefined && item.priceLevel2 !== null && item.priceLevel2 !== '' ? Number(item.priceLevel2) : null;
      const priceLevel3 = item.priceLevel3 !== undefined && item.priceLevel3 !== null && item.priceLevel3 !== '' ? Number(item.priceLevel3) : null;
      const priceLevel4 = item.priceLevel4 !== undefined && item.priceLevel4 !== null && item.priceLevel4 !== '' ? Number(item.priceLevel4) : null;
      const priceLevel5 = item.priceLevel5 !== undefined && item.priceLevel5 !== null && item.priceLevel5 !== '' ? Number(item.priceLevel5) : null;
      const unit = item.unit ? String(item.unit).trim() : 'ชิ้น';
      const description = item.description ? String(item.description).trim() : null;

      if (existing) {
        // Update product
        await this.prisma.product.update({
          where: { id: existing.id },
          data: {
            name: name || existing.name,
            sku: sku || existing.sku,
            basePrice,
            costPrice,
            priceLevel1,
            priceLevel2,
            priceLevel3,
            priceLevel4,
            priceLevel5,
            unit,
            description,
            ...(categoryId && { categoryId }),
          },
        });

        await this.syncProductSuppliers(this.prisma, existing.id, {
          supplierEntries: item.supplierEntries,
          suppliers: item.suppliers,
          supplierId: item.supplierId,
          costPrice,
        });

        // Handle barcode upsert if provided
        if (item.barcode) {
          const bcode = String(item.barcode).trim();
          try {
            await this.prisma.productBarcode.upsert({
              where: { barcode: bcode },
              update: { productId: existing.id },
              create: { productId: existing.id, barcode: bcode },
            });
          } catch {}
        }

        // Handle stock update via StockBatch if stock number provided
        if (item.stock !== undefined && item.stock !== null && item.stock !== '') {
          const targetStock = Number(item.stock) || 0;
          const currentBatches = await this.prisma.stockBatch.findMany({ where: { productId: existing.id } });
          const currentTotal = currentBatches.reduce((s, b) => s + b.quantityRemaining, 0);
          const diff = targetStock - currentTotal;
          if (diff !== 0) {
            if (currentBatches.length > 0) {
              const primary = currentBatches[0];
              await this.prisma.stockBatch.update({
                where: { id: primary.id },
                data: {
                  quantityRemaining: Math.max(0, primary.quantityRemaining + diff),
                  quantityReceived: Math.max(primary.quantityReceived, primary.quantityRemaining + diff),
                },
              });
            } else if (targetStock > 0) {
              await this.prisma.stockBatch.create({
                data: {
                  productId: existing.id,
                  quantityReceived: targetStock,
                  quantityRemaining: targetStock,
                  unitCost: costPrice,
                  note: 'EXCEL-INIT',
                },
              });
            }
          }
        }

        updated++;
      } else {
        // Create new product
        const finalSku = sku || `SKU-${Date.now().toString().slice(-6)}`;
        const newProd = await this.prisma.product.create({
          data: {
            name,
            sku: finalSku,
            basePrice,
            costPrice,
            priceLevel1,
            priceLevel2,
            priceLevel3,
            priceLevel4,
            priceLevel5,
            unit,
            description,
            categoryId,
          },
        });

        await this.syncProductSuppliers(this.prisma, newProd.id, {
          supplierEntries: item.supplierEntries,
          suppliers: item.suppliers,
          supplierId: item.supplierId,
          costPrice,
        });

        // Add barcode if provided
        if (item.barcode) {
          const bcode = String(item.barcode).trim();
          try {
            await this.prisma.productBarcode.create({
              data: { productId: newProd.id, barcode: bcode },
            });
          } catch {}
        }

        // Add initial stock batch if stock provided
        const initStock = Number(item.stock) || 0;
        if (initStock > 0) {
          await this.prisma.stockBatch.create({
            data: {
              productId: newProd.id,
              quantityReceived: initStock,
              quantityRemaining: initStock,
              unitCost: costPrice,
              note: 'EXCEL-INIT',
            },
          });
        }

        created++;
      }
    }

    return { success: true, created, updated, total: created + updated };
  }
}
