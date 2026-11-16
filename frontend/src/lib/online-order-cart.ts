import type { CartItem } from './types';

export interface PosPayload {
  id: string;
  orderNo: string;
  customer: { id: string; name: string } | null;
  contactName: string;
  note: string;
  lines: { productId: string; sku: string; name: string; unitId: string | null; unitName: string; factor: number; quantity: number; unitPrice: number; isBundle: boolean }[];
}

/** Turns an accepted online order into POS cart lines at the agreed prices (ค่าส่ง included as a service line). */
export function onlineOrderCartItems(p: PosPayload, products: { id: string; hasVat?: boolean; isBundle?: boolean; bundleItems?: { childProductId: string; quantity: number; childProduct?: { name?: string; sku?: string; basePrice?: number; priceLevel1?: number } }[] }[]): CartItem[] {
  const byId = new Map(products.map((x) => [x.id, x]));
  return p.lines.map((l) => {
    const prod = byId.get(l.productId);
    const bundle = prod?.isBundle && prod.bundleItems?.length
      ? prod.bundleItems.map((bi) => ({
          productId: bi.childProductId,
          productName: bi.childProduct?.name || 'สินค้าในชุด',
          sku: bi.childProduct?.sku || '',
          quantityPerBundle: Number(bi.quantity),
          totalQuantity: Number(bi.quantity) * l.quantity,
          unitPrice: Number(bi.childProduct?.basePrice || bi.childProduct?.priceLevel1 || 0),
        }))
      : undefined;
    return {
      productId: l.productId,
      name: l.name,
      sku: l.sku,
      originalPrice: l.unitPrice,
      customPrice: null,
      quantity: l.quantity,
      unitId: l.unitId || `u-${l.productId}-base`,
      unitName: l.unitName,
      conversionFactor: l.factor || 1,
      discountType: 'none',
      discountValue: 0,
      hasVat: prod?.hasVat !== false,
      isBundle: l.isBundle,
      bundleData: bundle,
      pricingNote: `ออเดอร์ออนไลน์ ${p.orderNo}`,
    };
  });
}

