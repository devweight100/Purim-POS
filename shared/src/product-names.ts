/**
 * Product names (docs/product-names.md). A product has its shop name (`name`, ชื่อร้าน, always primary), an optional
 * manufacturer name (ชื่อผู้ผลิต) and, per supplier row, an optional supplier product name / code (the name and code
 * printed on that supplier's invoices). Used by the backend (validation, documents) and the frontend (search hints,
 * documents), so both sides apply the same rules.
 */

/** Longest accepted value of each name field (characters, after trimming). */
export const NAME_LIMITS = { manufacturerName: 200, supplierProductName: 200, supplierSku: 100 } as const;

export const NAME_LABELS = {
  manufacturerName: 'ชื่อผู้ผลิต',
  supplierProductName: 'ชื่อสินค้าของผู้ขาย',
  supplierSku: 'รหัสสินค้าของผู้ขาย',
} as const;

export type NameField = keyof typeof NAME_LIMITS;

/**
 * Trim a name field: blank = null, undefined stays undefined (PATCH: unchanged).
 * Returns the error text (Thai) when it is longer than its limit or not text.
 */
export function cleanNameField(value: unknown, field: NameField): { value: string | null | undefined; error?: string } {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: null };
  if (typeof value !== 'string' && typeof value !== 'number') return { value: null, error: `${NAME_LABELS[field]}ต้องเป็นข้อความ` };
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return { value: null };
  if (text.length > NAME_LIMITS[field]) {
    return { value: null, error: `${NAME_LABELS[field]}ยาวเกิน ${NAME_LIMITS[field]} ตัวอักษร` };
  }
  return { value: text };
}

// ─── Supplier documents: which name to print ───────────────────────────────────────────

/** SHOP = ชื่อร้าน; SUPPLIER = the supplier's own name / code, else ชื่อผู้ผลิต, else ชื่อร้าน. */
export type DocNameMode = 'SHOP' | 'SUPPLIER';
export const DOC_NAME_MODES: readonly DocNameMode[] = ['SHOP', 'SUPPLIER'];
export const DOC_NAME_MODE_LABELS: Record<DocNameMode, string> = { SHOP: 'ใช้ชื่อร้าน', SUPPLIER: 'ใช้ชื่อผู้ผลิต' };

export function isDocNameMode(value: unknown): value is DocNameMode {
  return value === 'SHOP' || value === 'SUPPLIER';
}

/** Any stored / sent value -> a mode (unknown = SHOP, as documents made before this feature). */
export function normDocNameMode(value: unknown): DocNameMode {
  return value === 'SUPPLIER' ? 'SUPPLIER' : 'SHOP';
}

/** A supplier row of a product as the various product shapes carry it. */
export interface SupplierNameRow {
  supplierId?: string | null;
  supplierProductName?: string | null;
  supplierSku?: string | null;
}

/** The parts of a product the name rules read (catalogue rows, full products, PO / return lines). */
export interface ProductNames {
  name?: string | null;
  sku?: string | null;
  manufacturerName?: string | null;
  supplierEntries?: SupplierNameRow[] | null;
  suppliers?: SupplierNameRow[] | null;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());

function supplierRows(p: ProductNames | null | undefined): SupplierNameRow[] {
  if (!p) return [];
  if (Array.isArray(p.supplierEntries) && p.supplierEntries.length) return p.supplierEntries;
  return Array.isArray(p.suppliers) ? p.suppliers : [];
}

export interface DocLineName {
  /** the name to print */
  name: string;
  /** the supplier's product code (SUPPLIER mode, when that supplier row has one), else null */
  code: string | null;
  /** where the name came from */
  source: 'supplier' | 'manufacturer' | 'shop';
}

/**
 * Name (and supplier code) of one line of a supplier document.
 * SHOP: the shop name. SUPPLIER: that supplier's product name / code for the product, else the manufacturer name,
 * else the shop name. `shopName` overrides the product's name (a line's own snapshot, e.g. return-note lines).
 */
export function docLineName(
  mode: DocNameMode | string | null | undefined,
  product: ProductNames | null | undefined,
  supplierId: string | null | undefined,
  shopName?: string | null,
): DocLineName {
  const shop = text(shopName) || text(product?.name) || 'สินค้า';
  if (normDocNameMode(mode) !== 'SUPPLIER' || !product) return { name: shop, code: null, source: 'shop' };
  const row = supplierId ? supplierRows(product).find((r) => r.supplierId === supplierId) : undefined;
  const code = text(row?.supplierSku) || null;
  const supplierName = text(row?.supplierProductName);
  if (supplierName) return { name: supplierName, code, source: 'supplier' };
  const manufacturer = text(product.manufacturerName);
  if (manufacturer) return { name: manufacturer, code, source: 'manufacturer' };
  return { name: shop, code, source: 'shop' };
}

// ─── Search: match the other names, and say which one matched ─────────────────────────

/** Words of a search text (lower case, split on spaces). */
export function searchWords(query: string | null | undefined): string[] {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** One of the product's non-shop names that contains `word` (lower case), as a small hint text. */
function otherNameHit(p: ProductNames, word: string): string | null {
  const manufacturer = text(p.manufacturerName);
  if (manufacturer && manufacturer.toLowerCase().includes(word)) return `ผู้ผลิต: ${manufacturer}`;
  for (const r of supplierRows(p)) {
    const n = text(r.supplierProductName);
    if (n && n.toLowerCase().includes(word)) return `ชื่อผู้ขาย: ${n}`;
  }
  for (const r of supplierRows(p)) {
    const c = text(r.supplierSku);
    if (c && c.toLowerCase().includes(word)) return `รหัสผู้ขาย: ${c}`;
  }
  return null;
}

/** True when the manufacturer name or a supplier product name / code contains the whole search text (any case). */
export function matchesOtherNames(p: ProductNames | null | undefined, query: string | null | undefined): boolean {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !p) return false;
  return otherNameHit(p, q) !== null;
}

/**
 * Small text for a search result whose match came from another name: "ผู้ผลิต: …", "ชื่อผู้ขาย: …" or
 * "รหัสผู้ขาย: …". Null when the shop name / SKU holds the search text (the result explains itself) or nothing
 * else matched. Works for a whole-text search and for every-word searches (the first word not in the shop name).
 */
export function searchMatchHint(p: ProductNames | null | undefined, query: string | null | undefined): string | null {
  if (!p) return null;
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const own = `${text(p.name)} ${text(p.sku)}`.toLowerCase();
  if (own.includes(q)) return null;
  const whole = otherNameHit(p, q);
  if (whole) return whole;
  for (const word of searchWords(q)) {
    if (own.includes(word)) continue;
    const hit = otherNameHit(p, word);
    if (hit) return hit;
  }
  return null;
}
