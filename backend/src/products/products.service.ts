import { replaceCheck, replaceProduct } from './product-replace';
import { businessTransaction } from '../prisma/business-transaction';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { rethrowPrismaError } from './prisma-errors';
import { generateProductSku } from './product-sku';
import { deleteCheck, inUseMessage, stockWarning, type DeleteBlocker, type DeleteCheckRow } from './product-delete';
import { cleanNameField, type NameField } from '../../../shared/src/product-names';
import { LOOKUP_FILTERS, type LookupFilter, packChain, priceLevels, rankCandidates, searchTokens, stockLevel } from './product-lookup';
import { addQty, assertQtyAllowed, decimalQtyAllowed, fromHund, hasMax2Decimals, qn, roundQty, toHund } from '../common/qty';
import {
  CHANGE_LOG_KEEP_MS, cleanThumb, cursorUsable, decodeCursor, decodeImageDataUrl, encodeCursor, toCatalogRow,
  type CatalogProduct, type CatalogRow,
} from './product-catalog';

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

/** Longest product code (SKU) a user may type. */
export const SKU_MAX_LENGTH = 64;

/** Trimmed name field (blank = null, undefined = unchanged) or a Thai 400 when too long. */
export function nameField(value: unknown, field: NameField, prefix = ''): string | null | undefined {
  const r = cleanNameField(value, field);
  if (r.error) throw new BadRequestException(prefix + r.error);
  return r.value;
}

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

/** Who saves a product form (the stock field needs the stock adjustment permission). */
export interface ProductActor {
  id?: string;
  fullName?: string;
  username?: string;
  role?: string;
  permissions?: unknown;
}

/** Same rule as POST /inventory/adjust (@RequirePermissions('MANAGE_INVENTORY'); ADMIN always). */
export function canAdjustStock(user: ProductActor | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const perms: string[] = Array.isArray(user.permissions) ? user.permissions.map((p) => String(p)) : [];
  return perms.includes('MANAGE_INVENTORY') || perms.includes('ALL');
}

