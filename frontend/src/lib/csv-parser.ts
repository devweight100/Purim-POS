export interface CSVProductRow {
  productCode: string;
  productName: string;
  cost: number;
  price: number;
  priceLevel1?: number;
  priceLevel2?: number;
  priceLevel3?: number;
  priceLevel4?: number;
  priceLevel5?: number;
  customBarcodeId: string;
  barcodeForSelling: string; // customBarcodeId or productCode if barcode is missing
  category?: string;
  stock?: number;
  unit?: string;
}

export interface FormattedProductItem {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  category?: string;
  stock: number;
  hasVat: boolean;
  cost: number;
  costPrice: number;
  basePrice: number;
  price: number;
  priceLevel1: number;
  priceLevel2?: number | null;
  priceLevel3?: number | null;
  priceLevel4?: number | null;
  priceLevel5?: number | null;
  unit: string;
  image: string | null;
  barcodes: { barcode: string }[];
  units: {
    id: string;
    unitName: string;
    factor: number;
    price: number;
    barcode: string;
  }[];
}

/**
 * Robust CSV Line Parser that handles quotes, escaped quotes, and newlines inside fields.
 */
export function parseCSVLines(text: string): string[][] {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        lines.push(currentRow);
        currentRow = [];
      } else {
        currentField += char;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    lines.push(currentRow);
  }

  return lines;
}

/**
 * Parse CSV text into product rows based on header column names.
 * Supports Price Levels 1 to 5, category, stock, unit, cost, barcode.
 * Rule: If custom barcode is empty, barcodeForSelling = productCode.
 */
