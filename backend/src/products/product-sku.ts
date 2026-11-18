import { randomInt } from 'crypto';

/**
 * Product code (SKU) = the product's permanent system ID (owner, 2026-11-18). Only the server makes
 * one: an internal EAN-13 starting with "200" (GS1 in-store range, never a real manufacturer
 * barcode), the same format the product form used to generate in the browser. It never changes after
 * the product is created (PATCH with another SKU = 400, imports never rename).
 */
export const SKU_PREFIX = '200';

/** EAN-13 check digit of the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** A random internal EAN-13 ("200" + 9 random digits + check digit). Uniqueness is checked by the caller. */
export function randomInternalEan13(rand: (max: number) => number = randomInt): string {
  let body = SKU_PREFIX;
  for (let i = 0; i < 9; i++) body += String(rand(10));
  return body + ean13CheckDigit(body);
}

export function isInternalEan13(code: string): boolean {
  return /^200\d{10}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * A new SKU that is not a product SKU, a product barcode or a pack-unit barcode yet.
 * `taken` (optional) holds codes reserved earlier in the same transaction (e.g. other import rows).
 */
export async function generateProductSku(tx: any, taken?: Set<string>, rand?: (max: number) => number): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = randomInternalEan13(rand);
    if (taken?.has(candidate)) continue;
    const [p, bc, pack] = await Promise.all([
      tx.product.findUnique({ where: { sku: candidate }, select: { id: true } }),
      tx.productBarcode.findUnique({ where: { barcode: candidate }, select: { id: true } }),
      tx.productPackagingUnit.findFirst({ where: { barcode: candidate }, select: { id: true } }),
    ]);
    if (!p && !bc && !pack) {
      taken?.add(candidate);
      return candidate;
    }
  }
  // 10^9 codes: 50 collisions in a row means the random source is broken
  throw new Error('ไม่สามารถสร้างรหัสสินค้าใหม่ได้ กรุณาลองอีกครั้ง');
}
