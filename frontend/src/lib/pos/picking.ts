'use client';

/**
 * Picking slip (ใบจัดของ) entry points of the POS / orders pages. Every one prints the same slip layout
 * (components/pos/PickingSlipView.tsx). A cart or held bill that pays an online order prints that order's slip
 * through the server (claims the order, counts reprints, delivery details).
 */
import { toast } from 'sonner';
import { useCartStore } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { cartToPickingSlip, orderToPickingSlip, type PickingSlipData, type UnitLookup } from '@/lib/picking-slip';
import { printOnlinePickingSlip } from '@/lib/online-order-actions';
import type { ApiOrderLike, CartItem, HeldBill } from '@/lib/types';

/** base unit name of a product in the POS catalogue (bundle parts carry no unit) */
export function productUnitLookup(): UnitLookup {
  const products = useProductStore.getState().products;
  const byId = new Map(products.map((p) => [p.id, p]));
  return (id) => (id ? byId.get(id)?.units?.[0]?.unitName : undefined);
}

/**
 * Cart lines with their bundle parts: a line added before the catalogue had the bundle's items (or from an old
 * held bill) has no snapshot, so the parts come from the POS catalogue.
 */
export function withBundleParts(items: CartItem[]): CartItem[] {
  const products = useProductStore.getState().products;
  const byId = new Map(products.map((p) => [p.id, p]));
  return items.map((i) => {
    if (i.bundleData?.length) return i;
    const p = byId.get(i.productId);
    if (!p?.isBundle || !p.bundleItems?.length) return i;
    return {
      ...i,
      isBundle: true,
      bundleData: p.bundleItems.map((bi) => ({
        productId: bi.childProductId,
        productName: bi.childProduct?.name || byId.get(bi.childProductId)?.name || 'สินค้าในชุด',
        sku: bi.childProduct?.sku || '',
        quantityPerBundle: Number(bi.quantity),
        totalQuantity: Number(bi.quantity) * i.quantity,
        unitPrice: 0,
      })),
    };
  });
}

async function print(data: PickingSlipData) {
  const { printPickingSlip } = await import('@/components/pos/PickingSlipView');
  await printPickingSlip(data, loadStoreSettings());
}

async function printOnline(onlineOrderId: string) {
  try {
    const p = await printOnlinePickingSlip(onlineOrderId);
    toast.success(`ส่งพิมพ์ใบจัดของ ${p.orderNo} แล้ว`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'พิมพ์ใบจัดของไม่สำเร็จ');
  }
}

/** F8 / "ใบจัดของ" on the sales screen: the current cart. */
export async function printCartPickingSlip() {
  const cart = useCartStore.getState();
  if (cart.items.length === 0) {
    toast.warning('ยังไม่มีสินค้าในตะกร้า');
    return;
  }
  if (cart.onlineOrderId) return printOnline(cart.onlineOrderId);
  const data = cartToPickingSlip({ ...cart, items: withBundleParts(cart.items) }, { source: 'cart', docNo: cart.editingOrderId || '', unitOf: productUnitLookup() });
  if (!data.lines.length) {
    toast.warning('ไม่มีสินค้าที่ต้องจัด (มีแต่ค่าบริการ)');
    return;
  }
  await print(data);
  toast.success('ส่งพิมพ์ใบจัดของแล้ว');
}

/** Held-bills sheet: one parked bill. */
export async function printHeldBillPickingSlip(bill: HeldBill) {
  if (bill.onlineOrderId) return printOnline(bill.onlineOrderId);
  await print(cartToPickingSlip({ ...bill, items: withBundleParts(bill.items) }, { source: 'held', docNo: bill.label, createdAt: bill.heldAt, unitOf: productUnitLookup() }));
  toast.success(`ส่งพิมพ์ใบจัดของ ${bill.label} แล้ว`);
}

/** Completed bill (POS history, orders page): reprint. */
export async function printOrderPickingSlip(order: ApiOrderLike) {
  await print(orderToPickingSlip(order, { isReprint: true, unitOf: productUnitLookup() }));
  toast.success(`ส่งพิมพ์ใบจัดของ ${order.orderNumber || ''} แล้ว`.replace(/\s+แล้ว$/, ' แล้ว'));
}