export function parseProductCSV(csvText: string): CSVProductRow[] {
  const lines = parseCSVLines(csvText);
  if (lines.length === 0) return [];

  // Find header indices
  const header = lines[0].map(h => h.trim().toLowerCase());

  const codeIdx = header.findIndex(h => h.includes('code') || h.includes('รหัส'));
  const nameIdx = header.findIndex(h => h.includes('name') || h.includes('ชื่อ'));
  const barcodeIdx = header.findIndex(h => h.includes('barcode') || h.includes('บาร์โค้ด'));
  const categoryIdx = header.findIndex(h => h.includes('category') || h.includes('หมวด'));
  const costIdx = header.findIndex(h => h.includes('cost') || h.includes('ทุน'));

  const findPriceIdx = (num: number, keywords: string[]) => {
    return header.findIndex(h =>
      h.includes(`ราคา ${num}`) ||
      h.includes(`ราคา${num}`) ||
      h.includes(`price ${num}`) ||
      h.includes(`price${num}`) ||
      h.includes(`level ${num}`) ||
      h.includes(`level${num}`) ||
      keywords.some(k => h.includes(k))
    );
  };

  const p1Idx = findPriceIdx(1, ['ราคา 1', 'ราคา1', 'ราคาขาย', 'ทั่วไป']);
  const p2Idx = findPriceIdx(2, ['ราคา 2', 'ราคา2', 'สมาชิก']);
  const p3Idx = findPriceIdx(3, ['ราคา 3', 'ราคา3', 'ช่าง', 'ราคาส่ง']);
  const p4Idx = findPriceIdx(4, ['ราคา 4', 'ราคา4', 'vip']);
  const p5Idx = findPriceIdx(5, ['ราคา 5', 'ราคา5', 'ตัวแทน']);

  const stockIdx = header.findIndex(h => h.includes('stock') || h.includes('สต็อก') || h.includes('สต๊อก') || h.includes('จำนวน'));
  const unitIdx = header.findIndex(h => h.includes('unit') || h.includes('หน่วย'));

  const results: CSVProductRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row || row.length === 0 || (row.length === 1 && !row[0].trim())) continue;

    const productCode = (codeIdx >= 0 && row[codeIdx] !== undefined ? row[codeIdx] : row[0] || '').trim();
    const productName = (nameIdx >= 0 && row[nameIdx] !== undefined ? row[nameIdx] : row[1] || '').trim();
    const customBarcodeId = (barcodeIdx >= 0 && row[barcodeIdx] !== undefined ? row[barcodeIdx] : '').trim();
    const category = (categoryIdx >= 0 && row[categoryIdx] !== undefined ? row[categoryIdx] : '').trim();
    
    const costStr = (costIdx >= 0 && row[costIdx] !== undefined ? row[costIdx] : '0').replace(/,/g, '').trim();
    const p1Str = (p1Idx >= 0 && row[p1Idx] !== undefined ? row[p1Idx] : '').replace(/,/g, '').trim();
    const p2Str = (p2Idx >= 0 && row[p2Idx] !== undefined ? row[p2Idx] : '').replace(/,/g, '').trim();
    const p3Str = (p3Idx >= 0 && row[p3Idx] !== undefined ? row[p3Idx] : '').replace(/,/g, '').trim();
    const p4Str = (p4Idx >= 0 && row[p4Idx] !== undefined ? row[p4Idx] : '').replace(/,/g, '').trim();
    const p5Str = (p5Idx >= 0 && row[p5Idx] !== undefined ? row[p5Idx] : '').replace(/,/g, '').trim();

    const stockStr = (stockIdx >= 0 && row[stockIdx] !== undefined ? row[stockIdx] : '0').replace(/,/g, '').trim();
    const unit = (unitIdx >= 0 && row[unitIdx] !== undefined ? row[unitIdx] : 'ชิ้น').trim() || 'ชิ้น';

    if (!productCode && !productName) continue;

    const cost = parseFloat(costStr) || 0;
    const price1 = p1Str ? parseFloat(p1Str) || 0 : cost;
    const price2 = p2Str ? parseFloat(p2Str) || undefined : undefined;
    const price3 = p3Str ? parseFloat(p3Str) || undefined : undefined;
    const price4 = p4Str ? parseFloat(p4Str) || undefined : undefined;
    const price5 = p5Str ? parseFloat(p5Str) || undefined : undefined;

    const stock = stockStr ? parseFloat(stockStr) || 0 : 0;

    // Rule: ถ้าไม่มีบาร์โค้ด เวลาขายจะใช้รหัสสินค้าแทน
    const barcodeForSelling = customBarcodeId !== '' ? customBarcodeId : productCode;

    results.push({
      productCode,
      productName,
      cost,
      price: price1,
      priceLevel1: price1,
      priceLevel2: price2,
      priceLevel3: price3,
      priceLevel4: price4,
      priceLevel5: price5,
      customBarcodeId,
      barcodeForSelling,
      category,
      stock,
      unit,
    });
  }

  return results;
}

/**
 * Converts parsed CSV rows into formatted Product objects ready for POS & Database
 */
export function csvRowsToProducts(rows: CSVProductRow[]): FormattedProductItem[] {
  return rows.map((r, idx) => {
    const id = r.productCode || `PROD-${idx + 1}`;
    const p1 = r.priceLevel1 != null ? r.priceLevel1 : r.price;
    const unitName = r.unit || 'ชิ้น';

    return {
      id,
      sku: r.productCode || id,
      name: r.productName,
      categoryId: 'c6', // Default category: อื่นๆ
      category: r.category || 'ทั่วไป',
      stock: r.stock !== undefined ? r.stock : 0,
      hasVat: true,
      cost: r.cost,
      costPrice: r.cost,
      basePrice: p1,
      price: p1,
      priceLevel1: p1,
      priceLevel2: r.priceLevel2 ?? null,
      priceLevel3: r.priceLevel3 ?? null,
      priceLevel4: r.priceLevel4 ?? null,
      priceLevel5: r.priceLevel5 ?? null,
      unit: unitName,
      image: null,
      barcodes: [{ barcode: r.barcodeForSelling }],
      units: [
        {
          id: `u-${id}-base`,
          unitName,
          factor: 1,
          price: p1,
          barcode: r.barcodeForSelling,
        }
      ]
    };
  });
}
