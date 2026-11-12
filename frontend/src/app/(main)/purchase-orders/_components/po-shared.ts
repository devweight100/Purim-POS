import type { PoVatType } from '@shared/po-calc';
import { useProductStore } from '@/lib/store/product-store';

// Local shapes of the purchase-order API responses used by this page.
// (Candidates for lib/types.ts: PurchaseOrder, PurchaseOrderLine, PoSupplier.)

export type DiscountKind = 'baht' | 'percent';
export type BillVatMode = 'none' | 'include' | 'exclude';

export interface PoSupplier {
  id: string;
  name: string;
  phone?: string;
  contactName?: string;
  email?: string;
  address?: string;
  creditTerms?: number;
}

/** A line of a purchase order as returned by the server (or built locally after save). */
export interface PurchaseOrderLine {
  id?: string;
  purchaseOrderItemId?: string;
  productId?: string;
  name?: string;
  sku?: string;
  product?: { name?: string; sku?: string } | null;
  quantity: number;
  qty?: number;
  receivedQty?: number;
  receivedQuantity?: number;
  unitCost: number;
  cost?: number;
  price?: number;
  unitName?: string;
  unit?: string;
  baseUnit?: string;
  multiplier?: number;
  stock?: number;
  discountType?: DiscountKind;
  discountValue?: number;
  vatType?: string | null;
  vatRate?: number | string | null;
  vatAmount?: number;
  total?: number | null;
  imageUrl?: string | null;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  issuedAt?: string;
  supplierId?: string;
  supplier?: PoSupplier;
  supplierName?: string;
  totalAmount: number;
  subtotal?: number;
  subtotalAmount?: number;
  discountAmount?: number;
  discountType?: DiscountKind;
  discountValue?: number;
  billDiscountType?: DiscountKind;
  billDiscountValue?: number;
  vatType?: string;
  vatAmount?: number;
  netAmount?: number;
  paidAmount?: number;
  remainingPayable?: number;
  netAmountPayable?: number;
  deductedReturns?: Array<{ amount?: number | string }>;
  supplierInvoiceNo?: string;
  invoiceNo?: string;
  supplierInvoiceDate?: string;
  invoiceDate?: string;
  notes?: string;
  cancelReason?: string;
  items: PurchaseOrderLine[];
}

/** Line of the order table while creating / editing a PO. */
export interface PoCartItem {
  id?: string;
  cartKey?: string;
  productId: string;
  name: string;
  sku: string;
  stock?: number;
  baseUnit?: string;
  unitName?: string;
  multiplier?: number;
  unitCost: number;
  quantity: number;
  receivedQuantity?: number;
  discountType: DiscountKind;
  discountValue: number;
  vatType: PoVatType;
  vatRate: number;
  imageUrl?: string | null;
}

/** Line of the receive (GRN) dialog. */
export interface PoReceiveItem {
  id?: string;
  productId?: string;
  name: string;
  sku: string;
  unitName: string;
  multiplier: number;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  toReceive: number;
  currentStock: number;
  unitCost: number;
  imageUrl: string | null;
}

/** Anything whose purchase cost can be guessed (server product, PO line). */
export interface CostSource {
  unitCost?: unknown;
  lastCost?: unknown;
  costPrice?: unknown;
  cost?: unknown;
  supplierEntries?: Array<{ supplierId?: string; isPreferred?: boolean; lastCost?: unknown; unitCost?: unknown }>;
}

/** Product as used by the order table (a server product, or a PO line standing in for one). */
export interface PoProductLike extends CostSource {
  id: string;
  name: string;
  sku: string;
  stock?: number;
  unit?: string;
  imageUrl?: string | null;
  supplierId?: string | null;
  barcodes?: Array<{ barcode?: string; supplierId?: string }>;
  packagingUnits?: Array<{ name: string; qtyPerPrev: number | string }>;
}

/** What the image preview needs. */
export interface PreviewTarget {
  id?: string;
  productId?: string;
  name?: string;
  sku?: string;
  stock?: number;
  imageUrl?: string | null;
}

/** Default purchase cost of a product: its last purchase / reference cost, never the selling price. */
export function defaultUnitCost(product: CostSource | null | undefined): number {
  const preferred = Array.isArray(product?.supplierEntries) ? (product.supplierEntries.find((s) => s?.isPreferred) || product.supplierEntries[0]) : null;
  for (const v of [product?.unitCost, product?.lastCost, preferred?.lastCost, preferred?.unitCost, product?.costPrice, product?.cost]) {
    const n = Number(v);
    if (v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** VAT rate of a line: an explicit 0 stays 0, only a missing rate defaults to 7%. */
export function lineVatRate(v: unknown): number {
  if (v === undefined || v === null || v === '') return 7;
  const n = Number(v);
  return Number.isFinite(n) ? n : 7;
}

/** Product images from the server's product list (cover first). */
export function loadProductImages(productId: string): string[] {
  const product = (useProductStore.getState().products || []).find((p) => p.id === productId);
  const images = Array.isArray(product?.images) ? product.images.filter((i) => i?.dataUrl) : [];
  const cover = images.find((i) => i.isCover)?.dataUrl;
  const others = images.filter((i) => !i.isCover).map((i) => i.dataUrl);
  return cover ? [cover, ...others] : images.map((i) => i.dataUrl);
}

export const isBoundToSupplier = (product: PoProductLike, supplierId: string) => {
  if (!supplierId) return false;
  if (product.supplierId === supplierId) return true;
  if (Array.isArray(product.barcodes) && product.barcodes.some((b) => b.supplierId === supplierId)) return true;
  if (Array.isArray(product.supplierEntries) && product.supplierEntries.some((s) => s.supplierId === supplierId)) return true;
  return false;
};

export function getProductUnits(product: PoProductLike): { name: string; mult: number }[] {
  const baseUnit = product.unit || 'ชิ้น';
  const units = [{ name: baseUnit, mult: 1 }];
  // packaging units come with the product from the server
  const pkg = Array.isArray(product?.packagingUnits) ? product.packagingUnits : [];
  let currentMult = 1;
  pkg.forEach(u => {
    const q = parseFloat(String(u.qtyPerPrev)) || 1;
    currentMult = currentMult * q;
    if (u.name) units.push({ name: u.name, mult: currentMult });
  });
  return units;
}

/** Value of goods received so far, incl. each line's discounts and VAT (what the supplier can bill). */
export const receivedValue = (po: PurchaseOrder | null | undefined) =>
  Math.round(
    (po?.items || []).reduce((sum: number, i) => {
      const qty = Number(i.quantity) || 0;
      const perUnit = qty > 0 && i.total !== undefined && i.total !== null ? Number(i.total) / qty : Number(i.unitCost) || 0;
      return sum + (Number(i.receivedQty ?? i.receivedQuantity) || 0) * perUnit;
    }, 0) * 100,
  ) / 100;
