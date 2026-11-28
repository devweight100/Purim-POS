/**
 * Product supplier, cost & barcode Excel import / export rules (docs/product-supplier-excel.md).
 * Shared by the browser (template, export, file reading) and the server (preview + atomic import).
 */

import { cleanNameField } from './product-names';
import { round2 } from './money';

export const MAX_SUPPLIER_COST = 10_000_000;
export const MAX_BARCODE_LENGTH = 100;
export const MAX_SUPPLIERS_PER_IMPORT = 20_000;

export type SupplierImportKey =
  | 'systemId'
  | 'sku'
  | 'productName'
  | 'productBarcode'
  | 'supplierName'
  | 'supplierBarcodes'
  | 'unitCost'
  | 'supplierProductName'
  | 'supplierSku'
  | 'isPreferred'
  | 'command';

export type SupplierImportCostMode = 'zero_only' | 'average' | 'none';

export const SUPPLIER_COST_MODES: readonly SupplierImportCostMode[] = ['zero_only', 'average', 'none'] as const;

export const SUPPLIER_IMPORT_COLUMNS: {
  key: SupplierImportKey;
  header: string;
  aliases: string[];
  width: number;
  isText?: boolean;
  hint: string;
}[] = [
  {
    key: 'sku',
    header: 'รหัสสินค้า (SKU)',
    aliases: ['รหัสสินค้า', 'sku', 'productcode'],
    width: 18,
    isText: true,
    hint: 'ใช้จับคู่สินค้ากรณีไม่มีรหัสระบบ (เช่น กรอกเองจากไฟล์แม่แบบ)',
  },
  {
    key: 'productName',
    header: 'ชื่อสินค้า',
    aliases: ['ชื่อสินค้า(อ้างอิง)', 'ชื่อสินค้า(productname)', 'productname', 'name'],
    width: 34,
    hint: 'แสดงให้อ่านง่ายใน Excel เท่านั้น ไม่นำไปแก้ทับชื่อสินค้าหลักในระบบ',
  },
  {
    key: 'productBarcode',
    header: 'บาร์โค้ดหลักสินค้า',
    aliases: ['บาร์โค้ดหลัก', 'บาร์โค้ดสินค้า', 'productbarcode'],
    width: 20,
    isText: true,
    hint: 'ใช้อ้างอิง หรือช่วยจับคู่สินค้ากรณีไม่ได้ใส่รหัสระบบและไม่ได้ใส่ SKU',
  },
  {
    key: 'supplierName',
    header: 'ชื่อผู้จำหน่าย',
    aliases: ['ผู้จำหน่าย', 'บริษัทผู้จำหน่าย', 'ซัพพลายเออร์', 'supplier', 'suppliername'],
    width: 30,
    hint: 'ชื่อบริษัทผู้จำหน่าย (ถ้ายังไม่มีในระบบ ระบบจะแจ้งเตือนและสร้างให้เมื่อกดยืนยันนำเข้า)',
  },
  {
    key: 'supplierBarcodes',
    header: 'บาร์โค้ดของผู้จำหน่ายนี้',
    aliases: ['บาร์โค้ดผู้จำหน่าย', 'บาร์โค้ดแต่ละผู้จำหน่าย', 'บาร์โค้ด', 'supplierbarcode', 'supplierbarcodes', 'barcodes'],
    width: 28,
    isText: true,
    hint: 'บาร์โค้ดจากผู้จำหน่ายรายนี้ มีหลายเลขคั่นด้วยจุลภาค (,) สแกนขายที่หน้าร้านได้ทันที (เว้นว่าง = คงค่าเดิม)',
  },
  {
    key: 'unitCost',
    header: 'ต้นทุนต่อหน่วย',
    aliases: ['ต้นทุน', 'ต้นทุน/ชิ้น', 'ต้นทุนต่อชิ้น', 'ราคาทุน', 'unitcost', 'cost'],
    width: 15,
    hint: 'ต้นทุนซื้อต่อ 1 หน่วยเล็กสุด (บาท) เว้นว่าง = คงต้นทุนเดิมของผู้จำหน่ายรายนี้',
  },
  {
    key: 'supplierProductName',
    header: 'ชื่อสินค้าของผู้ขาย',
    aliases: ['ชื่อตามบิลผู้ขาย', 'supplierproductname'],
    width: 28,
    hint: 'ไม่บังคับ (สูงสุด 200 ตัวอักษร) ใช้ค้นหาและพิมพ์ในใบสั่งซื้อโหมดชื่อผู้ขาย',
  },
  {
    key: 'supplierSku',
    header: 'รหัสสินค้าของผู้ขาย',
    aliases: ['รหัสผู้ขาย', 'รหัสตามบิลผู้ขาย', 'suppliersku'],
    width: 18,
    isText: true,
    hint: 'ไม่บังคับ (สูงสุด 100 ตัวอักษร)',
  },
  {
    key: 'isPreferred',
    header: 'ผู้จำหน่ายหลัก',
    aliases: ['เจ้าหลัก', 'ispreferred', 'preferred'],
    width: 14,
    hint: 'ใส่ "ใช่" หากต้องการตั้งเป็นผู้จำหน่ายหลักของสินค้านี้ (ไม่บังคับ)',
  },
  {
    key: 'command',
    header: 'คำสั่ง',
    aliases: ['action', 'command', 'สถานะคำสั่ง'],
    width: 12,
    hint: 'เว้นว่าง = เพิ่ม/แก้ไขปกติ · พิมพ์ "ลบ" = ถอดผู้จำหน่ายรายนี้ออกจากสินค้า',
  },
  {
    key: 'systemId',
    header: 'รหัสระบบ (ห้ามแก้ไข)',
    aliases: ['รหัสระบบ', 'รหัสระบบ(systemid-ห้ามแก้ไข)', 'systemid', 'id'],
    width: 38,
    isText: true,
    hint: 'ติดมากับไฟล์ที่ส่งออกจากระบบ ใช้จับคู่สินค้าแม่นยำที่สุดแม้มีการเปลี่ยนรหัส SKU ภายหลัง (สินค้ากรอกมือเว้นว่างได้)',
  },
];

