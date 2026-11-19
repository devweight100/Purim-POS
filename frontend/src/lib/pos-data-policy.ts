'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { getElectronAPI } from './electron-api';

/**
 * Which screens keep the POS data in memory: the whole product catalogue (product store, delta-synced every 15 s,
 * IndexedDB offline copy) and the customer list (customer-service, delta-synced).
 *
 * - the POS screen (/pos) always;
 * - a "selling device" (เครื่องนี้ใช้ขายหน้าร้าน) always, on every screen: going to the POS is instant and the offline
 *   copy stays current, so selling keeps working when the server is unreachable;
 * - any other device only while a screen that needs the whole list is open (usePosDataDemand: PO item picker,
 *   claim modal, supplier-return dialog, stock-adjust picker...). Leaving such a screen releases the lists.
 * The phone summary (/m) never loads them.
 */

export type PosDataPart = 'products' | 'customers';

export interface PosDataPlanInput {
  path: string;
  sellingDevice: boolean;
  /** number of mounted screens that need the part (usePosDataDemand) */
  productDemand: number;
  customerDemand: number;
}

export interface PosDataPlan {
  products: boolean;
  customers: boolean;
}

export function isPosPath(path: string): boolean {
  return /^\/pos(\/|$)/.test(path);
}

export function isMobilePath(path: string): boolean {
  return path === '/m' || path.startsWith('/m/');
}

/** Should this screen keep (load + delta-sync) the product catalogue / customer list? */
export function posDataPlan(i: PosDataPlanInput): PosDataPlan {
  if (isMobilePath(i.path)) return { products: false, customers: false };
  if (isPosPath(i.path) || i.sellingDevice) return { products: true, customers: true };
  return { products: i.productDemand > 0, customers: i.customerDemand > 0 };
}

// ─── Selling device ───────────────────────────────────────────────────────────────────────────────────────

/** explicit per-device choice: '1' = selling device, '0' = back office only (absent = automatic) */
export const SELLING_DEVICE_KEY = 'purim_selling_device';
/** set by this device: the desktop app opened the POS screen */
export const DESKTOP_POS_OPENED_KEY = 'purim_desktop_pos_opened';
/** set by this device: a bill was completed here (online or into the offline outbox) */
export const SOLD_HERE_KEY = 'purim_sold_here';

export interface SellingDeviceInput {
  /** explicit setting of this device; null = automatic */
  explicit: boolean | null;
  /** running in the Purim desktop app (Electron) */
  isDesktop: boolean;
  /** the desktop app has opened the POS screen on this device */
  desktopPosOpened: boolean;
  /** a bill was completed on this device */
  soldHere: boolean;
  /** bills waiting in this device's offline outbox */
  pendingOfflineBills: number;
}

/**
 * Selling device = keeps the POS data warm on every screen. The explicit setting wins. Automatic:
 * - desktop app with a POS session (it opened the POS screen; the app starts on it) -> ON;
 * - a browser that completed a bill here, or still has offline bills to send -> ON;
 * - any other browser -> OFF. Logging in lands on /pos, so merely opening the POS does not count: a back-office
 *   laptop would otherwise always end up "selling".
 */
export function decideSellingDevice(i: SellingDeviceInput): boolean {
  if (i.explicit !== null) return i.explicit;
  if (i.pendingOfflineBills > 0) return true;
  if (i.isDesktop && i.desktopPosOpened) return true;
  return i.soldHere;
}

function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

let pendingOfflineBills = 0;
let version = 0;
const listeners = new Set<() => void>();
function changed() {
  version++;
  listeners.forEach((l) => l());
}

export function sellingDeviceSetting(): boolean | null {
  const v = read(SELLING_DEVICE_KEY);
  return v === '1' ? true : v === '0' ? false : null;
}

/** Settings: true / false = this device's explicit choice, null = automatic. */
export function setSellingDeviceSetting(value: boolean | null) {
  write(SELLING_DEVICE_KEY, value === null ? null : value ? '1' : '0');
  changed();
}

export function isDesktopApp(): boolean {
  return Boolean(getElectronAPI()?.isDesktop);
}

export function isSellingDevice(): boolean {
  return decideSellingDevice({
    explicit: sellingDeviceSetting(),
    isDesktop: isDesktopApp(),
    desktopPosOpened: read(DESKTOP_POS_OPENED_KEY) === '1',
    soldHere: read(SOLD_HERE_KEY) === '1',
    pendingOfflineBills,
  });
}

/** The automatic answer (what the device would be without an explicit setting). */
export function automaticSellingDevice(): boolean {
  return decideSellingDevice({
    explicit: null,
    isDesktop: isDesktopApp(),
    desktopPosOpened: read(DESKTOP_POS_OPENED_KEY) === '1',
    soldHere: read(SOLD_HERE_KEY) === '1',
    pendingOfflineBills,
  });
}

/** POS screen mounted: in the desktop app this is a POS session (automatic selling device). */
export function notePosOpened() {
  if (isDesktopApp() && read(DESKTOP_POS_OPENED_KEY) !== '1') {
    write(DESKTOP_POS_OPENED_KEY, '1');
    changed();
  }
}

/** A bill was completed on this device (online or saved to the offline outbox). */
export function noteSoldHere() {
  if (read(SOLD_HERE_KEY) !== '1') {
    write(SOLD_HERE_KEY, '1');
    changed();
  }
}

/** Number of bills in this device's offline outbox (ClientDbSync reports it). */
export function notePendingOfflineBills(n: number) {
  if ((n > 0) !== (pendingOfflineBills > 0)) {
    pendingOfflineBills = n;
    changed();
  } else pendingOfflineBills = n;
}

// ─── Screens that need the whole list ─────────────────────────────────────────────────────────────────────

const demand = { products: 0, customers: 0 };

export function posDataDemand(): { products: number; customers: number } {
  return { ...demand };
}

/** Registers a need for the whole product catalogue / customer list; returns the release function. */
export function acquirePosData(parts: { products?: boolean; customers?: boolean }): () => void {
  if (parts.products) demand.products++;
  if (parts.customers) demand.customers++;
  changed();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (parts.products) demand.products--;
    if (parts.customers) demand.customers--;
    changed();
  };
}

/** While mounted (and `active`), this screen needs the whole catalogue / customer list kept loaded and current. */
export function usePosDataDemand(parts: { products?: boolean; customers?: boolean }, active = true) {
  const products = Boolean(parts.products);
  const customers = Boolean(parts.customers);
  useEffect(() => {
    if (!active || (!products && !customers)) return;
    return acquirePosData({ products, customers });
  }, [active, products, customers]);
}

export function subscribePosDataPolicy(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Re-renders when the demand / selling-device answer may have changed. */
export function usePosDataPolicyVersion(): number {
  return useSyncExternalStore(subscribePosDataPolicy, () => version, () => 0);
}
