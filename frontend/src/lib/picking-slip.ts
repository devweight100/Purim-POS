/**
 * Picking slip (ใบจัดของ): what staff take to the shelves. Product name, unit, quantity, customer — never a
 * price, a money total or VAT. One data shape for every source (POS cart / held bill, completed bill, online
 * order); one slip layout (components/pos/PickingSlipView.tsx) printed through the same slip pipeline as the
 * receipts (desktop app: ESC/POS raster picture; browser: print preview of the picture).
 *
 * Service lines (ค่าส่ง, `products.is_service`) are left out. A bundle is listed with its parts (stock is taken
 * per part at checkout, so the parts are what is picked).
 */
import { mulQty } from './qty';
import type { ApiOrderLike, CartItem } from './types';

/** SKU of the system service product "ค่าส่ง" (backend OnlineShopService.DELIVERY_SKU). */
export const DELIVERY_FEE_SKU = 'SYS-DELIVERY-FEE';

export interface PickingSlipPart {
  name: string;
  unitName: string;
  quantity: number;
}

export interface PickingSlipLine {
  name: string;
  unitName: string;
  quantity: number;
  note?: string;
  /** bundle parts (each picked and ticked on its own) */
  parts?: PickingSlipPart[];
}

export type PickingSlipSource = 'cart' | 'held' | 'bill' | 'online';

export interface PickingSlipData {
  source: PickingSlipSource;
  /** POS bill no. / held bill label / online order no.; empty for a cart not yet saved */
  docNo: string;
  createdAt: string;
  customerName?: string | null;
  /** online orders: how the goods leave the shop */
  fulfillment?: 'PICKUP' | 'DELIVERY' | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  lines: PickingSlipLine[];
  isReprint?: boolean;
  reprintedAt?: string;
}

/** Label of the document number per source */
export const PICKING_DOC_LABEL: Record<PickingSlipSource, string> = {
  cart: 'ตะกร้า',
  held: 'บิลพัก',
  bill: 'บิลขาย',
  online: 'ออเดอร์ออนไลน์',
};

/** unit name of a product (bundle parts carry no unit): product store lookup, else ชิ้น */
export type UnitLookup = (productId: string | undefined) => string | undefined;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function isServiceLine(x: { sku?: string | null; isService?: boolean | null; product?: { sku?: string | null; isService?: boolean | null } | null }): boolean {
  return x.isService === true || x.product?.isService === true || x.sku === DELIVERY_FEE_SKU || x.product?.sku === DELIVERY_FEE_SKU;
}

interface RawPart {
  productId?: string;
  productName?: string;
  name?: string;
  unitName?: string;
  quantity?: number;
  quantityPerBundle?: number;
  totalQuantity?: number;
}

/**
 * Bundle parts from any stored shape: the POS / checkout snapshot (array with quantityPerBundle / totalQuantity)
 * or the receipt shape ({ bundleItems: [{ productName, quantity per bundle }] }). `baseQty` = bundles sold in
 * base units (quantity x unit factor).
 */
export function bundleParts(bundleData: unknown, baseQty: number, unitOf?: UnitLookup): PickingSlipPart[] {
  const raw: RawPart[] = Array.isArray(bundleData)
    ? (bundleData as RawPart[])
    : bundleData && typeof bundleData === 'object' && Array.isArray((bundleData as { bundleItems?: unknown }).bundleItems)
      ? ((bundleData as { bundleItems: RawPart[] }).bundleItems)
      : [];
  return raw
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      const per = p.quantityPerBundle ?? (Array.isArray(bundleData) ? undefined : p.quantity);
      const quantity = per !== undefined && per !== null ? mulQty(num(per), baseQty) : num(p.totalQuantity);
      return {
        name: p.productName || p.name || 'สินค้าในชุด',
        unitName: p.unitName || unitOf?.(p.productId) || 'ชิ้น',
        quantity,
      };
    });
}

/** POS cart / held bill -> picking slip */
export function cartToPickingSlip(
  cart: { items: CartItem[]; customerName?: string | null; note?: string | null },
  opts: { source: 'cart' | 'held' | 'bill'; docNo?: string; createdAt?: string; unitOf?: UnitLookup; isService?: (productId: string) => boolean },
): PickingSlipData {
  return {
    source: opts.source,
    docNo: opts.docNo || '',
    createdAt: opts.createdAt || new Date().toISOString(),
    customerName: cart.customerName || null,
    note: cart.note || null,
    lines: cart.items
      .filter((i) => !isServiceLine(i) && !opts.isService?.(i.productId))
      .map((i) => {
        const parts = i.isBundle || (i.bundleData && i.bundleData.length) ? bundleParts(i.bundleData, mulQty(i.quantity, i.conversionFactor || 1), opts.unitOf) : [];
        return { name: i.name, unitName: i.unitName, quantity: i.quantity, note: i.itemNote || undefined, ...(parts.length ? { parts } : {}) };
      }),
  };
}

/** Completed POS bill (orders page / POS history) -> picking slip; always a reprint there. */
export function orderToPickingSlip(
  order: ApiOrderLike,
  opts: { isReprint?: boolean; reprintedAt?: string; unitOf?: UnitLookup } = {},
): PickingSlipData {
  const customerName =
    order.customer && typeof order.customer === 'object'
      ? order.customer.name || order.customerName || null
      : order.customerName || (typeof order.customer === 'string' ? order.customer : null);
  const items = (order.items || []) as Array<NonNullable<ApiOrderLike['items']>[number] & { product?: { isService?: boolean | null } | null }>;
  return {
    source: 'bill',
    docNo: order.orderNumber || order.id || '',
    createdAt: order.createdAt || new Date().toISOString(),
    customerName,
    note: (order as { note?: string | null }).note || null,
    lines: items
      .filter((it) => !isServiceLine({ sku: it.product?.sku || it.sku, isService: it.product?.isService }))
      .map((it) => {
        const quantity = num(it.quantity) || 1;
        const parts = bundleParts(it.bundleData, mulQty(quantity, num(it.conversionFactor) || 1), opts.unitOf);
        return {
          name: it.product?.name || it.name || it.productName || 'สินค้า',
          unitName: it.unitName || it.product?.unit || 'ชิ้น',
          quantity,
          note: it.itemNote || it.note || undefined,
          ...(parts.length ? { parts } : {}),
        };
      }),
    isReprint: opts.isReprint === true,
    reprintedAt: opts.isReprint ? opts.reprintedAt || new Date().toISOString() : undefined,
  };
}

/** Response of POST /online-shop/orders/:id/picking-slip */
export interface OnlinePickingPayload {
  orderNo: string;
  createdAt: string;
  customerName: string;
  phone: string;
  address: string | null;
  fulfillment: 'PICKUP' | 'DELIVERY';
  note: string | null;
  reprint: boolean;
  items: { name: string; unitName: string; quantity: number; parts: PickingSlipPart[] }[];
}

export function onlineToPickingSlip(p: OnlinePickingPayload): PickingSlipData {
  return {
    source: 'online',
    docNo: p.orderNo,
    createdAt: p.createdAt,
    customerName: p.customerName,
    fulfillment: p.fulfillment,
    phone: p.phone,
    address: p.fulfillment === 'DELIVERY' ? p.address : null,
    note: p.note,
    lines: p.items.map((i) => ({ name: i.name, unitName: i.unitName, quantity: i.quantity, ...(i.parts?.length ? { parts: i.parts } : {}) })),
    isReprint: p.reprint,
    reprintedAt: p.reprint ? new Date().toISOString() : undefined,
  };
}