export const SUPPLIER_SHEET_NAME = 'ผู้จำหน่ายสินค้า';
export const SUPPLIER_REF_SHEET_NAME = 'รายชื่อผู้จำหน่าย';

const normHeader = (h: unknown) =>
  String(h ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

/** Header text in spreadsheet -> SupplierImportKey, or null when unrecognized. */
export function supplierImportColumnOf(header: unknown): SupplierImportKey | null {
  const h = normHeader(header);
  if (!h) return null;
  for (const col of SUPPLIER_IMPORT_COLUMNS) {
    if (normHeader(col.header) === h || col.aliases.some((a) => normHeader(a) === h)) {
      return col.key;
    }
  }
  return null;
}

/**
 * Normalize a single barcode / identifier text:
 * - strips leading apostrophes/quotes/BOM and inner whitespace
 * - expands Excel scientific notation like `8.85871E+12` -> `'8858710000000'`
 */
export function normalizeBarcodeCode(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    if (Number.isSafeInteger(value)) return String(value);
  }
  const raw = String(value).trim();
  if (!raw) return '';
  const cleaned = raw
    .replace(/^\uFEFF/, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, '');
  if (!cleaned) return '';
  if (!/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(cleaned)) return cleaned;

  const match = cleaned.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return cleaned;
  const sign = match[1] === '-' ? '-' : '';
  const intPart = match[2] || '';
  const fracPart = match[3] || '';
  const exponent = parseInt(match[4], 10);
  if (!Number.isFinite(exponent)) return cleaned;
  const digits = intPart + fracPart;
  const decimalIndex = intPart.length + exponent;
  if (decimalIndex <= 0) {
    return `${sign}0.${'0'.repeat(Math.abs(decimalIndex))}${digits}`.replace(/\.?0+$/, '');
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`.replace(/\.?0+$/, '');
}

/** Split comma / semicolon / newline barcode text (or array) into unique normalized barcode strings. */
export function splitBarcodeList(value: unknown): string[] {
  const parts: unknown[] = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[,;\n]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const code = normalizeBarcodeCode(part);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

export interface SupplierImportRawRow {
  rowNo: number;
  values: Partial<Record<SupplierImportKey, string>>;
}

export interface ParsedSupplierImportRow {
  systemId?: string;
  sku?: string;
  productName?: string;
  productBarcode?: string;
  supplierName?: string;
  /** undefined = cell left blank (keep existing barcodes); string[] = explicit barcodes */
  supplierBarcodes?: string[];
  unitCost?: number;
  supplierProductName?: string;
  supplierSku?: string;
  isPreferred?: boolean;
  command: 'upsert' | 'delete';
  /** true when supplierName & cost & command are all blank (e.g. an untouched unlinked product row from export) */
  skipBlankSupplier?: boolean;
}

const YES_VALUES = new Set(['ใช่', 'yes', 'y', 'true', '1', 'หลัก', 'ผู้จำหน่ายหลัก']);
const NO_VALUES = new Set(['ไม่ใช่', 'no', 'n', 'false', '0', '-']);
const DELETE_VALUES = new Set(['ลบ', 'delete', 'remove', 'del', 'ยกเลิก']);
const UPSERT_VALUES = new Set(['', 'เพิ่ม', 'แก้ไข', 'บันทึก', 'upsert', 'add', 'update']);

/** Validate and normalize one spreadsheet row (no DB needed). */
export function parseSupplierImportRow(row: SupplierImportRawRow): {
  data: ParsedSupplierImportRow;
  errors: string[];
} {
  const v = row.values || {};
  const errors: string[] = [];
  const trim = (k: SupplierImportKey) => String(v[k] ?? '').replace(/^\uFEFF/, '').trim();

  const systemId = trim('systemId') || undefined;
  const skuRaw = trim('sku');
  const sku = skuRaw ? normalizeBarcodeCode(skuRaw) || skuRaw : undefined;
  const productName = trim('productName').replace(/\s+/g, ' ') || undefined;
  const productBarcodeRaw = trim('productBarcode');
  const productBarcode = productBarcodeRaw ? splitBarcodeList(productBarcodeRaw)[0] : undefined;

  if (sku && sku.length > 64) {
    errors.push('รหัสสินค้า (SKU) ยาวเกิน 64 ตัวอักษร');
  }
  if (!systemId && !sku && !productBarcode) {
    errors.push('ต้องระบุ รหัสระบบ, รหัสสินค้า (SKU) หรือ บาร์โค้ดหลักสินค้า อย่างน้อย 1 ช่องเพื่ออ้างอิงสินค้า');
  }

  const supplierName = trim('supplierName').replace(/\s+/g, ' ') || undefined;
  if (supplierName && supplierName.length > 200) {
    errors.push('ชื่อผู้จำหน่ายยาวเกิน 200 ตัวอักษร');
  }

  const cmdText = trim('command').toLowerCase();
  let command: 'upsert' | 'delete' = 'upsert';
  if (DELETE_VALUES.has(cmdText)) {
    command = 'delete';
  } else if (!UPSERT_VALUES.has(cmdText)) {
    errors.push(`คำสั่ง "${trim('command')}" ไม่ถูกต้อง (เว้นว่าง หรือพิมพ์ "ลบ")`);
  }

  const rawSupplierBarcodes = trim('supplierBarcodes');
  let supplierBarcodes: string[] | undefined;
  if (rawSupplierBarcodes) {
    const codes = splitBarcodeList(rawSupplierBarcodes);
    const tooLong = codes.find((c) => c.length > MAX_BARCODE_LENGTH);
    if (tooLong) {
      errors.push(`บาร์โค้ด "${tooLong.slice(0, 24)}…" ยาวเกิน ${MAX_BARCODE_LENGTH} ตัวอักษร`);
    }
    supplierBarcodes = codes;
  }

  const costRaw = trim('unitCost');
  let unitCost: number | undefined;
  if (costRaw) {
    const n = Number(costRaw.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > MAX_SUPPLIER_COST) {
      errors.push(`ต้นทุนต่อหน่วย "${costRaw}" ต้องเป็นตัวเลขตั้งแต่ 0 ถึง ${MAX_SUPPLIER_COST.toLocaleString('en-US')}`);
    } else if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
      errors.push(`ต้นทุนต่อหน่วย "${costRaw}" มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง`);
    } else {
      unitCost = round2(n);
    }
  }

  let supplierProductName: string | undefined;
  if (trim('supplierProductName')) {
    const r = cleanNameField(trim('supplierProductName'), 'supplierProductName');
    if (r.error) errors.push(r.error);
    else if (r.value) supplierProductName = r.value;
  }

  let supplierSku: string | undefined;
  if (trim('supplierSku')) {
    const r = cleanNameField(trim('supplierSku'), 'supplierSku');
    if (r.error) errors.push(r.error);
    else if (r.value) supplierSku = r.value;
  }

  const prefRaw = trim('isPreferred').toLowerCase();
  let isPreferred: boolean | undefined;
  if (prefRaw) {
    if (YES_VALUES.has(prefRaw)) isPreferred = true;
    else if (NO_VALUES.has(prefRaw)) isPreferred = false;
    else errors.push(`ช่องผู้จำหน่ายหลัก "${trim('isPreferred')}" ไม่ถูกต้อง (ใส่ "ใช่" หรือเว้นว่าง)`);
  }

  // Exported files with "รวมสินค้าที่ยังไม่มีผู้จำหน่าย" contain rows with product info (and possibly unassigned barcodes)
  // but blank supplierName. If the user left supplierName, cost, supplier names, preferred, and command all blank,
  // treat that row as untouched ("unchanged") so they don't have to manually delete unedited rows before re-importing.
  const hasSupplierEdits =
    unitCost !== undefined ||
    supplierProductName !== undefined ||
    supplierSku !== undefined ||
    isPreferred !== undefined ||
    command === 'delete';

  let skipBlankSupplier = false;
  if (!supplierName) {
    if (hasSupplierEdits) {
      errors.push('กรุณาระบุชื่อผู้จำหน่าย');
    } else {
      skipBlankSupplier = true;
    }
  }

  return {
    data: {
      ...(systemId ? { systemId } : {}),
      ...(sku ? { sku } : {}),
      ...(productName ? { productName } : {}),
      ...(productBarcode ? { productBarcode } : {}),
      ...(supplierName ? { supplierName } : {}),
      ...(supplierBarcodes !== undefined ? { supplierBarcodes } : {}),
      ...(unitCost !== undefined ? { unitCost } : {}),
      ...(supplierProductName !== undefined ? { supplierProductName } : {}),
      ...(supplierSku !== undefined ? { supplierSku } : {}),
      ...(isPreferred !== undefined ? { isPreferred } : {}),
      command,
      ...(skipBlankSupplier ? { skipBlankSupplier: true } : {}),
    },
    errors,
  };
}

/** Average of positive supplier costs (rounded to 2 decimals), or null when no supplier has a positive cost. */
export function computeAverageSupplierCost(costs: ReadonlyArray<number | string | null | undefined>): number | null {
  const valid: number[] = [];
  for (const raw of costs) {
    if (raw === null || raw === undefined || raw === '') continue;
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
    if (Number.isFinite(n) && n > 0) valid.push(n);
  }
  if (valid.length === 0) return null;
  return round2(valid.reduce((sum, c) => sum + c, 0) / valid.length);
}
