import { Prisma } from '@prisma/client';
import { qn } from '../common/qty';

/**
 * POS catalogue rows (GET /products, GET /products/sync): everything the POS, the products page, purchase
 * orders and claims read from the product list, without the heavy parts of the full product
 * (GET /products/:id): no stock batch arrays (stock comes from one SQL sum), no base64 photos (photo
 * metadata + URL of GET /product-images/:id), slim supplier / bundle child objects.
 */

export const productImageUrl = (id: string, size?: 'thumb') =>
  `/api/product-images/${encodeURIComponent(id)}${size ? `?size=${size}` : ''}`;

/**
 * Fields of a catalogue row before toCatalogRow (as a Prisma select, for the type). ProductsService.catalogRows
 * builds exactly these with one SQL statement (e2e compares them with GET /products/:id).
 */
export const catalogSelect = {
  id: true,
  name: true,
  description: true,
  sku: true,
  categoryId: true,
  basePrice: true,
  costPrice: true,
  priceLevel1: true,
  priceLevel2: true,
  priceLevel3: true,
  priceLevel4: true,
  priceLevel5: true,
  unit: true,
  imageUrl: true,
  isBundle: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  barcodes: { select: { barcode: true, label: true } },
  packagingUnits: { orderBy: { sortOrder: 'asc' as const } },
  images: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, name: true, isCover: true, sortOrder: true } },
  wholesalePrices: { orderBy: { sortOrder: 'asc' as const } },
  category: true,
  suppliers: {
    select: {
      id: true,
      supplierId: true,
      supplierSku: true,
      unitCost: true,
      isPreferred: true,
      supplier: { select: { id: true, name: true } },
    },
    orderBy: [{ isPreferred: 'desc' as const }, { createdAt: 'asc' as const }],
  },
  bundleItems: {
    select: {
      id: true,
      childProductId: true,
      quantity: true,
      childProduct: { select: { id: true, name: true, sku: true, unit: true, basePrice: true, priceLevel1: true } },
    },
  },
} satisfies Prisma.ProductSelect;

export type CatalogProduct = Prisma.ProductGetPayload<{ select: typeof catalogSelect }>;

/**
 * Stock of a product as the full product (mapProductWithStock) computes it: the sum of its batches, or
 * for a bundle with items the number of complete sets its children's stock allows.
 * `stockOf` = remaining quantity per product id (products without batches are missing = 0).
 */
export function catalogStock(
  product: { id: string; isBundle: boolean; bundleItems: { childProductId: string; quantity: unknown }[] },
  stockOf: Map<string, number>,
): number {
  if (product.isBundle && product.bundleItems.length > 0) {
    return Math.min(
      ...product.bundleItems.map((bi) => {
        const childStock = stockOf.get(bi.childProductId) || 0;
        const requiredPerSet = qn(bi.quantity as any) || 1;
        return Math.floor(childStock / requiredPerSet + 1e-9);
      }),
    );
  }
  return stockOf.get(product.id) || 0;
}

/** Catalogue row: the product plus stock, photo URLs and supplier entries (same fields as the full product's mapping). */
export function toCatalogRow(product: CatalogProduct, stockOf: Map<string, number>) {
  const stock = catalogStock(product, stockOf);
  const supplierEntries = product.suppliers.map((ps) => {
    const unitCostNum = ps.unitCost !== null && ps.unitCost !== undefined ? Number(ps.unitCost) : Number(product.costPrice || 0);
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
  const preferredSupplier = supplierEntries.find((s) => s.isPreferred) || supplierEntries[0] || null;
  return {
    ...product,
    images: product.images.map((img) => ({ ...img, url: productImageUrl(img.id), thumbUrl: productImageUrl(img.id, 'thumb') })),
    computedStock: stock,
    stock,
    supplierEntries,
    supplierId: preferredSupplier?.supplierId || null,
  };
}

export type CatalogRow = ReturnType<typeof toCatalogRow>;

// ─── Delta sync cursor ────────────────────────────────────────────────────────────────

/** A cursor older than this is not trusted (the change log keeps CHANGE_LOG_KEEP_MS): the client reloads everything. */
export const CURSOR_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
export const CHANGE_LOG_KEEP_MS = 14 * 24 * 3600 * 1000;

const SNAPSHOT_RE = /^(\d{1,20}):(\d{1,20}):((?:\d{1,20})(?:,\d{1,20})*)?$/;

export interface SyncCursor {
  /** database oid + change-log table oid: a restored / recreated database never matches an old cursor */
  epoch: string;
  /** server time the cursor was issued (ms) */
  at: number;
  /** pg_current_snapshot() text of the read that produced the client's data */
  snapshot: string;
}

export function encodeCursor(c: SyncCursor): string {
  return `v1.${c.epoch}.${c.at}.${Buffer.from(c.snapshot, 'utf8').toString('base64url')}`;
}

/** Parsed cursor, or null when it is missing / malformed (the client then gets a full reload). */
export function decodeCursor(text: unknown): SyncCursor | null {
  if (typeof text !== 'string' || text.length > 4000) return null;
  const m = /^v1\.(\d+-\d+)\.(\d{1,15})\.([A-Za-z0-9_-]+)$/.exec(text);
  if (!m) return null;
  const snapshot = Buffer.from(m[3], 'base64url').toString('utf8');
  const s = SNAPSHOT_RE.exec(snapshot);
  if (!s) return null;
  if (BigInt(s[1]) > BigInt(s[2])) return null;
  return { epoch: m[1], at: Number(m[2]), snapshot };
}

/** True when the cursor can be used for a delta at `now` in database `epoch`. */
export function cursorUsable(c: SyncCursor | null, epoch: string, now: number): c is SyncCursor {
  return !!c && c.epoch === epoch && c.at <= now + 60_000 && now - c.at <= CURSOR_MAX_AGE_MS;
}

// ─── Photos ───────────────────────────────────────────────────────────────────────────

const IMAGE_DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

/** Decoded photo of a data URL (only png / jpeg / webp / gif base64 data URLs; anything else = null). */
export function decodeImageDataUrl(dataUrl: string | null | undefined): { contentType: string; body: Buffer } | null {
  if (!dataUrl) return null;
  const m = IMAGE_DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  const body = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!body.length) return null;
  return { contentType: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], body };
}

/** Largest thumbnail data URL accepted (the browser sends a ~240 px JPEG of a few kB). */
export const MAX_THUMB_DATA_URL = 300_000;

/** Thumbnail sent with a photo: kept only when it is a valid image data URL of a sane size. */
export function cleanThumb(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_THUMB_DATA_URL) return null;
  return decodeImageDataUrl(value) ? value : null;
}
