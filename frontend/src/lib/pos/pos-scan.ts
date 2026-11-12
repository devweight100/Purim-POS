import { convertThaiToEnBarcode } from '@/lib/thai-barcode-converter';
import { getProductPackagingUnits } from '@/lib/cart-pricing';
import type { Product, ProductUnit } from '@/lib/types';

/**
 * The unit a scanned code stands for: a pack unit whose barcode matches (priced at its level-1 price,
 * else base price x pack size), else the unit with that barcode, else the product's first unit.
 */
export function resolveScannedUnit(product: Product, code: string): ProductUnit {
  const matchedPkg = getProductPackagingUnits(product.id).find((u) => u.barcode?.toLowerCase().trim() === code);
  const unit = product.units?.find((u) => u.barcode?.toLowerCase().trim() === code) || product.units[0];
  if (!matchedPkg) return unit;
  return {
    id: `pkg-${product.id}-${matchedPkg.name}`,
    unitName: matchedPkg.name,
    factor: matchedPkg.multiplier,
    price: matchedPkg.priceLevel1 || unit.price * matchedPkg.multiplier,
    barcode: matchedPkg.barcode,
  };
}

/**
 * Whether the text typed in the search box (after Thai-keyboard conversion) is exactly a SKU or a
 * barcode of some product; Enter then treats it as a scan instead of "add the first search result".
 */
export function isExactProductCode(products: Product[], raw: string): boolean {
  const converted = convertThaiToEnBarcode(raw).toLowerCase().trim();
  return products.some((p) => {
    const matchSku = p.sku?.toLowerCase().trim() === converted;
    const matchUnitBarcode = p.units?.some((u) => u.barcode?.toLowerCase().trim() === converted);
    const matchProductBarcodes = p.barcodes?.some((b) => b.barcode?.toLowerCase().trim() === converted);
    const matchPkgBarcode = getProductPackagingUnits(p.id).some((u) => u.barcode?.toLowerCase().trim() === converted);
    return matchSku || matchUnitBarcode || matchProductBarcodes || matchPkgBarcode;
  });
}

const DOCUMENT_PREFIXES = ['ord-', 'clm-', 'shf-', 'po-', 'dn-', 'pv-', 'debt-'];

/** A scanned code that is a document number (bill, claim, shift, PO, ...), raw or Thai-converted. */
export function findDocumentCode(raw: string, converted: string): string | undefined {
  return [raw, converted].find((c) => DOCUMENT_PREFIXES.some((p) => c.toLowerCase().startsWith(p)));
}
