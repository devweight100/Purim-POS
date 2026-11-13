import { businessTransaction } from '../prisma/business-transaction';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { rethrowPrismaError } from './prisma-errors';
import { LOOKUP_FILTERS, type LookupFilter, packChain, priceLevels, rankCandidates, searchTokens, stockLevel } from './product-lookup';
import { addQty, assertQtyAllowed, decimalQtyAllowed, hasMax2Decimals, qn, roundQty } from '../common/qty';

/** Highest price / cost accepted for a product (columns are Decimal(10,2)). */
export const MAX_PRODUCT_PRICE = 10_000_000;
/** Highest stock quantity accepted from an import (stock columns are DECIMAL(12,2)). */
export const MAX_IMPORT_STOCK = 10_000_000;
const MAX_QTY_PER_PREV = 100_000;

const PRICE_LABELS: Record<string, string> = {
  basePrice: 'ราคาขาย',
  costPrice: 'ราคาทุน',
  priceLevel1: 'ราคาระดับ 1',
  priceLevel2: 'ราคาระดับ 2',
  priceLevel3: 'ราคาระดับ 3',
  priceLevel4: 'ราคาระดับ 4',
  priceLevel5: 'ราคาระดับ 5',
};

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Money value 0..MAX_PRODUCT_PRICE or a Thai 400. */
export function parsePrice(value: unknown, label: string): number {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRODUCT_PRICE) {
    throw new BadRequestException(`${label}ต้องเป็นตัวเลขตั้งแต่ 0 ถึง ${MAX_PRODUCT_PRICE.toLocaleString('en-US')}`);
  }
  return Math.round(n * 100) / 100;
}

