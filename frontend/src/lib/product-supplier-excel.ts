/**
 * Excel (.xlsx) & CSV template, export, and reader for product suppliers, costs, and supplier barcodes
 * (docs/product-supplier-excel.md).
 *
 * Every exported row carries `รหัสระบบ (ห้ามแก้ไข)` (product.id), the permanent system ID, so editing SKUs or
 * barcodes later never breaks matching when the file is imported back.
 */

import type * as XLSXType from 'xlsx';
import {
  normalizeBarcodeCode,
  SUPPLIER_IMPORT_COLUMNS,
  SUPPLIER_REF_SHEET_NAME,
  SUPPLIER_SHEET_NAME,
  supplierImportColumnOf,
  type SupplierImportKey,
  type SupplierImportRawRow,
} from '@shared/product-supplier-import';
import type { ProductRecord, SupplierOption } from '@/components/products/types';
import { getBaseProductBarcodes, normalizeKey } from '@/components/products/product-helpers';

type XLSXLib = typeof XLSXType;

const HEADER_ORDER = SUPPLIER_IMPORT_COLUMNS.map((c) => c.header);

function formatTextColumns(XLSX: XLSXLib, ws: XLSXType.WorkSheet, rowCount: number) {
  const totalRows = Math.max(rowCount, 300);
  SUPPLIER_IMPORT_COLUMNS.forEach((col, cIdx) => {
    if (!col.isText) return;
    for (let r = 1; r <= totalRows; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: cIdx });
      const existing = ws[ref];
      if (existing) {
        existing.t = 's';
        existing.v = String(existing.v ?? '');
        existing.z = '@';
      } else {
        ws[ref] = { t: 's', v: '', z: '@' };
      }
    }
  });
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: totalRows, c: HEADER_ORDER.length - 1 },
  });
  ws['!cols'] = SUPPLIER_IMPORT_COLUMNS.map((c) => ({ wch: c.width }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
}

function buildHowToSheet(XLSX: XLSXLib): XLSXType.WorkSheet {
  const lines: string[][] = [
    ['วิธีกรอกไฟล์จัดการผู้จำหน่าย ต้นทุน และบาร์โค้ดแต่ละผู้จำหน่าย (1 แถว = 1 สินค้า ต่อ 1 ผู้จำหน่าย)'],
    [''],
    ['1. การจับคู่สินค้า (เรียงตามความสำคัญ):'],
    ['   - ถ้านำไฟล์ที่ "ส่งออกจากระบบ" มาแก้: ระบบใช้ช่อง "รหัสระบบ (ห้ามแก้ไข)" อ้างอิงสินค้าตัวเดิมแม่นยำ 100% แม้จะมีการเปลี่ยนรหัส SKU ภายหลัง'],
    ['   - ถ้าพิมพ์เพิ่มเองในไฟล์แม่แบบ (ช่องรหัสระบบว่าง): ระบบจับคู่จาก "รหัสสินค้า (SKU)" ก่อน ถ้าว่างจึงจับคู่จาก "บาร์โค้ดหลักสินค้า"'],
    ['2. สินค้า 1 ตัว มีผู้จำหน่ายหลายรายได้: ให้เพิ่มแถวใหม่โดยใช้ รหัสระบบ / รหัสสินค้า เดียวกัน แล้วใส่ชื่อผู้จำหน่ายคนละราย'],
    ['3. ชื่อผู้จำหน่าย: ดูรายชื่อที่มีในร้านได้จากแผ่นงาน "รายชื่อผู้จำหน่าย" หากพิมพ์ชื่อบริษัทใหม่ที่ยังไม่มีในระบบ หน้าตรวจสอบก่อนนำเข้าจะขึ้นป้ายเตือนและสร้างผู้จำหน่ายใหม่ให้อัตโนมัติเมื่อกดยืนยัน'],
    ['4. บาร์โค้ดของผู้จำหน่ายนี้: สแกนขายที่หน้าร้านได้ทันทีเหมือนบาร์โค้ดหลัก หากผู้จำหน่ายรายเดียวมีหลายบาร์โค้ดให้คั่นด้วยเครื่องหมายจุลภาค (,)'],
    ['   - หากผู้จำหน่าย 2 เจ้า ส่งสินค้าที่ใช้บาร์โค้ดโรงงานเลขเดียวกันในสินค้าตัวเดียวกัน สามารถใส่เลขเดียวกันได้ทั้ง 2 แถว (แต่ห้ามซ้ำกับสินค้าตัวอื่น)'],
    ['5. ต้นทุนต่อหน่วย: เป็นต้นทุนซื้อต่อ 1 หน่วยเล็กสุดของสินค้า (เว้นว่าง = คงต้นทุนเดิมของผู้จำหน่ายรายนี้)'],
    ['6. โหมดอัปเดตปลอดภัย: ระบบเพิ่มหรือแก้ไขเฉพาะผู้จำหน่ายที่อยู่ในไฟล์ ไม่ลบผู้จำหน่ายเจ้าอื่นของสินค้านั้นทิ้ง'],
    ['   - หากต้องการถอดผู้จำหน่ายรายใดออกจากสินค้า ให้พิมพ์คำว่า "ลบ" ในช่อง "คำสั่ง"'],
    ['   - แถวสินค้าที่เว้นว่างช่อง "ชื่อผู้จำหน่าย" (เช่น จากไฟล์ที่ส่งออกสินค้าทั้งหมดมาเพื่อเลือกกรอกบางตัว) ระบบจะข้ามให้โดยไม่ฟ้องผิดพลาด'],
    [''],
    ['รายละเอียดแต่ละคอลัมน์:'],
    ...SUPPLIER_IMPORT_COLUMNS.map((c) => [`• ${c.header}`, c.hint]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(lines);
  ws['!cols'] = [{ wch: 36 }, { wch: 95 }];
  return ws;
}

function buildSupplierReferenceSheet(XLSX: XLSXLib, suppliers: SupplierOption[]): XLSXType.WorkSheet {
  const rows = [
    ['รายชื่อผู้จำหน่ายที่มีในระบบปัจจุบัน (คัดลอกไปวางในช่อง "ชื่อผู้จำหน่าย" เพื่อลดการสะกดผิด)'],
    ['ชื่อผู้จำหน่าย'],
    ...(suppliers.length > 0
      ? suppliers.map((s) => [s.name])
      : [['(ยังไม่มีผู้จำหน่ายในระบบ — สามารถพิมพ์ชื่อบริษัทใหม่ในแผ่นงานแรกได้เลย)']]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 48 }];
  return ws;
}

function rowRecord(values: Partial<Record<SupplierImportKey, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of SUPPLIER_IMPORT_COLUMNS) {
    out[col.header] = values[col.key] ?? '';
  }
  return out;
}

/** Build a sample template workbook (.xlsx) with example rows, shop supplier reference list, and Thai how-to sheet. */
export function buildSupplierTemplateWorkbook(XLSX: XLSXLib, suppliers: SupplierOption[] = []) {
  const sampleSup1 = suppliers[0]?.name || 'บริษัท สยามทอยส์ อิมพอร์ต จำกัด';
  const sampleSup2 = suppliers[1]?.name || 'หจก. เจริญการค้า ฮาร์ดแวร์';

  const examples = [
    rowRecord({
      sku: 'DRK-001',
      productName: 'น้ำดื่มตราช้าง 600 มล. (ตัวอย่าง)',
      productBarcode: '8850001111111',
      supplierName: sampleSup1,
      supplierBarcodes: '8850001111111',
      unitCost: 4.5,
      supplierProductName: 'น้ำดื่มช้าง 600ml',
      supplierSku: 'SUP-CH600',
      isPreferred: 'ใช่',
    }),
    rowRecord({
      sku: 'DRK-001',
      productName: 'น้ำดื่มตราช้าง 600 มล. (ตัวอย่างผู้จำหน่ายที่ 2)',
      productBarcode: '8850001111111',
      supplierName: sampleSup2,
      supplierBarcodes: '8850001111111, 6900009998887',
      unitCost: 4.35,
      supplierProductName: 'ช้าง 600 มล.',
      supplierSku: 'HW-DRK01',
    }),
  ];

  const ws = XLSX.utils.json_to_sheet(examples, { header: HEADER_ORDER });
  formatTextColumns(XLSX, ws, examples.length + 20);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SUPPLIER_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, buildSupplierReferenceSheet(XLSX, suppliers), SUPPLIER_REF_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, buildHowToSheet(XLSX), 'วิธีกรอก');
  return wb;
}

/**
 * Build an export workbook (.xlsx) of current product-supplier links (and optionally unlinked products / unassigned
 * barcodes so the owner can fill in suppliers & costs directly in Excel and import back using `รหัสระบบ (ห้ามแก้ไข)`).
 */
export function buildSupplierExportWorkbook(
  XLSX: XLSXLib,
  products: ProductRecord[],
  suppliers: SupplierOption[],
  opts: { withCost: boolean; includeUnlinked: boolean },
) {
  const rows: Record<string, unknown>[] = [];
  const numCell = (v: unknown) => (v === undefined || v === null || v === '' ? '' : Number(v));

  for (const p of products) {
    const baseCodes = getBaseProductBarcodes(p);
    const mainBarcode = baseCodes[0] || '';
    const entries = Array.isArray(p.supplierEntries) ? p.supplierEntries.filter((e) => e && e.supplierId) : [];

    const assignedKeys = new Set(
      entries.flatMap((e) => (Array.isArray(e.barcodes) ? e.barcodes.map((b) => normalizeKey(b)).filter(Boolean) : [])),
    );
    const unassignedCodes = baseCodes.filter((c) => !assignedKeys.has(normalizeKey(c)));

    for (const e of entries) {
      const supName =
        e.supplierName || suppliers.find((s) => s.id === e.supplierId)?.name || '';
      const supCodes = Array.isArray(e.barcodes) ? e.barcodes.filter(Boolean).join(', ') : '';
      const rawCost = e.unitCost ?? e.lastCost;
      rows.push(
        rowRecord({
          sku: p.sku || '',
          productName: p.name || '',
          productBarcode: mainBarcode,
          supplierName: supName,
          supplierBarcodes: supCodes,
          unitCost: opts.withCost ? numCell(rawCost) : '',
          supplierProductName: e.supplierProductName || '',
          supplierSku: e.supplierSku || '',
          isPreferred: e.isPreferred ? 'ใช่' : '',
          command: '',
          systemId: p.id || '',
        }),
      );
    }

    if (opts.includeUnlinked) {
      if (entries.length === 0) {
        if (unassignedCodes.length > 0) {
          for (const code of unassignedCodes) {
            rows.push(
              rowRecord({
                sku: p.sku || '',
                productName: p.name || '',
                productBarcode: mainBarcode,
                supplierName: '',
                supplierBarcodes: code,
                unitCost: '',
                supplierProductName: '',
                supplierSku: '',
                isPreferred: '',
                command: '',
                systemId: p.id || '',
              }),
            );
          }
        } else {
          rows.push(
            rowRecord({
              sku: p.sku || '',
              productName: p.name || '',
              productBarcode: '',
              supplierName: '',
              supplierBarcodes: '',
              unitCost: '',
              supplierProductName: '',
              supplierSku: '',
              isPreferred: '',
              command: '',
              systemId: p.id || '',
            }),
          );
        }
      } else {
        // Product already has >=1 supplier, plus extra unassigned barcodes beyond mainBarcode
        const extraUnassigned = unassignedCodes.filter((c) => normalizeKey(c) !== normalizeKey(mainBarcode));
        for (const code of extraUnassigned) {
          rows.push(
            rowRecord({
              sku: p.sku || '',
              productName: p.name || '',
              productBarcode: mainBarcode,
              supplierName: '',
              supplierBarcodes: code,
              unitCost: '',
              supplierProductName: '',
              supplierSku: '',
              isPreferred: '',
              command: '',
              systemId: p.id || '',
            }),
          );
        }
      }
    }
  }

  const ws = XLSX.utils.json_to_sheet(rows, { header: HEADER_ORDER });
  formatTextColumns(XLSX, ws, rows.length + 20);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SUPPLIER_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, buildSupplierReferenceSheet(XLSX, suppliers), SUPPLIER_REF_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, buildHowToSheet(XLSX), 'วิธีกรอก');
  return wb;
}

