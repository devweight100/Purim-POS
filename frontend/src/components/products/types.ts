// Local types for the products page (/products). Kept here instead of lib/types.ts:
// the server returns more shapes than lib's Product describes (legacy field names, Decimal strings).
import type { ImportPackUnit } from '@/lib/product-import';

export type PriceLevelKey = 'priceLevel1' | 'priceLevel2' | 'priceLevel3' | 'priceLevel4' | 'priceLevel5';
export const PRICE_LEVELS = [1, 2, 3, 4, 5] as const;
export const priceLevelKey = (n: number) => `priceLevel${n}` as PriceLevelKey;

type Num = number | string | null;

/** A product as the page handles it: from the server (lib Product) or just saved from the form. */
export interface ProductRecord {
  id: string;
  name: string;
  sku: string;
  unit?: string;
  categoryId?: string;
  category?: string | { name?: string } | null;
  size?: string;
  color?: string;
  stock?: number;
  computedStock?: number;
  minStockAlert?: number | null;
  basePrice?: Num;
  costPrice?: Num;
  cost?: Num;
  price?: Num;
  priceLevel1?: Num;
  priceLevel2?: Num;
  priceLevel3?: Num;
  priceLevel4?: Num;
  priceLevel5?: Num;
  barcode?: string | null;
  customBarcodeId?: string | null;
  barcodeForSelling?: string | null;
  barcodes?: Array<string | { barcode?: string; supplierId?: string; label?: string }>;
  units?: Array<{ barcode?: string | null }>;
  packagingUnits?: Array<{
    name?: string;
    unitName?: string;
    qtyPerPrev?: number | string;
    factor?: number;
    barcode?: string | null;
    priceLevel1?: Num;
    priceLevel2?: Num;
    priceLevel3?: Num;
    priceLevel4?: Num;
    priceLevel5?: Num;
  }>;
  images?: Array<{ id?: string; dataUrl?: string; name?: string; isCover?: boolean }>;
  wholesalePrices?: Array<{ minQuantity?: number | string | null; unitPrice?: number | string | null }>;
  isBundle?: boolean;
  bundleItems?: Array<{ childProductId?: string; productId?: string; quantity?: number | string }>;
  supplierId?: string | null;
  supplierEntries?: Array<{ supplierId?: string }>;
  imageUrl?: string | null;
  defaultSellingUnitId?: string | null;
}

export interface CategoryOption {
  id: string;
  name: string;
  icon?: string;
}

export interface SupplierOption {
  id: string;
  name: string;
}

// ─── Form ─────────────────────────────────────────────────────────────
export interface ProductImageItem {
  id: string;
  dataUrl: string; // base64 compressed JPEG
  name: string;
  isCover: boolean;
}

export interface ProductBarcodeForm {
  barcode: string;
  supplierId?: string;
  label?: string; // เช่น "บาร์โค้ดจาก บ.นิวยอร์ค", "บาร์โค้ดผู้ผลิตจีน"
}

export interface ProductSupplierEntry {
  supplierId: string;
  lastCost: string; // ต้นทุนซื้อล่าสุดจากผู้จำหน่ายนี้
  notes: string;
}

export interface PackagingUnitForm {
  name: string;
  qtyPerPrev: string;
  barcode: string;
  priceLevel1: string;
  priceLevel2: string;
  priceLevel3: string;
  priceLevel4: string;
  priceLevel5: string;
}

export interface WholesaleStepForm {
  minQuantity: string;
  unitPrice: string;
}

export interface BundleItemForm {
  childProductId: string;
  quantity: number | string;
}

export interface ProductForm {
  name: string;
  sku: string;
  unit: string;
  size: string;
  color: string;
  categoryId: string;
  stock: string; // จำนวนสต๊อกคงเหลือปัจจุบัน
  basePrice: string; // ต้นทุนอ้างอิง (ถัวเฉลี่ยหรือค่าล่าสุด)
  minStockAlert: string; // จำนวนสต๊อกเตือนใกล้หมด
  priceLevel1: string;
  priceLevel2: string;
  priceLevel3: string;
  priceLevel4: string;
  priceLevel5: string;
  barcodes: ProductBarcodeForm[];
  supplierEntries: ProductSupplierEntry[];
  packagingUnits: PackagingUnitForm[];
  images: ProductImageItem[];
  wholesaleSteps: WholesaleStepForm[];
  defaultSellingUnitId: string;
  isBundle: boolean;
  bundleItems: BundleItemForm[];
}

export type UpdateForm = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) => void;
export type SetForm = (updater: (prev: ProductForm) => ProductForm) => void;

// ─── Table ────────────────────────────────────────────────────────────
export type SortKey = 'name' | 'stock' | 'basePrice' | PriceLevelKey;
export type SortDir = 'asc' | 'desc';
export type StockFilter = 'all' | 'low' | 'out';

// ─── Import preview ───────────────────────────────────────────────────
export type ImportChangeType = 'NEW' | 'CHANGED' | 'UNCHANGED';
export type ImportFilterTab = 'all' | 'changed' | 'new' | 'unchanged';
/** number, or non-numeric text passed through so the server rejects the row with its row number */
export type ImportCell = number | string | undefined;

export interface ImportPreviewRow {
  rowNo: number;
  packagingUnits?: ImportPackUnit[];
  barcodes?: string[];
  stockNote?: string;
  id?: string;
  sku: string;
  name: string;
  barcode: string;
  categoryName?: string;
  unit?: string;
  costPrice: ImportCell;
  retailPrice: ImportCell;
  priceLevel1: ImportCell;
  priceLevel2: ImportCell;
  priceLevel3: ImportCell;
  priceLevel4: ImportCell;
  priceLevel5: ImportCell;
  stock: ImportCell;
  minStockAlert: number;
  description: string;
  isExisting: boolean;
  changeType: ImportChangeType;
  diffs: string[];
}