/** Packaging "qty per previous unit": integer >= 1 (0, negative or decimal would break sale conversion). */
export function parseQtyPerPrev(value: unknown, unitName: string): number {
  if (isBlank(value)) return 1;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_QTY_PER_PREV) {
    throw new BadRequestException(`จำนวนต่อหน่วยของหน่วยบรรจุ "${unitName}" ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`);
  }
  return n;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService, private inventoryService: InventoryService) {}

  /** Trim / validate the scalar product fields in place. `partial` = PATCH (absent fields stay absent). */
  private normalizeProductInput(data: any, partial: boolean) {
    if (!partial || data.name !== undefined) {
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name) throw new BadRequestException('กรุณาระบุชื่อสินค้า');
      data.name = name;
    }
    if (!partial || data.sku !== undefined) {
      const sku = typeof data.sku === 'string' ? data.sku.trim() : '';
      if (!sku) throw new BadRequestException('กรุณาระบุรหัสสินค้า (SKU)');
      if (sku.length > 64) throw new BadRequestException('รหัสสินค้า (SKU) ยาวเกิน 64 ตัวอักษร');
      data.sku = sku;
    }
    for (const key of Object.keys(PRICE_LABELS)) {
      if (data[key] === undefined) continue;
      if (data[key] === null && key.startsWith('priceLevel')) continue;
      if (data[key] === null && key === 'costPrice') { data[key] = 0; continue; }
      data[key] = parsePrice(data[key], PRICE_LABELS[key]);
    }
    if (data.categoryId === '') data.categoryId = null;
    if (typeof data.categoryId === 'string') data.categoryId = data.categoryId.trim() || null;
  }

  /** SKU and barcodes must be unique across products, and a SKU may not equal another product's barcode (scans would be ambiguous). */
  private async assertIdentifiersFree(tx: any, productId: string | null, sku: string | undefined, barcodes: string[] | undefined) {
    if (sku) {
      const other = await tx.product.findUnique({ where: { sku }, select: { id: true, name: true } });
      if (other && other.id !== productId) throw new ConflictException(`รหัสสินค้า (SKU) "${sku}" ซ้ำกับสินค้า "${other.name}"`);
      const bc = await tx.productBarcode.findUnique({ where: { barcode: sku }, include: { product: { select: { id: true, name: true } } } });
      if (bc && bc.productId !== productId) throw new ConflictException(`รหัสสินค้า (SKU) "${sku}" ซ้ำกับบาร์โค้ดของสินค้า "${bc.product?.name || ''}"`);
    }
    for (const code of barcodes || []) {
      const bc = await tx.productBarcode.findUnique({ where: { barcode: code }, include: { product: { select: { id: true, name: true } } } });
      if (bc && bc.productId !== productId) throw new ConflictException(`บาร์โค้ด "${code}" ถูกใช้แล้วกับสินค้า "${bc.product?.name || ''}"`);
      const bySku = await tx.product.findUnique({ where: { sku: code }, select: { id: true, name: true } });
      if (bySku && bySku.id !== productId) throw new ConflictException(`บาร์โค้ด "${code}" ซ้ำกับรหัสสินค้า (SKU) ของสินค้า "${bySku.name}"`);
    }
  }

  /** A barcode must not already be a pack-unit barcode of ANOTHER product (scans would be ambiguous). */
  private async assertPackBarcodeFree(tx: any, productId: string, code: string) {
    const other = await tx.productPackagingUnit.findFirst({
      where: { barcode: code, productId: { not: productId } },
      include: { product: { select: { name: true } } },
    });
    if (other) throw new ConflictException(`บาร์โค้ด "${code}" ถูกใช้แล้วกับหน่วย "${other.name}" ของสินค้า "${other.product?.name || ''}"`);
  }

  private async assertCategory(tx: any, categoryId: string | null | undefined) {
    if (!categoryId) return;
    const cat = await tx.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!cat) throw new BadRequestException('ไม่พบหมวดหมู่สินค้าที่เลือก');
  }

  private async assertBundleChildren(tx: any, productId: string | null, items: any[] | undefined) {
    if (!Array.isArray(items) || items.length === 0) return;
    const ids: string[] = [];
    const allowDecimal = await decimalQtyAllowed(tx);
    for (const item of items) {
      const id = item?.childProductId ? String(item.childProductId).trim() : '';
      const qty = Number(item?.quantity);
      if (!id) throw new BadRequestException('กรุณาเลือกสินค้าในชุดสินค้า (bundle)');
      if (!Number.isFinite(qty) || !hasMax2Decimals(qty) || qty <= 0 || qty > 100000) throw new BadRequestException('จำนวนสินค้าในชุดต้องมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
      if (!Number.isSafeInteger(qty)) assertQtyAllowed(qty, allowDecimal);
      if (productId && id === productId) throw new BadRequestException('ชุดสินค้าไม่สามารถมีตัวเองเป็นส่วนประกอบได้');
      ids.push(id);
    }
    const found = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const ok = new Set(found.map((p: any) => p.id));
    const missing = ids.filter((id) => !ok.has(id));
    if (missing.length) throw new BadRequestException(`ไม่พบสินค้าในชุดสินค้า (bundle): ${missing.join(', ')}`);
  }

  private barcodeCodes(barcodes: any[] | undefined): string[] | undefined {
    if (!Array.isArray(barcodes)) return undefined;
    return this.buildBarcodeCreates(barcodes).map((b) => b.barcode);
  }

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
          addQty(...(bi.childProduct?.stockBatches || []).map((batch: any) => batch.quantityRemaining)) || 0;
        const requiredPerSet = qn(bi.quantity) || 1;
        return Math.floor(childStock / requiredPerSet + 1e-9);
      });
      stock = Math.min(...possibleSets);
    } else {
      const sum = addQty(...(product.stockBatches || []).map((batch: any) => batch.quantityRemaining));
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
        quantity: Math.max(0.01, roundQty(item.quantity)),
      }));
  }

  private buildPackagingUnitCreates(units: any[] = []) {
    const level = (unit: any, key: string, name: string) =>
      isBlank(unit[key]) ? null : parsePrice(unit[key], `${PRICE_LABELS[key]}ของหน่วย "${name}" `);
    return units
      .filter((unit) => unit?.name && String(unit.name).trim())
      .map((unit, index) => {
        const name = String(unit.name).trim();
        return {
          name,
          qtyPerPrev: parseQtyPerPrev(unit.qtyPerPrev, name),
          barcode: unit.barcode ? String(unit.barcode).trim() : null,
          priceLevel1: level(unit, 'priceLevel1', name),
          priceLevel2: level(unit, 'priceLevel2', name),
          priceLevel3: level(unit, 'priceLevel3', name),
          priceLevel4: level(unit, 'priceLevel4', name),
          priceLevel5: level(unit, 'priceLevel5', name),
          sortOrder: index,
        };
      });
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
        minQuantity: roundQty(price.minQuantity),
        unitPrice: parsePrice(price.unitPrice, 'ราคาขายส่ง'),
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
    /** caller cannot see costs: keep the stored supplier costs instead of what was sent */
    preserveCosts = false,
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

      const unitCost = rawCost !== null && Number.isFinite(rawCost) ? parsePrice(rawCost, 'ต้นทุนจากผู้จำหน่าย') : null;
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

    if (preserveCosts) {
      const prev = await tx.productSupplier.findMany({ where: { productId }, select: { supplierId: true, unitCost: true } });
      const prevCost = new Map<string, number | null>(prev.map((p: any) => [p.supplierId, p.unitCost === null ? null : Number(p.unitCost)]));
      const prod = await tx.product.findUnique({ where: { id: productId }, select: { costPrice: true } });
      for (const item of deduped.values()) {
        item.unitCost = prevCost.has(item.supplierId) ? prevCost.get(item.supplierId)! : prod ? Number(prod.costPrice) : null;
      }
    }

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
    this.normalizeProductInput(data, false);

    const product = await businessTransaction(this.prisma, async (tx) => {
      await this.assertIdentifiersFree(tx, null, data.sku, this.barcodeCodes(barcodes));
      await this.assertCategory(tx, data.categoryId);
      await this.assertBundleChildren(tx, null, bundleItems);
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
    }).catch((err) => rethrowPrismaError(err, { conflict: 'รหัสสินค้าหรือบาร์โค้ดซ้ำกับสินค้าที่มีอยู่แล้ว', badRef: 'หมวดหมู่หรือสินค้าที่อ้างอิงไม่ถูกต้อง' }));

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

  /**
   * Read-only lookup for the mobile summary page (GET /products/lookup): active products matching
   * every word of `q` in name / SKU / barcode / pack barcode, with stock in the base unit, packaging
   * units (size in base units + price levels) and price levels. `filter` low / out uses the store's
   * lowStockThreshold (bundles have no stock of their own and are left out of those two filters).
   * Cost is included here; the controller strips it for users without VIEW_COST.
   */
  async lookup(opts: { q?: string; filter?: string; page?: number; limit?: number }) {
    const filter = (LOOKUP_FILTERS as readonly string[]).includes(opts.filter || 'all') ? ((opts.filter || 'all') as LookupFilter) : null;
    if (!filter) throw new BadRequestException('ตัวกรองไม่ถูกต้อง (all, low, out)');
    const page = Math.max(1, Math.floor(opts.page || 1));
    const limit = Math.min(50, Math.max(1, Math.floor(opts.limit || 20)));
    const tokens = searchTokens(opts.q);
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      AND: tokens.map((t) => ({
        OR: [
          { name: { contains: t, mode: 'insensitive' } },
          { sku: { contains: t, mode: 'insensitive' } },
          { barcodes: { some: { barcode: { contains: t } } } },
          { packagingUnits: { some: { barcode: { contains: t } } } },
        ],
      })),
    };
    const [settings, rows, sums] = await Promise.all([
      this.prisma.storeSettings.findFirst({ select: { lowStockThreshold: true } }),
      this.prisma.product.findMany({
        where,
        select: {
          id: true, name: true, sku: true, isBundle: true,
          barcodes: { select: { barcode: true } },
          bundleItems: { select: { childProductId: true, quantity: true } },
        },
      }),
      this.prisma.stockBatch.groupBy({ by: ['productId'], _sum: { quantityRemaining: true } }),
    ]);
    const thresholdRaw = Number(settings?.lowStockThreshold);
    const threshold = Number.isFinite(thresholdRaw) && thresholdRaw >= 0 ? thresholdRaw : 5;
    const stockOf = new Map(sums.map((s) => [s.productId, roundQty(Number(s._sum.quantityRemaining || 0))]));
    const stockFor = (r: (typeof rows)[number]): number => {
      if (!r.isBundle || r.bundleItems.length === 0) return stockOf.get(r.id) || 0;
      return Math.max(0, Math.min(...r.bundleItems.map((bi) => Math.floor((stockOf.get(bi.childProductId) || 0) / (qn(bi.quantity) || 1) + 1e-9))));
    };
    const candidates = rows.map((r) => ({ ...r, barcodes: r.barcodes.map((b) => b.barcode), stock: stockFor(r) }));
    const counts = { all: candidates.length, low: 0, out: 0 };
    for (const c of candidates) {
      if (c.isBundle) continue;
      const lv = stockLevel(c.stock, threshold);
      if (lv === 'low') counts.low++;
      else if (lv === 'out') counts.out++;
    }
    const filtered = filter === 'all' ? candidates : candidates.filter((c) => !c.isBundle && stockLevel(c.stock, threshold) === filter);
    const ranked = rankCandidates(filtered, opts.q || '');
    const pageRows = ranked.slice((page - 1) * limit, page * limit);
    const details = await this.prisma.product.findMany({
      where: { id: { in: pageRows.map((r) => r.id) } },
      select: {
        id: true, name: true, sku: true, unit: true, isBundle: true, basePrice: true, costPrice: true,
        priceLevel1: true, priceLevel2: true, priceLevel3: true, priceLevel4: true, priceLevel5: true,
        category: { select: { name: true } },
        packagingUnits: { orderBy: { sortOrder: 'asc' } },
        wholesalePrices: { orderBy: { sortOrder: 'asc' }, select: { minQuantity: true, unitPrice: true } },
      },
    });
    const byId = new Map(details.map((d) => [d.id, d]));
    const data = pageRows.flatMap((r) => {
      const d = byId.get(r.id);
      if (!d) return [];
      return [{
        id: d.id,
        name: d.name,
        sku: d.sku,
        unit: d.unit || 'ชิ้น',
        category: d.category?.name || null,
        isBundle: d.isBundle,
        barcodes: r.barcodes,
        stock: r.stock,
        stockLevel: d.isBundle ? null : stockLevel(r.stock, threshold),
        prices: priceLevels(d as unknown as Record<string, unknown>, d.basePrice),
        packs: packChain(d.packagingUnits as unknown as { name: string; qtyPerPrev: number; barcode: string | null }[]),
        wholesalePrices: d.wholesalePrices.map((w) => ({ minQuantity: Number(w.minQuantity), unitPrice: Number(w.unitPrice) })),
        costPrice: Number(d.costPrice || 0),
      }];
    });
    return { data, meta: { total: filtered.length, page, limit, totalPages: Math.ceil(filtered.length / limit), lowStockThreshold: threshold, counts } };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: this.productInclude,
    });
    if (!product) throw new NotFoundException('ไม่พบสินค้านี้');
    return this.mapProductWithStock(product);
  }

  async findByBarcode(barcode: string) {
    const pBarcode = await this.prisma.productBarcode.findUnique({
      where: { barcode },
      include: { product: { include: this.productInclude } },
    });
    if (pBarcode) return this.mapProductWithStock(pBarcode.product);
    // a scanned label may carry the product code (SKU) instead of a registered barcode
    const bySku = await this.prisma.product.findUnique({ where: { sku: barcode }, include: this.productInclude });
    if (!bySku) throw new NotFoundException('ไม่พบสินค้าสำหรับบาร์โค้ดนี้');
    return this.mapProductWithStock(bySku);
  }

  /** `opts.canViewCost=false`: the caller never saw the costs, so cost fields it sends are ignored. */
  async update(id: string, updateProductDto: UpdateProductDto, opts: { canViewCost?: boolean } = {}) {
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
    const preserveCosts = opts.canViewCost === false;
    if (preserveCosts) delete data.costPrice;
    this.normalizeProductInput(data, true);

    const product = await businessTransaction(this.prisma, async (tx) => {
      const current = await tx.product.findUnique({ where: { id }, select: { id: true } });
      if (!current) throw new NotFoundException('ไม่พบสินค้านี้');
      await this.assertIdentifiersFree(tx, id, data.sku, this.barcodeCodes(barcodes));
      await this.assertCategory(tx, data.categoryId);
      await this.assertBundleChildren(tx, id, bundleItems);

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
      }, preserveCosts);

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
    }).catch((err) => rethrowPrismaError(err, { conflict: 'รหัสสินค้าหรือบาร์โค้ดซ้ำกับสินค้าที่มีอยู่แล้ว', notFound: 'ไม่พบสินค้านี้', badRef: 'หมวดหมู่หรือสินค้าที่อ้างอิงไม่ถูกต้อง' }));
    return this.mapProductWithStock(product);
  }

  /** Products with sales, stock, purchase or claim history cannot be deleted (409): deactivate them instead. */
  async remove(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!product) throw new NotFoundException('ไม่พบสินค้านี้');
    const inUse = `สินค้า "${product.name}" มีประวัติการขาย สต็อก หรือการสั่งซื้อแล้ว จึงลบไม่ได้ กรุณาปิดการใช้งานสินค้า (ตั้งเป็น "ไม่ใช้งาน") แทน`;
    const [batches, orderItems, poItems, claims, claimInv, bundles] = await Promise.all([
      this.prisma.stockBatch.count({ where: { productId: id } }),
      this.prisma.orderItem.count({ where: { productId: id } }),
      this.prisma.purchaseOrderItem.count({ where: { productId: id } }),
      this.prisma.customerClaim.count({ where: { productId: id } }),
      this.prisma.claimInventory.count({ where: { productId: id } }),
      this.prisma.productBundleItem.count({ where: { childProductId: id } }),
    ]);
    if (batches + orderItems + poItems + claims + claimInv > 0) throw new ConflictException(inUse);
    if (bundles > 0) throw new ConflictException(`สินค้า "${product.name}" เป็นส่วนประกอบของชุดสินค้าอื่น กรุณานำออกจากชุดสินค้าก่อน หรือปิดการใช้งานแทน`);
    try {
      return await this.prisma.product.delete({ where: { id } });
    } catch (err: any) {
      if (err?.code === 'P2003') throw new ConflictException(inUse);
      rethrowPrismaError(err, { notFound: 'ไม่พบสินค้านี้' });
    }
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

  /**
   * Validate one import row (no DB access). Only the fields present in the row end up in `fields`,
   * so an update never wipes prices / unit / description that the file did not contain.
   */
  private normalizeImportRow(item: any, rowNo: number) {
    const rowErr = (msg: string) => new BadRequestException(`แถวที่ ${rowNo}: ${msg}`);
    if (!item || typeof item !== 'object') throw rowErr('ข้อมูลไม่ถูกต้อง');
    const str = (v: unknown) => (isBlank(v) ? undefined : String(v).trim());
    const price = (v: unknown, key: string) => {
      try {
        return parsePrice(v, PRICE_LABELS[key]);
      } catch (e: any) {
        throw rowErr(e?.message || 'ราคาไม่ถูกต้อง');
      }
    };

    const id = str(item.id);
    const sku = str(item.sku);
    const barcode = str(item.barcode);
    if (sku && sku.length > 64) throw rowErr('รหัสสินค้า (SKU) ยาวเกิน 64 ตัวอักษร');

    const fields: Record<string, any> = {};
    const name = str(item.name);
    if (name) fields.name = name;

    const level1 = !isBlank(item.priceLevel1) ? price(item.priceLevel1, 'priceLevel1') : undefined;
    const retail = !isBlank(item.retailPrice) ? price(item.retailPrice, 'basePrice') : undefined;
    const base = !isBlank(item.basePrice) ? price(item.basePrice, 'basePrice') : !isBlank(item.price) ? price(item.price, 'basePrice') : undefined;
    const sell = level1 ?? retail ?? base;
    if (sell !== undefined) fields.basePrice = sell;
    if (level1 !== undefined || retail !== undefined) fields.priceLevel1 = level1 ?? retail;

    const costRaw = !isBlank(item.costPrice) ? item.costPrice : item.cost;
    if (!isBlank(costRaw)) fields.costPrice = price(costRaw, 'costPrice');
    for (const key of ['priceLevel2', 'priceLevel3', 'priceLevel4', 'priceLevel5']) {
      if (!isBlank(item[key])) fields[key] = price(item[key], key);
    }
    const unit = str(item.unit);
    if (unit) fields.unit = unit;
    const description = str(item.description);
    if (description) fields.description = description;

    let stock: number | undefined;
    if (!isBlank(item.stock)) {
      const n = typeof item.stock === 'string' ? Number(item.stock.replace(/,/g, '').trim()) : Number(item.stock);
      // up to 2 decimals; whether decimals are allowed at all is checked against the store setting on save
      if (!Number.isFinite(n) || !hasMax2Decimals(n) || n < 0 || n > MAX_IMPORT_STOCK) throw rowErr('จำนวนสต็อกต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
      stock = roundQty(n);
    }

    // Pack units from the import file (larger units of this product, smallest first). Present ->
    // they REPLACE the product's pack units; absent -> the product's pack units are left as they are.
    let packagingUnits: ReturnType<ProductsService['buildPackagingUnitCreates']> | undefined;
    if (item.packagingUnits !== undefined && item.packagingUnits !== null) {
      if (!Array.isArray(item.packagingUnits)) throw rowErr('หน่วยบรรจุไม่ถูกต้อง');
      if (item.packagingUnits.length > 10) throw rowErr('หน่วยบรรจุได้ไม่เกิน 10 หน่วยต่อสินค้า');
      try {
        packagingUnits = this.buildPackagingUnitCreates(item.packagingUnits);
      } catch (e: any) {
        throw rowErr(e?.message || 'หน่วยบรรจุไม่ถูกต้อง');
      }
      const names = new Set<string>([String(fields.unit || item.unit || '').trim().toLowerCase()]);
      for (const u of packagingUnits) {
        if (u.qtyPerPrev < 2) throw rowErr(`หน่วย "${u.name}" ต้องบรรจุตั้งแต่ 2 หน่วยก่อนหน้าขึ้นไป`);
        const key = u.name.toLowerCase();
        if (names.has(key)) throw rowErr(`ชื่อหน่วย "${u.name}" ซ้ำกันในสินค้าเดียวกัน`);
        names.add(key);
      }
    }
    const extraBarcodes = Array.isArray(item.barcodes)
      ? Array.from(new Set(item.barcodes.map((b: unknown) => str(b)).filter((b: string | undefined): b is string => !!b && b !== barcode)))
      : [];
    const allCodes = [barcode, ...extraBarcodes, ...(packagingUnits || []).map((u) => u.barcode)].filter(Boolean) as string[];
    const dup = allCodes.find((c, i) => allCodes.indexOf(c) !== i);
    if (dup) throw rowErr(`บาร์โค้ด "${dup}" ซ้ำกันในสินค้าเดียวกัน`);

    return {
      rowNo,
      id,
      sku,
      barcode,
      extraBarcodes: extraBarcodes as string[],
      packagingUnits,
      fields,
      stock,
      categoryId: str(item.categoryId),
      categoryName: str(item.categoryName),
      supplierEntries: item.supplierEntries,
      suppliers: item.suppliers,
      supplierId: item.supplierId,
    };
  }

  /** A SKU for an imported row without one; unique against product SKUs and barcodes. */
  private async generateSku(tx: any, seq: { n: number; base: string }) {
    for (;;) {
      seq.n += 1;
      const candidate = `${seq.base}-${String(seq.n).padStart(4, '0')}`;
      const [p, bc] = await Promise.all([
        tx.product.findUnique({ where: { sku: candidate }, select: { id: true } }),
        tx.productBarcode.findUnique({ where: { barcode: candidate }, select: { id: true } }),
      ]);
      if (!p && !bc) return candidate;
    }
  }

  /**
   * CSV / Excel import. All rows are validated first, then written in ONE transaction: any bad row
   * rejects the whole file (400/409 naming the row) and nothing is saved. Stock targets go through
   * the audited inventory SET path (same batches / movement log as /inventory/adjust).
   */
  async bulkUpsert(items: any[], user?: { id?: string; fullName?: string; username?: string }) {
    if (!Array.isArray(items)) throw new BadRequestException('รูปแบบข้อมูลนำเข้าไม่ถูกต้อง');
    if (items.length > 20000) throw new BadRequestException('นำเข้าได้ครั้งละไม่เกิน 20,000 แถว');
    // rowNo: spreadsheet row sent by the client (for error messages), else the position in this request
    const rows = items.map((item, idx) =>
      this.normalizeImportRow(item, Number.isSafeInteger(item?.rowNo) && item.rowNo > 0 ? item.rowNo : idx + 1),
    );
    const userName = user?.fullName || user?.username;

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const seq = { n: 0, base: `AUTO-${Date.now().toString(36).toUpperCase()}` };

    await this.prisma
      .$transaction(
        async (tx) => {
          // same lock as businessTransaction: sales / adjustments wait while the import runs
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 1)`;
          for (const row of rows) {
            const rowErr = (e: any) => {
              if (e?.response && typeof e.getStatus === 'function') {
                const msg = e.response?.message ?? e.message;
                const text = Array.isArray(msg) ? msg.join(', ') : String(msg);
                if (text.startsWith('แถวที่')) return e;
                const Ctor = e.constructor;
                return new Ctor(`แถวที่ ${row.rowNo}: ${text}`);
              }
              return e;
            };
            try {
              if (!row.sku && !row.id && !row.barcode) {
                skipped++;
                continue;
              }

              let existing: any = null;
              if (row.id) existing = await tx.product.findUnique({ where: { id: row.id } });
              if (!existing && row.sku) existing = await tx.product.findUnique({ where: { sku: row.sku } });
              let barcodeOwner: string | null = null;
              if (row.barcode) {
                const pbc = await tx.productBarcode.findUnique({ where: { barcode: row.barcode }, include: { product: true } });
                if (pbc?.product) {
                  barcodeOwner = pbc.productId;
                  if (!existing) existing = pbc.product;
                  else if (pbc.productId !== existing.id) {
                    throw new ConflictException(`บาร์โค้ด "${row.barcode}" ถูกใช้แล้วกับสินค้า "${pbc.product.name}"`);
                  }
                }
              }

              let categoryId: string | undefined;
              if (row.categoryId) {
                await this.assertCategory(tx, row.categoryId);
                categoryId = row.categoryId;
              } else if (row.categoryName) {
                let cat = await tx.category.findUnique({ where: { name: row.categoryName } });
                if (!cat) cat = await tx.category.create({ data: { name: row.categoryName } });
                categoryId = cat.id;
              }

              const data: Record<string, any> = { ...row.fields, ...(categoryId ? { categoryId } : {}) };
              let productId: string;

              if (existing) {
                productId = existing.id;
                if (row.sku && row.sku !== existing.sku) data.sku = row.sku;
                await this.assertIdentifiersFree(tx, productId, data.sku, row.barcode && barcodeOwner !== productId ? [row.barcode] : undefined);
                if (Object.keys(data).length > 0) await tx.product.update({ where: { id: productId }, data });
                updated++;
              } else {
                const sku = row.sku || (await this.generateSku(tx, seq));
                await this.assertIdentifiersFree(tx, null, sku, row.barcode ? [row.barcode] : undefined);
                const newProd = await tx.product.create({
                  data: {
                    name: 'สินค้าไม่มีชื่อ',
                    basePrice: 0,
                    costPrice: 0,
                    unit: 'ชิ้น',
                    ...data,
                    sku,
                  } as any,
                });
                productId = newProd.id;
                created++;
              }

              await this.syncProductSuppliers(tx, productId, {
                supplierEntries: row.supplierEntries,
                suppliers: row.suppliers,
                supplierId: row.supplierId,
                costPrice: row.fields.costPrice,
              });

              if (row.barcode && barcodeOwner !== productId) {
                await this.assertPackBarcodeFree(tx, productId, row.barcode);
                await tx.productBarcode.create({ data: { productId, barcode: row.barcode } });
              }
              for (const code of row.extraBarcodes) {
                await this.assertIdentifiersFree(tx, productId, undefined, [code]);
                await this.assertPackBarcodeFree(tx, productId, code);
                const own = await tx.productBarcode.findUnique({ where: { barcode: code }, select: { productId: true } });
                if (!own) await tx.productBarcode.create({ data: { productId, barcode: code } });
              }
              if (row.packagingUnits) {
                for (const u of row.packagingUnits) {
                  if (!u.barcode) continue;
                  await this.assertIdentifiersFree(tx, productId, undefined, [u.barcode]);
                  await this.assertPackBarcodeFree(tx, productId, u.barcode);
                  const own = await tx.productBarcode.findUnique({ where: { barcode: u.barcode }, select: { productId: true } });
                  if (own) throw new ConflictException(`บาร์โค้ด "${u.barcode}" ของหน่วย "${u.name}" ซ้ำกับบาร์โค้ดหน่วยหลักของสินค้านี้`);
                }
                await tx.productPackagingUnit.deleteMany({ where: { productId } });
                if (row.packagingUnits.length > 0) {
                  await tx.productPackagingUnit.createMany({ data: row.packagingUnits.map((u) => ({ ...u, productId })) });
                }
              }

              if (row.stock !== undefined && (existing || row.stock > 0)) {
                await this.inventoryService.adjustStock(
                  {
                    productId,
                    type: 'SET',
                    amount: row.stock,
                    ...(row.fields.costPrice !== undefined ? { unitCost: row.fields.costPrice } : {}),
                    reason: existing ? 'นำเข้าไฟล์สินค้า: ตั้งยอดสต็อกตามไฟล์' : 'นำเข้าไฟล์สินค้า: สต็อกเริ่มต้น',
                    userId: user?.id,
                    userName,
                  },
                  tx,
                );
              }
            } catch (e) {
              throw rowErr(e);
            }
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 600000 },
      )
      .catch((err) => rethrowPrismaError(err, { conflict: 'รหัสสินค้าหรือบาร์โค้ดในไฟล์ซ้ำกับสินค้าที่มีอยู่แล้ว', badRef: 'ข้อมูลอ้างอิงในไฟล์ไม่ถูกต้อง' }));

    return { success: true, created, updated, skipped, total: created + updated };
  }
}
