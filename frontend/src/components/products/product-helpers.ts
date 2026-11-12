import { getLowStockThreshold } from '@/lib/store-settings-storage';
import type {
  PackagingUnitForm,
  ProductForm,
  ProductImageItem,
  ProductRecord,
  WholesaleStepForm,
} from './types';

// ─── EAN-13 Generator ─────────────────────────────────────────────────
export function generateEAN13(): string {
  const prefix = "200";
  let num = prefix;
  for (let i = 0; i < 9; i++) num += Math.floor(Math.random() * 10);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(num[i]) * (i % 2 === 0 ? 1 : 3);
  return num + ((10 - (sum % 10)) % 10);
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Compress image to max 900px, JPEG quality 0.82
export function compressImage(file: File, maxPx = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round((h / w) * maxPx); w = maxPx; }
          else { w = Math.round((w / h) * maxPx); h = maxPx; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Message of a thrown error (ApiError / Error / anything with a message), else undefined. */
export function errorMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message;
  return undefined;
}

export function errorStatus(err: unknown): unknown {
  return err && typeof err === 'object' && 'status' in err ? err.status : undefined;
}

// ─── Product helpers ──────────────────────────────────────────────────
export function computeMultipliers(units: PackagingUnitForm[]): number[] {
  let cum = 1;
  return units.map(u => { cum *= parseInt(u.qtyPerPrev) || 1; return cum; });
}

export function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function getProductBarcodes(product: ProductRecord): string[] {
  const fromBarcodes = Array.isArray(product?.barcodes)
    ? product.barcodes.map((b) => typeof b === 'string' ? b : b?.barcode)
    : [];
  const fromUnits = Array.isArray(product?.units)
    ? product.units.map((u) => u?.barcode)
    : [];
  const directBarcodes = [
    product?.barcode,
    product?.customBarcodeId,
    product?.barcodeForSelling,
  ];
  const seen = new Set<string>();
  return [...fromBarcodes, ...fromUnits, ...directBarcodes]
    .map((b) => String(b ?? '').trim())
    .filter((barcode) => {
      const key = normalizeKey(barcode);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const priceText = (v: unknown) => (v != null ? String(v) : '');

export function getProductPackagingUnits(product: ProductRecord): PackagingUnitForm[] {
  const units = Array.isArray(product?.packagingUnits) && product.packagingUnits.length > 0
    ? product.packagingUnits
    : [];

  return units.map((unit) => ({
    name: unit.name || unit.unitName || '',
    qtyPerPrev: String(unit.qtyPerPrev ?? unit.factor ?? ''),
    barcode: unit.barcode || '',
    priceLevel1: priceText(unit.priceLevel1),
    priceLevel2: priceText(unit.priceLevel2),
    priceLevel3: priceText(unit.priceLevel3),
    priceLevel4: priceText(unit.priceLevel4),
    priceLevel5: priceText(unit.priceLevel5),
  }));
}

export function getProductImages(product: ProductRecord): ProductImageItem[] {
  if (Array.isArray(product?.images) && product.images.length > 0) {
    return product.images
      .filter((image) => image?.dataUrl)
      .map((image) => ({
        id: image.id || generateId(),
        dataUrl: image.dataUrl as string,
        name: image.name || '',
        isCover: Boolean(image.isCover),
      }));
  }
  return [];
}

export function getProductWholesaleSteps(product: ProductRecord): WholesaleStepForm[] {
  const prices = Array.isArray(product?.wholesalePrices) && product.wholesalePrices.length > 0
    ? product.wholesalePrices
    : [];

  const rows = prices.map((price) => ({
    minQuantity: price.minQuantity != null ? String(price.minQuantity) : '',
    unitPrice: price.unitPrice != null ? String(price.unitPrice) : '',
  }));

  return rows.length > 0 ? rows : Array.from({ length: 5 }, () => ({ minQuantity: "", unitPrice: "" }));
}

/** Excel cell -> number; blank/missing -> undefined (field not in the file, server keeps its value). Non-numeric text is passed through so the server rejects the row with its row number. */
export function optionalNumberCell(value: unknown): number | string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  const text = String(value).replace(/,/g, '').trim();
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : text;
}

export function pickProductCost(product: ProductRecord): number | undefined {
  const raw = product?.cost ?? product?.costPrice;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

const optionalPrice = (v: unknown) => (v !== '' && v != null ? Number(v) : undefined);

export function productToApiPayload(product: ProductRecord, conflictingBarcodeKeys = new Set<string>()) {
  const sellingPrice = Number(product.priceLevel1 ?? product.price ?? 0);
  const barcodes = getProductBarcodes(product).filter((barcode) => !conflictingBarcodeKeys.has(normalizeKey(barcode)));
  return {
    name: product.name,
    sku: product.sku,
    categoryId: product.categoryId || undefined,
    basePrice: sellingPrice,
    // never fall back to basePrice (selling price); no cost known (e.g. user without VIEW_COST) = field omitted, server keeps its value
    costPrice: pickProductCost(product),
    priceLevel1: product.priceLevel1 != null ? Number(product.priceLevel1) : undefined,
    priceLevel2: product.priceLevel2 != null ? Number(product.priceLevel2) : undefined,
    priceLevel3: product.priceLevel3 != null ? Number(product.priceLevel3) : undefined,
    priceLevel4: product.priceLevel4 != null ? Number(product.priceLevel4) : undefined,
    priceLevel5: product.priceLevel5 != null ? Number(product.priceLevel5) : undefined,
    unit: product.unit || '',
    barcodes,
    packagingUnits: Array.isArray(product.packagingUnits)
      ? product.packagingUnits.map((unit) => ({
          name: unit.name || unit.unitName || '',
          qtyPerPrev: Number(unit.qtyPerPrev || 1),
          barcode: unit.barcode || '',
          priceLevel1: optionalPrice(unit.priceLevel1),
          priceLevel2: optionalPrice(unit.priceLevel2),
          priceLevel3: optionalPrice(unit.priceLevel3),
          priceLevel4: optionalPrice(unit.priceLevel4),
          priceLevel5: optionalPrice(unit.priceLevel5),
        })).filter((unit) => unit.name)
      : undefined,
    images: Array.isArray(product.images)
      ? product.images.map((image) => ({
          dataUrl: image.dataUrl,
          name: image.name || '',
          isCover: Boolean(image.isCover),
        })).filter((image) => image.dataUrl)
      : undefined,
    wholesalePrices: Array.isArray(product.wholesalePrices)
      ? product.wholesalePrices.map((price) => ({
          minQuantity: Number(price.minQuantity || 0),
          unitPrice: Number(price.unitPrice || 0),
        })).filter((price) => price.minQuantity > 0 && price.unitPrice > 0)
      : undefined,
    isBundle: Boolean(product.isBundle),
    bundleItems: product.isBundle && Array.isArray(product.bundleItems)
      ? product.bundleItems
          .map((item) => ({
            childProductId: item.childProductId,
            quantity: Number(item.quantity) || 1,
          }))
          .filter((item) => item.childProductId)
      : undefined,
  };
}

/** Low-stock threshold of a product (its own, else the store setting). */
export function lowStockThreshold(p: ProductRecord): number {
  return p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : getLowStockThreshold();
}

// ─── Form ─────────────────────────────────────────────────────────────
export const emptyPackagingUnit = (): PackagingUnitForm => ({
  name: "", qtyPerPrev: "", barcode: "", priceLevel1: "", priceLevel2: "", priceLevel3: "", priceLevel4: "", priceLevel5: "",
});

export const makeInitialForm = (): ProductForm => ({
  name: "",
  sku: generateEAN13(),
  unit: "",
  size: "",
  color: "",
  categoryId: "",
  stock: "0",              // จำนวนสต๊อกคงเหลือปัจจุบัน
  basePrice: "",           // ต้นทุนอ้างอิง (ถัวเฉลี่ยหรือค่าล่าสุด)
  minStockAlert: "",       // จำนวนสต๊อกเตือนใกล้หมด
  priceLevel1: "", priceLevel2: "", priceLevel3: "", priceLevel4: "", priceLevel5: "",
  barcodes: [{ barcode: "", supplierId: "", label: "" }],
  supplierEntries: [],
  packagingUnits: [],
  images: [],
  wholesaleSteps: Array.from({ length: 5 }, () => ({ minQuantity: "", unitPrice: "" })),
  defaultSellingUnitId: "",
  isBundle: false,
  bundleItems: [],
});

/** The edit form of an existing product. */
export function productToForm(p: ProductRecord): ProductForm {
  return {
    name: p.name || "", sku: p.sku || generateEAN13(), unit: p.unit || "",
    size: p.size || "", color: p.color || "", categoryId: p.categoryId || "",
    stock: (p.stock !== undefined && p.stock !== null ? p.stock : 0).toString(),
    // reference cost field (see handleSave): the product's cost, blank when the user cannot see costs
    basePrice: p.costPrice != null ? String(p.costPrice) : p.cost != null ? String(p.cost) : "",
    minStockAlert: p.minStockAlert !== undefined && p.minStockAlert !== null ? p.minStockAlert.toString() : String(getLowStockThreshold()),
    priceLevel1: p.priceLevel1?.toString() || "", priceLevel2: p.priceLevel2?.toString() || "",
    priceLevel3: p.priceLevel3?.toString() || "", priceLevel4: p.priceLevel4?.toString() || "",
    priceLevel5: p.priceLevel5?.toString() || "",
    barcodes: p.barcodes?.length
      ? p.barcodes.map((b) => {
          // a plain-string entry has no barcode/supplierId/label properties (as before: all blank)
          const o = typeof b === 'string' ? {} : b;
          return { barcode: o.barcode || "", supplierId: o.supplierId || "", label: o.label || "" };
        })
      : [{ barcode: "", supplierId: "", label: "" }],
    supplierEntries: [],
    packagingUnits: getProductPackagingUnits(p),
    images: getProductImages(p),
    wholesaleSteps: getProductWholesaleSteps(p),
    defaultSellingUnitId: p.defaultSellingUnitId || "",
    isBundle: Boolean(p.isBundle),
    bundleItems: Array.isArray(p.bundleItems)
      ? p.bundleItems.map((bi) => ({
          childProductId: bi.childProductId || bi.productId || "",
          quantity: Number(bi.quantity) || 1,
        }))
      : [],
  };
}