const IDENTIFIER_KEYS = new Set<SupplierImportKey>(['sku', 'productBarcode', 'supplierBarcodes']);

/** Read an .xlsx / .xls / .csv buffer into raw rows mapped to canonical SupplierImportKey names. */
export function readSupplierImportFile(
  XLSX: XLSXLib,
  buffer: ArrayBuffer,
  fileName: string,
): {
  rows: SupplierImportRawRow[];
  unknownHeaders: string[];
  hasSupplierColumn: boolean;
  hasProductKeyColumn: boolean;
} {
  const isCsv = /\.csv$/i.test(fileName);
  const book = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, ''), { type: 'string', raw: true })
    : XLSX.read(buffer, { type: 'array' });

  const sheetName = book.Sheets[SUPPLIER_SHEET_NAME] ? SUPPLIER_SHEET_NAME : book.SheetNames[0];
  const sheet = sheetName ? book.Sheets[sheetName] : undefined;
  if (!sheet) {
    return { rows: [], unknownHeaders: [], hasSupplierColumn: false, hasProductKeyColumn: false };
  }

  // Read both raw values (keeps 13-digit numbers exact instead of formatted 8.85E+12) and formatted strings
  const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: false });
  const fmtGrid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });

  const headers = (fmtGrid[0] || []).map((h) => String(h ?? ''));
  const keys = headers.map((h) => supplierImportColumnOf(h));
  const unknownHeaders = headers.filter((h, i) => h.trim() && !keys[i]);
  const hasSupplierColumn = keys.includes('supplierName');
  const hasProductKeyColumn = keys.some((k) => k === 'systemId' || k === 'sku' || k === 'productBarcode');

  const rows: SupplierImportRawRow[] = [];
  const totalRows = Math.max(rawGrid.length, fmtGrid.length);

  for (let r = 1; r < totalRows; r++) {
    const values: Partial<Record<SupplierImportKey, string>> = {};
    let hasAny = false;
    keys.forEach((key, cIdx) => {
      if (!key) return;
      const rawVal = rawGrid[r]?.[cIdx];
      const fmtVal = String(fmtGrid[r]?.[cIdx] ?? '').trim();

      let textVal = fmtVal;
      if (IDENTIFIER_KEYS.has(key)) {
        if (typeof rawVal === 'number' && Number.isSafeInteger(rawVal)) {
          textVal = String(rawVal);
        } else if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
          const rawStr = String(rawVal).trim();
          textVal = /[eE]/.test(fmtVal) && !/[eE]/.test(rawStr) ? rawStr : fmtVal;
        }
        if (key !== 'supplierBarcodes' && textVal) {
          textVal = normalizeBarcodeCode(textVal);
        }
      } else if (key === 'unitCost' && typeof rawVal === 'number' && Number.isFinite(rawVal)) {
        textVal = String(rawVal);
      }

      textVal = textVal.trim();
      if (textVal) {
        values[key] = textVal;
        hasAny = true;
      }
    });
    if (hasAny) {
      rows.push({ rowNo: r + 1, values });
    }
  }

  return { rows, unknownHeaders, hasSupplierColumn, hasProductKeyColumn };
}
