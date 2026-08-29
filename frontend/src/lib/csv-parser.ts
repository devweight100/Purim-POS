export interface CSVProductRow {
  productCode: string;
  productName: string;
  cost: number;
  price: number;
  customBarcodeId: string;
  barcodeForSelling: string; // customBarcodeId or productCode if barcode is missing
}

export interface FormattedProductItem {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  stock: number;
  hasVat: boolean;
  cost: number;
  price: number;
  image: string | null;
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
 * Applies rule: If Custom barcode id is empty, barcodeForSelling = productCode.
 */
export function parseProductCSV(csvText: string): CSVProductRow[] {
  const lines = parseCSVLines(csvText);
  if (lines.length === 0) return [];

  // Find header indices
  const header = lines[0].map(h => h.trim().toLowerCase());

  const codeIdx = header.findIndex(h => h.includes('code') || h.includes('รหัส'));
  const nameIdx = header.findIndex(h => h.includes('name') || h.includes('ชื่อ'));
  const costIdx = header.findIndex(h => h.includes('cost') || h.includes('ทุน'));
  const priceIdx = header.findIndex(h => h.includes('price') || h.includes('ขาย') || h.includes('ราคา'));
  const barcodeIdx = header.findIndex(h => h.includes('barcode') || h.includes('บาร์โค้ด'));

  const results: CSVProductRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row || row.length === 0 || (row.length === 1 && !row[0].trim())) continue;

    const productCode = (codeIdx >= 0 && row[codeIdx] !== undefined ? row[codeIdx] : row[0] || '').trim();
    const productName = (nameIdx >= 0 && row[nameIdx] !== undefined ? row[nameIdx] : row[1] || '').trim();
    const costStr = (costIdx >= 0 && row[costIdx] !== undefined ? row[costIdx] : row[2] || '0').replace(/,/g, '').trim();
    const priceStr = (priceIdx >= 0 && row[priceIdx] !== undefined ? row[priceIdx] : row[3] || '0').replace(/,/g, '').trim();
    const customBarcodeId = (barcodeIdx >= 0 && row[barcodeIdx] !== undefined ? row[barcodeIdx] : row[4] || '').trim();

    if (!productCode && !productName) continue;

    const cost = parseFloat(costStr) || 0;
    const price = parseFloat(priceStr) || 0;

    // Rule: ถ้าไม่มีบาร์โค้ด เวลาขายจะใช้รหัสสินค้าแทน
    const barcodeForSelling = customBarcodeId !== '' ? customBarcodeId : productCode;

    results.push({
      productCode,
      productName,
      cost,
      price,
      customBarcodeId,
      barcodeForSelling,
    });
  }

  return results;
}

/**
 * Converts parsed CSV rows into formatted Product objects ready for POS & LocalStorage
 */
export function csvRowsToProducts(rows: CSVProductRow[]): FormattedProductItem[] {
  return rows.map((r, idx) => {
    const id = r.productCode || `PROD-${idx + 1}`;
    // Random initial stock between 5 and 100 as requested
    const randomStock = Math.floor(Math.random() * 96) + 5;
    return {
      id,
      sku: r.productCode || id,
      name: r.productName,
      categoryId: 'c6', // Default category: อื่นๆ
      stock: randomStock,
      hasVat: true,
      cost: r.cost,
      basePrice: r.cost,
      price: r.price,
      priceLevel1: r.price,
      unit: 'ชิ้น',
      barcodes: [{ barcode: r.barcodeForSelling }],
      image: null,
      units: [
        {
          id: `u-${id}-base`,
          unitName: 'ชิ้น',
          factor: 1,
          price: r.price,
          barcode: r.barcodeForSelling,
        }
      ]
    } as any;
  });
}
