/**
 * Online shop (LINE LIFF) client: talks only to /api/public/shop/* (the routes reachable through the tunnel).
 * The shop session token (not a staff login) is kept in memory and localStorage.
 */
import type { PriceLevel } from '@shared/online-shop';

export interface ShopConfig {
  open: boolean;
  liffId: string | null;
  devLogin: boolean;
  storeName: string;
  branchName: string | null;
  storePhone: string | null;
  storeAddress: string | null;
  allowPickup: boolean;
  allowDelivery: boolean;
  notice: string | null;
  levelNames: Record<PriceLevel, string>;
}

export interface ShopMe {
  profile: { name: string; picture: string | null; test: boolean };
  member: { name: string; level: PriceLevel; levelName: string; deliveryFee: number | null } | null;
  contact: { name: string; phone: string; address: string };
  linkRequest: { status: 'PENDING' | 'APPROVED' | 'REJECTED'; phone: string; note: string | null; createdAt: string } | null;
}

export interface ShopUnit {
  id: string | null;
  name: string;
  price: number;
  inStock: boolean;
}

export interface ShopProduct {
  id: string;
  name: string;
  categoryId: string;
  imageUrl: string | null;
  units: ShopUnit[];
  inStock: boolean;
}

export interface ShopCategory {
  id: string;
  name: string;
  count: number;
  imageUrl: string | null;
}

export interface ShopOrderItem {
  productId: string;
  name: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export type ShopOrderStatus = 'NEW' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'DELIVERING' | 'DONE' | 'CANCELLED';

export interface ShopOrder {
  id: string;
  orderNo: string;
  status: ShopOrderStatus;
  statusLabel: string;
  fulfillment: 'PICKUP' | 'DELIVERY';
  contactName: string;
  contactPhone: string;
  address: string | null;
  note: string | null;
  subtotal: number;
  deliveryFee: number | null;
  feePending: boolean;
  totalAmount: number;
  rejectReason: string | null;
  paid: boolean;
  createdAt: string;
  items: ShopOrderItem[];
  payment?: { amount: number; payload: string; accountName: string; bankName: string; maskedId: string } | null;
}

export interface ShopQuote {
  lines: { productId: string; unitId: string | null; ok: boolean; name?: string; unitName?: string; quantity: number; unitPrice: number; total: number; problem: string | null }[];
  subtotal: number;
  deliveryFee: number | null;
  feePending: boolean;
  total: number;
  fulfillment: 'PICKUP' | 'DELIVERY';
}

const TOKEN_KEY = 'purim-shop-session';
let token: string | null = null;

export function loadToken(): string | null {
  if (token) return token;
  try {
    const raw = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') as { token: string; expiresAt: string } | null;
    if (raw && Date.parse(raw.expiresAt) > Date.now() + 3600_000) token = raw.token;
  } catch {
    /* ignore */
  }
  return token;
}

export function saveToken(t: string | null, expiresAt?: string) {
  token = t;
  try {
    if (t && expiresAt) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: t, expiresAt }));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ShopError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function shopFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const t = loadToken();
  if (t) headers.authorization = `Bearer ${t}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api/public/shop${path}`, { method: init.method || 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), cache: 'no-store' });
  } catch {
    throw new ShopError('ต่ออินเทอร์เน็ตไม่ได้ กรุณาลองใหม่', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
    throw new ShopError(typeof msg === 'string' && msg ? msg : 'เกิดข้อผิดพลาด กรุณาลองใหม่', res.status);
  }
  return data as T;
}

export const baht = (n: number) => '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