/** Reason on the stock card of a stock change made in the product form. */
export const PRODUCT_FORM_STOCK_REASON = 'ปรับจากหน้าแก้ไขสินค้า';
export const PRODUCT_FORM_OPENING_REASON = 'สต็อกเริ่มต้น (เพิ่มสินค้าใหม่)';

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
    if (data.manufacturerName !== undefined) data.manufacturerName = nameField(data.manufacturerName, 'manufacturerName');
    // SKU (owner, Round B): the user may type their own code on create and edit; blank = the system generates one on
    // create (create()) and keeps the stored one on edit. Uniqueness against every SKU / barcode: assertIdentifiersFree.
    if (data.sku !== undefined) {
      const sku = typeof data.sku === 'string' ? data.sku.replace(/\s+/g, ' ').trim() : '';
      if (sku.length > SKU_MAX_LENGTH) throw new BadRequestException(`รหัสสินค้ายาวเกิน ${SKU_MAX_LENGTH} ตัวอักษร`);
      if (sku) data.sku = sku;
      else delete data.sku;
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
      const pack = await tx.productPackagingUnit.findFirst({ where: { barcode: sku }, include: { product: { select: { id: true, name: true } } } });
      if (pack && pack.productId !== productId) throw new ConflictException(`รหัสสินค้า (SKU) "${sku}" ซ้ำกับบาร์โค้ดหน่วย "${pack.name}" ของสินค้า "${pack.product?.name || ''}"`);
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
    const found = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isBundle: true, isActive: true } });
    const ok = new Set(found.map((p: any) => p.id));
    const missing = ids.filter((id) => !ok.has(id));
    if (missing.length) throw new BadRequestException(`ไม่พบสินค้าในชุดสินค้า (bundle): ${missing.join(', ')}`);
    // a bundle inside a bundle (and so any cycle) or a newly added disabled product is refused; rows the bundle
    // already had stay as they are (round shift/today/bundle, docs/round-shift-today-bundle-replace.md)
    const had = new Set<string>(
      productId ? (await tx.productBundleItem.findMany({ where: { bundleProductId: productId }, select: { childProductId: true } })).map((r: any) => r.childProductId) : [],
    );
    for (const p of found) {
      if (had.has(p.id)) continue;
      if (p.isBundle) throw new BadRequestException(`"${p.name}" เป็นสินค้าชุด ใส่ในชุดสินค้าอื่นไม่ได้`);
      if (p.isActive === false) throw new BadRequestException(`"${p.name}" ปิดการใช้งานอยู่ เพิ่มเข้าชุดสินค้าไม่ได้`);
    }
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
        supplierProductName: ps.supplierProductName || '',
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

  /** New photos (entries carrying a dataUrl), sortOrder = position in the list sent. */
  private buildImageCreates(images: any[] = []) {
    return images
      .map((image, index) => ({ image, index }))
      .filter(({ image }) => image?.dataUrl)
      .map(({ image, index }) => ({
        dataUrl: String(image.dataUrl),
        thumbDataUrl: cleanThumb(image.thumbDataUrl),
        name: image.name ? String(image.name) : null,
        isCover: Boolean(image.isCover),
        sortOrder: index,
      }));
  }

  /**
   * Replace a product's photo list. Entries with a dataUrl are new photos; entries with only the `id` of one of
   * this product's photos (the list carries photo URLs, not the data) keep that photo row and its data, with the
   * new name / cover flag / position. Photos not in the list are deleted. A photo row's data never changes, so
   * GET /product-images/:id can be cached for good.
   */
  private async replaceImages(tx: any, productId: string, images: any[]) {
    const existing: { id: string }[] = await tx.productImage.findMany({ where: { productId }, select: { id: true } });
    const own = new Set(existing.map((e) => e.id));
    const kept = images
      .map((image, index) => ({ image, index }))
      .filter(({ image }) => !image?.dataUrl && image?.id && own.has(String(image.id)));
    const keepIds = kept.map(({ image }) => String(image.id));
    await tx.productImage.deleteMany({ where: { productId, id: { notIn: keepIds } } });
    for (const { image, index } of kept) {
      await tx.productImage.update({
        where: { id: String(image.id) },
        data: { name: image.name ? String(image.name) : null, isCover: Boolean(image.isCover), sortOrder: index },
      });
    }
    const creates = this.buildImageCreates(images);
    if (creates.length) await tx.productImage.createMany({ data: creates.map((c) => ({ ...c, productId })) });
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
      { supplierId: string; supplierSku: string | null; supplierProductName: string | null; unitCost: number | null; isPreferred: boolean }
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
      // รหัส / ชื่อสินค้าของผู้ขาย (older clients sent the code as `notes`)
      const supplierSku =
        nameField(entry?.supplierSku, 'supplierSku') ?? nameField(entry?.notes, 'supplierSku') ?? null;
      const supplierProductName = nameField(entry?.supplierProductName, 'supplierProductName') ?? null;

      deduped.set(sid, {
        supplierId: sid,
        supplierSku,
        supplierProductName,
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
        supplierProductName: item.supplierProductName,
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

  async create(createProductDto: CreateProductDto, actor?: ProductActor | null) {
    const {
      stockQuantity,
      expectedStock: _ignoredExpected,
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
      const requestCodes = [...(this.barcodeCodes(barcodes) || []), ...(Array.isArray(packagingUnits) ? packagingUnits.map((u: any) => String(u?.barcode || '').trim()).filter(Boolean) : [])];
      // typed code kept (checked below); blank -> generated, never one of this request's own barcodes
      if (!data.sku) data.sku = await generateProductSku(tx, new Set(requestCodes));
      else if (requestCodes.includes(data.sku)) throw new ConflictException(`รหัสสินค้า (SKU) "${data.sku}" ซ้ำกับบาร์โค้ดของสินค้านี้ กรุณาใช้รหัสอื่น`);
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

      // opening stock typed in the form: one audited movement (same path as /inventory/adjust), in this transaction
      if (stockQuantity !== undefined && stockQuantity !== null && Number(stockQuantity) !== 0) {
        this.assertFormStock(actor, created.isBundle);
        await this.inventoryService.adjustStock(
          { productId: created.id, type: 'SET', amount: Number(stockQuantity), reason: PRODUCT_FORM_OPENING_REASON, userId: actor?.id, userName: actor?.fullName || actor?.username },
          tx,
        );
      }

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
        { manufacturerName: { contains: search, mode: 'insensitive' } },
        { suppliers: { some: { OR: [
          { supplierProductName: { contains: search, mode: 'insensitive' } },
          { supplierSku: { contains: search, mode: 'insensitive' } },
        ] } } },
      ];
    }
    if (categoryId) {
      where.categoryId = categoryId;
    }
    return this.catalogRows(this.prisma, where);
  }

  private sortCollation: Promise<string | null> | null = null;

  /** An ICU collation for Thai name sorting (browser localeCompare order), or null (database default). */
  private nameCollation(): Promise<string | null> {
    if (!this.sortCollation) {
      this.sortCollation = this.prisma
        .$queryRaw<{ collname: string }[]>`SELECT collname FROM pg_collation WHERE collname IN ('th-TH-x-icu', 'th-x-icu', 'und-x-icu') ORDER BY collname DESC`
        .then((rows) => {
          const names = rows.map((r) => r.collname);
          return ['th-TH-x-icu', 'th-x-icu', 'und-x-icu'].find((n) => names.includes(n)) || null;
        })
        .catch(() => null);
    }
    return this.sortCollation;
  }

  /**
   * Products management table (GET /products/page): one page of catalogue rows (same JSON as GET /products),
   * filtered, searched and sorted by the database. q = substring of name / SKU / barcode / pack barcode
   * (case-insensitive); supplierId = has that supplier entry; stock low = 0 < stock <= store threshold, out = 0;
   * sort name | stock | basePrice (selling: price level 1, else base price) | priceLevel1-5 (missing = 0;
   * level 1 falls back to the base price), ties and no sort = catalogue (table) order.
   */
  async page(opts: {
    page: number; limit: number; q?: string; categoryId?: string; supplierId?: string; stock?: string; sort?: string; dir?: string;
    /** any of these categories (exports: categories multi-select); '' / 'none' = products without a category */
    categoryIds?: string[];
    /** active (ใช้งาน) | inactive (ปิดใช้งาน) | all (default) */
    status?: string;
    /** inventory page cards over every product; cost only counts for users who may see it */
    stats?: boolean; canViewCost?: boolean;
  }): Promise<{ data: CatalogRow[]; meta: { total: number; page: number; limit: number; totalPages: number; allCount: number; inactiveCount: number; lowStockThreshold: number }; stats?: Record<string, number> }> {
    const page = Math.max(1, Math.min(1_000_000, Math.floor(opts.page || 1)));
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit || 50)));
    const stock = opts.stock || 'all';
    // instock = stock > 0, nostock = 0 or below (export filter "หมด")
    if (!['all', 'low', 'out', 'normal', 'negative', 'reorder', 'instock', 'nostock'].includes(stock)) throw new BadRequestException('ตัวกรองสต็อกไม่ถูกต้อง');
    const status = opts.status || 'all';
    if (!['all', 'active', 'inactive'].includes(status)) throw new BadRequestException('ตัวกรองสถานะไม่ถูกต้อง');
    const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';
    const collation = await this.nameCollation();
    const sortSql: Record<string, string> = {
      name: collation ? `x.name COLLATE "${collation}"` : 'x.name',
      stock: 'x.stock',
      basePrice: 'COALESCE(x.price_level_1, x.base_price)',
      priceLevel1: 'COALESCE(x.price_level_1, x.base_price)',
      priceLevel2: 'COALESCE(x.price_level_2, 0)',
      priceLevel3: 'COALESCE(x.price_level_3, 0)',
      priceLevel4: 'COALESCE(x.price_level_4, 0)',
      priceLevel5: 'COALESCE(x.price_level_5, 0)',
      // cost per unit as the table shows it (the typed reference cost when > 0, else the FIFO average of the stock on hand);
      // only for users who may see costs (others get the plain table order)
      cost: opts.canViewCost ? 'COALESCE(NULLIF(x.cost_price, 0), x.avg_cost, 0)' : 'x.pos',
    };
    if (opts.sort && !sortSql[opts.sort]) throw new BadRequestException('ลำดับการเรียงไม่ถูกต้อง');
    // ties / no sort: the catalogue order (oldest first, then id), the same as the POS catalogue (catalogRows)
    const orderBy = opts.sort ? Prisma.raw(`${sortSql[opts.sort]} ${dir}, x.pos, x.id`) : Prisma.raw('x.pos, x.id');
    const conds: Prisma.Sql[] = [];
    const q = (opts.q || '').trim();
    if (q) {
      const p = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      conds.push(Prisma.sql`(x.name ILIKE ${p} OR x.sku ILIKE ${p} OR x.manufacturer_name ILIKE ${p}
        OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = x.id AND b.barcode ILIKE ${p})
        OR EXISTS (SELECT 1 FROM product_packaging_units u WHERE u.product_id = x.id AND u.barcode ILIKE ${p})
        OR EXISTS (SELECT 1 FROM product_suppliers ps WHERE ps.product_id = x.id
                     AND (ps.supplier_product_name ILIKE ${p} OR ps.supplier_sku ILIKE ${p})))`);
    }
    if (opts.categoryId) conds.push(Prisma.sql`x.category_id = ${opts.categoryId}`);
    if (opts.categoryIds && opts.categoryIds.length) {
      const ids = opts.categoryIds.filter((c) => c && c !== 'none');
      const none = opts.categoryIds.some((c) => !c || c === 'none');
      conds.push(none
        ? Prisma.sql`(x.category_id IS NULL OR x.category_id = ANY(${ids}::text[]))`
        : Prisma.sql`x.category_id = ANY(${ids}::text[])`);
    }
    if (status === 'active') conds.push(Prisma.sql`x.is_active`);
    if (status === 'inactive') conds.push(Prisma.sql`NOT x.is_active`);
    if (opts.supplierId) conds.push(Prisma.sql`EXISTS (SELECT 1 FROM product_suppliers ps WHERE ps.product_id = x.id AND ps.supplier_id = ${opts.supplierId})`);
    const settings = await this.prisma.storeSettings.findFirst({ select: { lowStockThreshold: true } });
    const thresholdRaw = Number(settings?.lowStockThreshold);
    const threshold = Number.isFinite(thresholdRaw) && thresholdRaw >= 0 ? thresholdRaw : 5;
    // service lines (ค่าส่ง) hold no stock: never in a stock filter
    if (stock !== 'all') conds.push(Prisma.sql`NOT x.is_service`);
    if (stock === 'out') conds.push(Prisma.sql`x.stock = 0`);
    if (stock === 'low') conds.push(Prisma.sql`x.stock > 0 AND x.stock <= ${threshold}`);
    if (stock === 'normal') conds.push(Prisma.sql`x.stock > ${threshold}`);
    if (stock === 'negative') conds.push(Prisma.sql`x.stock < 0`);
    if (stock === 'reorder') conds.push(Prisma.sql`x.stock <= ${threshold}`);
    if (stock === 'instock') conds.push(Prisma.sql`x.stock > 0`);
    if (stock === 'nostock') conds.push(Prisma.sql`x.stock <= 0`);
    const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
    // stock as catalogStock computes it: batch sum, or complete sets of a bundle's children
    const offset = (page - 1) * limit;
    const withX = Prisma.sql`
      WITH s AS (SELECT product_id, SUM(quantity_remaining) AS q,
                  -- FIFO pool cost of the stock on hand (batches still holding stock), as the inventory report values it
                  SUM(quantity_remaining * unit_cost) FILTER (WHERE quantity_remaining > 0)
                    / NULLIF(SUM(quantity_remaining) FILTER (WHERE quantity_remaining > 0), 0) AS avg_cost
                FROM stock_batches GROUP BY product_id),
      bs AS (SELECT bi.bundle_product_id AS pid,
               MIN(floor(COALESCE(s.q, 0) / COALESCE(NULLIF(bi.quantity, 0), 1) + 0.000000001)) AS q
             FROM product_bundle_items bi LEFT JOIN s ON s.product_id = bi.child_product_id GROUP BY bi.bundle_product_id),
      x AS (SELECT p.id, p.name, p.sku, p.manufacturer_name, p.category_id, p.base_price, p.cost_price, p.price_level_1, p.price_level_2, p.price_level_3,
              p.price_level_4, p.price_level_5, p.created_at AS pos, p.is_bundle, p.is_service, p.is_active, NULLIF(s.avg_cost, 0) AS avg_cost,
              CASE WHEN p.is_bundle AND bs.pid IS NOT NULL THEN bs.q ELSE COALESCE(s.q, 0) END AS stock
            FROM products p LEFT JOIN s ON s.product_id = p.id LEFT JOIN bs ON bs.pid = p.id)`;
    const rows = await this.prisma.$queryRaw<{ id: string; total: number; unit_cost: string | null }[]>`${withX}
      SELECT x.id, count(*) OVER ()::int AS total, COALESCE(x.avg_cost, x.cost_price)::text AS unit_cost
      FROM x ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    let stats: Record<string, number> | undefined;
    if (opts.stats) {
      // stock value at COST (BUG-05 v1.5.3: it was stock x selling price): stock on hand x FIFO pool cost, else x the
      // reference cost - the inventory report's rule (reports inventory tab); bundles hold no stock of their own;
      // 0 for users who may not see costs
      const [r] = await this.prisma.$queryRaw<Record<string, string>[]>`${withX}
        SELECT count(*)::text AS "totalItems", COALESCE(sum(x.stock), 0)::text AS "totalBaseUnits",
          COALESCE(sum(CASE WHEN ${!!opts.canViewCost} AND NOT x.is_bundle AND x.stock > 0
            THEN x.stock * COALESCE(x.avg_cost, x.cost_price, 0) ELSE 0 END), 0)::text AS "totalValuation",
          count(*) FILTER (WHERE NOT x.is_service AND x.stock > 0 AND x.stock <= ${threshold})::text AS "lowStockCount",
          count(*) FILTER (WHERE NOT x.is_service AND x.stock = 0)::text AS "outOfStockCount",
          count(*) FILTER (WHERE NOT x.is_service AND x.stock < 0)::text AS "negativeStockCount"
        FROM x`;
      stats = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v) || 0]));
    }
    const [{ all, inactive }] = await this.prisma.$queryRaw<{ all: number; inactive: number }[]>`
      SELECT count(*)::int AS "all", count(*) FILTER (WHERE NOT is_active)::int AS inactive FROM products`;
    let total = rows.length ? Number(rows[0].total) : 0;
    if (!rows.length && offset > 0 && conds.length === 0) total = all;
    else if (!rows.length && offset > 0) {
      // past the last page: count without paging
      const again = await this.page({ ...opts, page: 1, limit: 1, stats: false });
      total = again.meta.total;
    }
    const ids = rows.map((r) => r.id);
    const catalog = await this.catalogRows(this.prisma, { ids });
    const byId = new Map(catalog.map((r) => [r.id, r]));
    const unitCostOf = new Map(rows.map((r) => [r.id, r.unit_cost]));
    // unitCost: cost per unit for the cost columns (FIFO pool of the stock on hand, else the reference cost); a cost
    // field, removed for users without VIEW_COST by the controller
    const data = ids
      .map((id) => byId.get(id))
      .filter((r): r is CatalogRow => !!r)
      .map((r) => {
        const c = unitCostOf.get(r.id);
        return { ...r, unitCost: c === null || c === undefined ? null : Number(c) };
      });
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit), allCount: all, inactiveCount: inactive, lowStockThreshold: threshold }, ...(stats ? { stats } : {}) };
  }

  /** Remaining stock per product id (sum of its batches); `ids` limits it to those products. */
  private async stockSums(db: any, ids?: string[]): Promise<Map<string, number>> {
    const rows: { product_id: string; qty: string | null }[] = ids
      ? ids.length
        ? await db.$queryRaw`SELECT product_id, SUM(quantity_remaining)::text AS qty FROM stock_batches WHERE product_id = ANY(${ids}::text[]) GROUP BY product_id`
        : []
      : await db.$queryRaw`SELECT product_id, SUM(quantity_remaining)::text AS qty FROM stock_batches GROUP BY product_id`;
    return new Map(rows.map((r) => [r.product_id, Number(r.qty || 0)]));
  }

  /**
   * POS catalogue rows (see product-catalog.ts): every product, or the products `ids`, or (GET /products?search=…)
   * the ones matching `where`. Built by one SQL statement (relations aggregated per product as JSON) instead of
   * Prisma objects: same JSON, ~5x faster on 10k products. Money / quantity decimals come out as Prisma prints them
   * (trim_scale text; QtyResponseInterceptor turns quantities into numbers), timestamps as ISO strings.
   */
  private async catalogRows(db: any, where: Prisma.ProductWhereInput | { ids: string[] } = {}): Promise<CatalogRow[]> {
    let ids: string[] | null = null;
    if ('ids' in where) ids = where.ids as string[];
    else if (Object.keys(where).length > 0) {
      ids = (await db.product.findMany({ where, select: { id: true } })).map((p: { id: string }) => p.id);
    }
    if (ids && ids.length === 0) return [];
    const only = (col: string) => (ids ? Prisma.sql`WHERE ${Prisma.raw(col)} = ANY(${ids}::text[])` : Prisma.empty);
    const dec = (col: string) => Prisma.raw(`trim_scale(${col})::text`);
    const ts = (col: string) => Prisma.raw(`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
    const products: CatalogProduct[] = await db.$queryRaw`
      WITH
      bc AS (SELECT b.product_id, json_agg(json_build_object('barcode', b.barcode, 'label', b.label)) AS j
             FROM product_barcodes b ${only('b.product_id')} GROUP BY b.product_id),
      pu AS (SELECT u.product_id, json_agg(json_build_object(
               'id', u.id, 'productId', u.product_id, 'name', u.name, 'qtyPerPrev', u.qty_per_prev, 'barcode', u.barcode,
               'priceLevel1', ${dec('u.price_level_1')}, 'priceLevel2', ${dec('u.price_level_2')}, 'priceLevel3', ${dec('u.price_level_3')},
               'priceLevel4', ${dec('u.price_level_4')}, 'priceLevel5', ${dec('u.price_level_5')}, 'sortOrder', u.sort_order,
               'createdAt', ${ts('u.created_at')}, 'updatedAt', ${ts('u.updated_at')}) ORDER BY u.sort_order) AS j
             FROM product_packaging_units u ${only('u.product_id')} GROUP BY u.product_id),
      im AS (SELECT i.product_id, json_agg(json_build_object('id', i.id, 'name', i.name, 'isCover', i.is_cover, 'sortOrder', i.sort_order)
               ORDER BY i.sort_order) AS j
             FROM product_images i ${only('i.product_id')} GROUP BY i.product_id),
      wp AS (SELECT w.product_id, json_agg(json_build_object(
               'id', w.id, 'productId', w.product_id, 'minQuantity', ${dec('w.min_quantity')}, 'unitPrice', ${dec('w.unit_price')},
               'sortOrder', w.sort_order, 'createdAt', ${ts('w.created_at')}, 'updatedAt', ${ts('w.updated_at')}) ORDER BY w.sort_order) AS j
             FROM product_wholesale_prices w ${only('w.product_id')} GROUP BY w.product_id),
      su AS (SELECT ps.product_id, json_agg(json_build_object(
               'id', ps.id, 'supplierId', ps.supplier_id, 'supplierSku', ps.supplier_sku,
               'supplierProductName', ps.supplier_product_name, 'unitCost', ${dec('ps.unit_cost')},
               'isPreferred', ps.is_preferred, 'supplier', json_build_object('id', s.id, 'name', s.name))
               ORDER BY ps.is_preferred DESC, ps.created_at ASC) AS j
             FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id ${only('ps.product_id')} GROUP BY ps.product_id),
      bu AS (SELECT bi.bundle_product_id AS product_id, json_agg(json_build_object(
               'id', bi.id, 'childProductId', bi.child_product_id, 'quantity', ${dec('bi.quantity')},
               'childProduct', json_build_object('id', c.id, 'name', c.name, 'sku', c.sku, 'unit', c.unit,
                 'basePrice', ${dec('c.base_price')}, 'priceLevel1', ${dec('c.price_level_1')}))) AS j
             FROM product_bundle_items bi JOIN products c ON c.id = bi.child_product_id ${only('bi.bundle_product_id')} GROUP BY bi.bundle_product_id)
      SELECT p.id, p.name, p.manufacturer_name AS "manufacturerName", p.description, p.sku, p.category_id AS "categoryId",
        p.base_price AS "basePrice", p.cost_price AS "costPrice",
        p.price_level_1 AS "priceLevel1", p.price_level_2 AS "priceLevel2", p.price_level_3 AS "priceLevel3",
        p.price_level_4 AS "priceLevel4", p.price_level_5 AS "priceLevel5",
        p.unit, p.image_url AS "imageUrl", p.is_bundle AS "isBundle", p.is_service AS "isService", p.is_active AS "isActive",
        p.created_at AS "createdAt", p.updated_at AS "updatedAt",
        COALESCE(bc.j, '[]'::json) AS barcodes, COALESCE(pu.j, '[]'::json) AS "packagingUnits",
        COALESCE(im.j, '[]'::json) AS images, COALESCE(wp.j, '[]'::json) AS "wholesalePrices",
        CASE WHEN cat.id IS NULL THEN NULL ELSE json_build_object('id', cat.id, 'name', cat.name, 'color', cat.color, 'icon', cat.icon,
          'sortOrder', cat.sort_order, 'isActive', cat.is_active, 'createdAt', ${ts('cat.created_at')}) END AS category,
        COALESCE(su.j, '[]'::json) AS suppliers, COALESCE(bu.j, '[]'::json) AS "bundleItems"
      FROM products p
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN bc ON bc.product_id = p.id LEFT JOIN pu ON pu.product_id = p.id LEFT JOIN im ON im.product_id = p.id
      LEFT JOIN wp ON wp.product_id = p.id LEFT JOIN su ON su.product_id = p.id LEFT JOIN bu ON bu.product_id = p.id
      ${only('p.id')}
      ORDER BY p.created_at, p.id`;
    // A fixed order (oldest product first): the POS search lists matches in this order and the products page uses it
    // for ties / no sort. It was the physical row order (ctid): an UPDATE or space reused after a VACUUM moved rows,
    // so a full reload could put a newer product above an older one (and differ from a delta-synced list, which
    // keeps positions and appends new products) - e2e 37 saw the 3rd product of a search come first.
    let stockOf: Map<string, number>;
    if (ids) {
      const need = new Set<string>();
      for (const p of products) {
        need.add(p.id);
        for (const bi of p.bundleItems) need.add(bi.childProductId);
      }
      stockOf = await this.stockSums(db, [...need]);
    } else {
      stockOf = await this.stockSums(db);
    }
    return products.map((p) => toCatalogRow(p, stockOf));
  }

  private lastChangeLogPrune = 0;

  /**
   * POS catalogue delta sync (GET /products/sync?since=<cursor>).
   * No / unusable cursor: every product (`full: true`). Otherwise the products changed since the cursor (rows of
   * product_changes written by transactions not visible in the cursor's snapshot, plus bundles of changed children)
   * and the ids of deleted products. Reads in one REPEATABLE READ transaction, so the returned cursor (its snapshot)
   * matches the data exactly: a write committed during the read shows up in the next delta.
   */
  async sync(since?: string): Promise<{ cursor: string; full: boolean; products: CatalogRow[]; deleted: string[] }> {
    const parsed = decodeCursor(since);
    const result = await this.prisma.$transaction(
      async (tx) => {
        const [head] = await tx.$queryRaw<{ snapshot: string; epoch: string }[]>`
          SELECT pg_current_snapshot()::text AS snapshot,
                 (SELECT oid FROM pg_database WHERE datname = current_database())::text || '-' || 'product_changes'::regclass::oid::text
                   -- TRUNCATE ("ล้างข้อมูลทั้งหมด") gives the change log a new file: old cursors then reload everything
                   || '-' || pg_relation_filenode('product_changes'::regclass)::text AS epoch`;
        const now = Date.now();
        const cursor = encodeCursor({ epoch: head.epoch, at: now, snapshot: head.snapshot });
        let usable = cursorUsable(parsed, head.epoch, now);
        if (usable) {
          // a snapshot "from the future" (database restored / replaced) cannot be compared: reload everything
          const [chk] = await tx.$queryRaw<{ ok: boolean }[]>`
            SELECT pg_snapshot_xmax(${parsed!.snapshot}::pg_snapshot) <= pg_snapshot_xmax(pg_current_snapshot()) AS ok`;
          usable = !!chk?.ok;
        }
        if (!usable) return { cursor, full: true, products: await this.catalogRows(tx), deleted: [] as string[] };

        const changed = await tx.$queryRaw<{ product_id: string }[]>`
          SELECT DISTINCT c.product_id FROM product_changes c
          WHERE c.xid >= pg_snapshot_xmin(${parsed!.snapshot}::pg_snapshot)
            AND NOT pg_visible_in_snapshot(c.xid, ${parsed!.snapshot}::pg_snapshot)`;
        const ids = new Set(changed.map((r) => r.product_id));
        if (ids.size) {
          // a bundle's stock and child names come from its children
          const bundles = await tx.$queryRaw<{ id: string }[]>`
            SELECT DISTINCT bundle_product_id AS id FROM product_bundle_items WHERE child_product_id = ANY(${[...ids]}::text[])`;
          for (const b of bundles) ids.add(b.id);
        }
        const products = ids.size ? await this.catalogRows(tx, { ids: [...ids] }) : [];
        const found = new Set(products.map((p) => p.id));
        return { cursor, full: false, products, deleted: [...ids].filter((id) => !found.has(id)) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 120000 },
    );
    this.pruneChangeLog();
    return result;
  }

  /** Drop change-log rows older than any usable cursor (at most once an hour, in the background). */
  private pruneChangeLog() {
    const now = Date.now();
    if (now - this.lastChangeLogPrune < 3600_000) return;
    this.lastChangeLogPrune = now;
    const keepDays = Math.round(CHANGE_LOG_KEEP_MS / 86_400_000);
    // changed_at is written by the database clock (CURRENT_TIMESTAMP), so compare with it too
    void this.prisma.$executeRaw`DELETE FROM product_changes WHERE changed_at < CURRENT_TIMESTAMP - make_interval(days => ${keepDays}::int)`.catch(() => {
      this.lastChangeLogPrune = 0;
    });
  }

  /** Photo of GET /product-images/:id (`thumb`: the small copy, or the full photo for rows saved without one). */
  async getImage(id: string, size?: string): Promise<{ contentType: string; body: Buffer } | null> {
    if (typeof id !== 'string' || id.length > 64) return null;
    if (size === 'thumb') {
      const t = await this.prisma.productImage.findUnique({ where: { id }, select: { thumbDataUrl: true } });
      if (!t) return null;
      if (t.thumbDataUrl) return decodeImageDataUrl(t.thumbDataUrl);
    }
    const img = await this.prisma.productImage.findUnique({ where: { id }, select: { dataUrl: true } });
    return decodeImageDataUrl(img?.dataUrl);
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
    // One SQL query (Prisma loaded every product + barcodes + bundle items as objects: 0.3 s on 10k products).
    // Same match as before: every word in name / SKU (case-insensitive) or a barcode / pack barcode (exact case).
    const tokenConds = tokens.map((t) => Prisma.sql`(
        strpos(lower(p.name), lower(${t})) > 0 OR strpos(lower(p.sku), lower(${t})) > 0
        OR strpos(lower(COALESCE(p.manufacturer_name, '')), lower(${t})) > 0
        OR EXISTS (SELECT 1 FROM product_suppliers ps WHERE ps.product_id = p.id
                     AND (strpos(lower(COALESCE(ps.supplier_product_name, '')), lower(${t})) > 0
                          OR strpos(lower(COALESCE(ps.supplier_sku, '')), lower(${t})) > 0))
        OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND strpos(b.barcode, ${t}) > 0)
        OR EXISTS (SELECT 1 FROM product_packaging_units u WHERE u.product_id = p.id AND strpos(u.barcode, ${t}) > 0))`);
    const whereSql = Prisma.join([Prisma.sql`p.is_active`, ...tokenConds], ' AND ');
    const [settings, rawRows, sums] = await Promise.all([
      this.prisma.storeSettings.findFirst({ select: { lowStockThreshold: true } }),
      this.prisma.$queryRaw<{ id: string; name: string; sku: string; isBundle: boolean; barcodes: string[] | null; bundleItems: { childProductId: string; quantity: string }[] | null }[]>`
        SELECT p.id, p.name, p.sku, (p.is_bundle OR p.is_service) AS "isBundle", -- no stock of its own
          (SELECT array_agg(b.barcode ORDER BY b.created_at, b.id) FROM product_barcodes b WHERE b.product_id = p.id) AS barcodes,
          (SELECT json_agg(json_build_object('childProductId', bi.child_product_id, 'quantity', bi.quantity::text))
             FROM product_bundle_items bi WHERE bi.bundle_product_id = p.id) AS "bundleItems"
        FROM products p WHERE ${whereSql}`,
      this.prisma.$queryRaw<{ product_id: string; qty: string | null }[]>`
        SELECT product_id, SUM(quantity_remaining)::text AS qty FROM stock_batches GROUP BY product_id`,
    ]);
    const rows = rawRows.map((r) => ({ ...r, barcodes: r.barcodes || [], bundleItems: r.bundleItems || [] }));
    const thresholdRaw = Number(settings?.lowStockThreshold);
    const threshold = Number.isFinite(thresholdRaw) && thresholdRaw >= 0 ? thresholdRaw : 5;
    const stockOf = new Map(sums.map((s) => [s.product_id, roundQty(Number(s.qty || 0))]));
    const stockFor = (r: (typeof rows)[number]): number => {
      if (!r.isBundle || r.bundleItems.length === 0) return stockOf.get(r.id) || 0;
      return Math.max(0, Math.min(...r.bundleItems.map((bi) => Math.floor((stockOf.get(bi.childProductId) || 0) / (qn(bi.quantity) || 1) + 1e-9))));
    };
    const candidates = rows.map((r) => ({ ...r, stock: stockFor(r) }));
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
        id: true, name: true, sku: true, manufacturerName: true, unit: true, isBundle: true, basePrice: true, costPrice: true,
        suppliers: { select: { supplierId: true, supplierProductName: true, supplierSku: true }, orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }] },
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
        // other names, for the "ผู้ผลิต: … / รหัสผู้ขาย: …" hint of a match that came from them
        manufacturerName: d.manufacturerName,
        suppliers: d.suppliers.map((s) => ({ supplierProductName: s.supplierProductName, supplierSku: s.supplierSku })),
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
  async update(id: string, updateProductDto: UpdateProductDto, opts: { canViewCost?: boolean; actor?: ProductActor | null } = {}) {
    const {
      stockQuantity,
      expectedStock,
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
      const current = await tx.product.findUnique({ where: { id }, select: { id: true, sku: true, isBundle: true } });
      if (!current) throw new NotFoundException('ไม่พบสินค้านี้');
      // stock typed in the form: checked first, so a refused change saves nothing of the form
      const stockChange = stockQuantity !== undefined && stockQuantity !== null
        ? await this.formStockChange(tx, id, Number(stockQuantity), expectedStock, opts.actor, data.isBundle ?? current.isBundle)
        : null;
      // a typed SKU renames the product (unique against every SKU / barcode); unchanged = nothing to write
      if (data.sku !== undefined && data.sku === current.sku) delete data.sku;
      if (data.sku !== undefined) {
        const ownCodes = [...(this.barcodeCodes(barcodes) || []), ...(Array.isArray(packagingUnits) ? packagingUnits.map((u: any) => String(u?.barcode || '').trim()).filter(Boolean) : [])];
        if (ownCodes.includes(data.sku)) throw new ConflictException(`รหัสสินค้า (SKU) "${data.sku}" ซ้ำกับบาร์โค้ดของสินค้านี้ กรุณาใช้รหัสอื่น`);
      }
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
        await this.replaceImages(tx, id, images);
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

      if (stockChange) {
        // the adjustment service owns stock (FIFO batches + movement log): one source for the stock card
        await this.inventoryService.adjustStock(
          { productId: id, type: 'SET', amount: stockChange.target, reason: PRODUCT_FORM_STOCK_REASON, userId: opts.actor?.id, userName: opts.actor?.fullName || opts.actor?.username },
          tx,
        );
      }

      return tx.product.update({
        where: { id },
        data: {
          ...data,
          ...(barcodes && { barcodes: { create: this.buildBarcodeCreates(barcodes) } }),
          ...(packagingUnits && { packagingUnits: { create: this.buildPackagingUnitCreates(packagingUnits) } }),
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

  /** The stock field may be used: stock adjustment permission, and not on a bundle (its stock = its children's). */
  private assertFormStock(actor: ProductActor | null | undefined, isBundle: boolean) {
    if (!canAdjustStock(actor)) throw new ForbiddenException('ไม่มีสิทธิ์ปรับสต็อก (ต้องมีสิทธิ์จัดการคลังสินค้า)');
    if (isBundle) throw new BadRequestException('สินค้าจัดเซ็ตไม่มีสต็อกของตัวเอง (สต็อกคิดจากสินค้าในชุด)');
  }

  /**
   * Product form edit with a stock value: null = nothing to change (same as now), else the target. The user must have
   * seen the current stock (`expectedStock`); when another sale / receipt / adjustment changed it meanwhile the save
   * is refused (409 STOCK_CHANGED with the current stock) instead of overwriting it blindly.
   */
  private async formStockChange(tx: any, id: string, target: number, expectedStock: number | undefined, actor: ProductActor | null | undefined, isBundle: boolean): Promise<{ target: number } | null> {
    this.assertFormStock(actor, isBundle);
    if (!Number.isFinite(target)) throw new BadRequestException('จำนวนสต็อกไม่ถูกต้อง');
    if (expectedStock === undefined || expectedStock === null || !Number.isFinite(Number(expectedStock))) {
      throw new BadRequestException('กรุณาส่งยอดสต็อกที่เห็นตอนเปิดฟอร์ม (expectedStock)');
    }
    const rows: { qty: string | null }[] = await tx.$queryRaw`SELECT SUM(quantity_remaining)::text AS qty FROM stock_batches WHERE product_id = ${id}`;
    const currentH = toHund(Number(rows[0]?.qty || 0));
    if (currentH !== toHund(Number(expectedStock))) {
      const currentStock = fromHund(currentH);
      throw new ConflictException({
        statusCode: 409,
        code: 'STOCK_CHANGED',
        message: `สต็อกของสินค้านี้เปลี่ยนเป็น ${currentStock} ระหว่างที่แก้ไข (ตอนเปิดฟอร์ม ${Number(expectedStock)}) กรุณาตรวจสอบแล้วบันทึกอีกครั้ง`,
        currentStock,
        expectedStock: Number(expectedStock),
      });
    }
    return toHund(target) === currentH ? null : { target };
  }

  /** Delete check of products (GET /products/:id/delete-check, POST /products/delete-check). */
  async deleteCheck(ids: string[]): Promise<DeleteCheckRow[]> {
    return deleteCheck(this.prisma, ids);
  }

  /**
   * Delete a product for good (docs/product-delete.md). Allowed only while no business document names it
   * (409 PRODUCT_IN_USE with the documents listed: disable it instead). Stock still on hand must be confirmed
   * (`confirmStock`, else 409 STOCK_CONFIRM_REQUIRED). In one transaction: its stock batches (opening stock /
   * adjustments) and the product (barcodes, packs, photos, supplier rows, wholesale prices and its bundle rows go
   * with it by cascade); one PRODUCT_DELETE audit entry (and a STOCK_PRODUCT_DELETE movement when stock left the
   * shop). The product_changes trigger records the delete, so POS terminals drop it on their next delta sync.
   * Stock movement history (audit_logs) is kept: it is the audit trail and the P&L reads stock write-offs from it.
   */
  async remove(id: string, opts: { confirmStock?: boolean; actor?: { id?: string; fullName?: string; username?: string } } = {}) {
    if (typeof id !== 'string' || !id || id.length > 100) throw new NotFoundException('ไม่พบสินค้านี้');
    return businessTransaction(this.prisma, async (tx) => {
      // the row lock makes a sale / PO line written at the same moment wait for (and then fail on) the delete
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('ไม่พบสินค้านี้');
      const [check] = await deleteCheck(tx, [id]);
      if (!check.canDelete) {
        throw new ConflictException({
          statusCode: 409, code: 'PRODUCT_IN_USE', message: inUseMessage(check.name, check.blockers),
          productId: check.id, name: check.name, isActive: check.isActive, blockers: check.blockers,
        });
      }
      if (check.stock !== 0 && !opts.confirmStock) {
        throw new ConflictException({
          statusCode: 409, code: 'STOCK_CONFIRM_REQUIRED', message: `${stockWarning(check.stock, check.unit)} กรุณายืนยันการลบอีกครั้ง`,
          productId: check.id, name: check.name, stock: check.stock,
        });
      }
      const counts = await tx.$queryRaw<Record<string, number>[]>`
        SELECT (SELECT COUNT(*)::int FROM stock_batches WHERE product_id = ${id}) AS "stockBatches",
               (SELECT COUNT(*)::int FROM product_barcodes WHERE product_id = ${id}) AS barcodes,
               (SELECT COUNT(*)::int FROM product_packaging_units WHERE product_id = ${id}) AS packs,
               (SELECT COUNT(*)::int FROM product_images WHERE product_id = ${id}) AS images,
               (SELECT COUNT(*)::int FROM product_suppliers WHERE product_id = ${id}) AS suppliers,
               (SELECT COUNT(*)::int FROM product_wholesale_prices WHERE product_id = ${id}) AS "wholesalePrices",
               (SELECT COUNT(*)::int FROM product_bundle_items WHERE bundle_product_id = ${id}) AS "bundleItems"`;
      await tx.stockBatch.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
      const userName = opts.actor?.fullName || opts.actor?.username || 'ระบบ';
      const userId = opts.actor?.id || null;
      const details = {
        productId: id, sku: check.sku, productName: check.name, unitName: check.unit || 'ชิ้น',
        stock: check.stock, stockValue: check.stockValue, removed: counts[0], userName,
      };
      await tx.auditLog.create({ data: { userId, action: 'PRODUCT_DELETE', entity: 'Product', entityId: id, details } });
      if (check.stock !== 0) {
        // stock card / movements: the stock left the shop with the product (not a P&L write-off)
        await tx.auditLog.create({
          data: {
            userId, action: 'STOCK_PRODUCT_DELETE', entity: 'Product', entityId: id,
            details: {
              productId: id, sku: check.sku, productName: check.name, unitName: check.unit || 'ชิ้น', type: 'PRODUCT_DELETE',
              quantityChange: -check.stock, previousStock: check.stock, currentStock: 0, costValue: -check.stockValue,
              reason: 'ลบสินค้า', referenceType: 'PRODUCT_DELETE', userName,
            },
          },
        });
      }
      return { deleted: true, id, name: check.name, sku: check.sku, stock: check.stock, stockValue: check.stockValue };
    }).catch((err) => {
      // a document written between the check and the delete (foreign key) = in use
      if (err?.code === 'P2003') throw new ConflictException({ statusCode: 409, code: 'PRODUCT_IN_USE', message: 'สินค้านี้ถูกใช้ในเอกสารแล้ว จึงลบไม่ได้ ให้ปิดการใช้งานแทน', productId: id, blockers: [] });
      rethrowPrismaError(err, { notFound: 'ไม่พบสินค้านี้' });
    });
  }

  /** GET /products/:id/replace-check: what a delete with `replacementId` would move, and why it cannot be done. */
  async replaceCheck(id: string, replacementId?: string) {
    return replaceCheck(this.prisma, id, replacementId || null);
  }

  /**
   * Delete a used product and move its history to a replacement (docs/round-shift-today-bundle-replace.md):
   * one transaction, see product-replace.ts.
   */
  async replace(id: string, replacementId: string, opts: { moveBarcodes: boolean; actor?: { id?: string; fullName?: string; username?: string } }) {
    if (typeof id !== 'string' || !id || id.length > 100) throw new NotFoundException('ไม่พบสินค้านี้');
    if (typeof replacementId !== 'string' || !replacementId || replacementId.length > 100) throw new BadRequestException('กรุณาเลือกสินค้าทดแทน');
    // the same business lock as every sale / stock write, with more time: a long-sold product moves many lines
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(742091, 1)`;
      return replaceProduct(tx, id, replacementId, opts);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 120000 }).catch((err) => {
      if (err?.status) throw err;
      rethrowPrismaError(err, { notFound: 'ไม่พบสินค้านี้' });
    });
  }

  /**
   * "ลบที่เลือก": deletes each product that may be deleted (each in its own transaction), and reports the others:
   * `blocked` (named in documents: offer to disable them), `needsStockConfirm` (stock on hand, `confirmStock` not
   * given), `notFound`.
   */
  async bulkRemove(ids: string[], opts: { confirmStock?: boolean; actor?: { id?: string; fullName?: string; username?: string } } = {}) {
    const unique = [...new Set(ids)];
    const deleted: { id: string; name: string; stock: number; stockValue: number }[] = [];
    const blocked: { id: string; name: string; isActive: boolean; blockers: DeleteBlocker[]; message: string }[] = [];
    const needsStockConfirm: { id: string; name: string; stock: number; unit: string }[] = [];
    const notFound: string[] = [];
    for (const id of unique) {
      try {
        const r = await this.remove(id, opts);
        deleted.push({ id, name: r.name, stock: r.stock, stockValue: r.stockValue });
      } catch (err: any) {
        const body = typeof err?.getResponse === 'function' ? err.getResponse() : null;
        if (err instanceof NotFoundException) notFound.push(id);
        else if (body?.code === 'PRODUCT_IN_USE') blocked.push({ id, name: body.name || '', isActive: body.isActive !== false, blockers: body.blockers || [], message: body.message });
        else if (body?.code === 'STOCK_CONFIRM_REQUIRED') {
          const [c] = await deleteCheck(this.prisma, [id]);
          needsStockConfirm.push({ id, name: c?.name || body.name || '', stock: c?.stock ?? body.stock, unit: c?.unit || '' });
        } else throw err;
      }
    }
    return { deleted, blocked, needsStockConfirm, notFound };
  }

  /**
   * ปิดการใช้งาน / เปิดใช้งาน (POST /products/set-active). Inactive products leave the POS catalogue (the delta sync
   * sends the row with isActive false; terminals drop it from sale), the online shop, the mobile lookup and the
   * pickers; checkout refuses them. They stay in documents and reports. One audit entry per product changed.
   */
  async setActive(ids: string[], isActive: boolean, actor?: { id?: string; fullName?: string; username?: string }) {
    const unique = [...new Set(ids)];
    return businessTransaction(this.prisma, async (tx) => {
      const rows = await tx.product.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, sku: true, isActive: true } });
      const change = rows.filter((r) => r.isActive !== isActive);
      if (change.length) {
        await tx.product.updateMany({ where: { id: { in: change.map((r) => r.id) } }, data: { isActive } });
        await tx.auditLog.createMany({
          data: change.map((r) => ({
            userId: actor?.id || null, action: isActive ? 'PRODUCT_ENABLE' : 'PRODUCT_DISABLE', entity: 'Product', entityId: r.id,
            details: { productId: r.id, sku: r.sku, productName: r.name, isActive, userName: actor?.fullName || actor?.username || 'ระบบ' },
          })),
        });
      }
      const found = new Set(rows.map((r) => r.id));
      return { updated: change.length, unchanged: rows.length - change.length, notFound: unique.filter((id) => !found.has(id)), isActive };
    });
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
    // ชื่อผู้ผลิต: like the other optional columns, blank = left as it is
    try {
      const manufacturerName = nameField(item.manufacturerName, 'manufacturerName');
      if (manufacturerName) fields.manufacturerName = manufacturerName;
    } catch (e: any) {
      throw rowErr(e?.message);
    }

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
    // rows matched by barcode (no id) that carried another SKU: kept as is (only a row matched by its system id renames)
    let skuKept = 0;
    let skuRenamed = 0;
    // codes named anywhere in the file: a generated SKU must not take one of them
    const fileCodes = new Set<string>();
    for (const r of rows) {
      for (const c of [r.sku, r.barcode, ...r.extraBarcodes, ...(r.packagingUnits || []).map((u) => u.barcode)]) if (c) fileCodes.add(c);
    }

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
                // match order id -> SKU -> barcode. A row matched by its system id may rename the SKU (the user edited
                // it in the exported file); a row matched by barcode keeps the stored SKU (the file's may be a typo).
                let newSku: string | undefined;
                if (row.sku && row.sku !== existing.sku) {
                  if (row.id && existing.id === row.id) newSku = row.sku;
                  else skuKept++;
                }
                await this.assertIdentifiersFree(tx, productId, newSku, row.barcode && barcodeOwner !== productId ? [row.barcode] : undefined);
                if (newSku) {
                  data.sku = newSku;
                  skuRenamed++;
                }
                if (Object.keys(data).length > 0) await tx.product.update({ where: { id: productId }, data });
                updated++;
              } else {
                // new product: the file's SKU is kept (re-importing the same file then updates instead of
                // duplicating); no SKU in the file -> the system generates one (same format as the product form)
                const sku = row.sku || (await generateProductSku(tx, fileCodes));
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

    return { success: true, created, updated, skipped, skuKept, skuRenamed, total: created + updated };
  }
}
