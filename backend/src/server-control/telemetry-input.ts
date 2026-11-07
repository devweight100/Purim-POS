import { BadRequestException } from '@nestjs/common';
import type { LiveCartItem, TerminalLiveState } from './server-control.service';

/** Upper bounds for what a POS terminal may push into the in-memory telemetry. */
export const MAX_TERMINALS = 100;
export const MAX_CART_ITEMS = 200;
const MAX_SNAPSHOT_CHARS = 200_000;
const ACTIONS = ['IDLE', 'SCANNING', 'PAYMENT', 'VOID', 'DRAWER', 'CLAIM'] as const;
const ALERTS = ['NORMAL', 'WARNING', 'ALERT'] as const;

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : undefined;
const num = (v: unknown, min: number, max: number, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function parseTerminalId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(raw)) {
    throw new BadRequestException('รหัสเครื่องขาย (terminalId) ไม่ถูกต้อง');
  }
  return raw;
}

export function parseLatency(raw: unknown): number {
  return Math.round(num(raw, 1, 60_000, 5));
}

export function parseTerminalName(raw: unknown): string | undefined {
  return str(raw, 80) || undefined;
}

function parseCartItem(raw: unknown): LiveCartItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    productId: str(r.productId, 80) || '',
    name: str(r.name, 200) || 'สินค้า',
    barcode: str(r.barcode, 80),
    unitName: str(r.unitName, 40) || 'ชิ้น',
    price: num(r.price, -1e9, 1e9),
    quantity: num(r.quantity, -1e6, 1e6),
    total: num(r.total, -1e10, 1e10),
  };
}

/** Whitelist + clamp a live cart state sent by a POS screen. Returns undefined when absent. */
export function parseLiveState(raw: unknown): Partial<TerminalLiveState> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('ข้อมูลสถานะเครื่องขายไม่ถูกต้อง');
  const r = raw as Record<string, unknown>;
  if (r.cartItems !== undefined && !Array.isArray(r.cartItems)) throw new BadRequestException('ข้อมูลตะกร้าสินค้าไม่ถูกต้อง');
  const items = Array.isArray(r.cartItems) ? r.cartItems : [];
  if (items.length > MAX_CART_ITEMS) throw new BadRequestException(`รายการในตะกร้ามากเกินไป (สูงสุด ${MAX_CART_ITEMS})`);
  const action = ACTIONS.includes(r.activeAction as any) ? (r.activeAction as TerminalLiveState['activeAction']) : 'IDLE';
  const alert = ALERTS.includes(r.alertLevel as any) ? (r.alertLevel as TerminalLiveState['alertLevel']) : 'NORMAL';
  const snapshot = typeof r.screenSnapshot === 'string' && r.screenSnapshot.length <= MAX_SNAPSHOT_CHARS && /^data:image\/(png|jpeg|webp);base64,/.test(r.screenSnapshot)
    ? r.screenSnapshot
    : undefined;
  return {
    activeAction: action,
    actionDescription: str(r.actionDescription, 200) || '',
    customerName: str(r.customerName, 120),
    itemCount: Math.round(num(r.itemCount, 0, 1e6)),
    totalAmount: num(r.totalAmount, -1e10, 1e10),
    discountAmount: num(r.discountAmount, -1e10, 1e10),
    cartItems: items.map(parseCartItem).filter((i): i is LiveCartItem => i !== null),
    alertLevel: alert,
    ...(snapshot ? { screenSnapshot: snapshot } : {}),
  };
}

const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';

/** Socket address; X-Forwarded-For is honoured only when the request comes from a local reverse proxy. */
export function telemetryClientIp(req: any): string {
  const socketIp = String(req?.socket?.remoteAddress || req?.ip || '127.0.0.1').replace('::ffff:', '');
  if (isLoopback(socketIp)) {
    const fwd = req?.headers?.['x-forwarded-for'];
    const first = typeof fwd === 'string' ? fwd.split(',')[0].trim().replace('::ffff:', '') : '';
    if (first && /^[0-9a-fA-F.:]{2,45}$/.test(first)) return first;
  }
  return socketIp;
}
