import { expect, type Page } from '@playwright/test';
import { BACKEND_URL } from './env';

export type Account = { username: string; defaultPassword: string; password: string; pin: string };

/** Direct backend call (setup / checks that the UI is not under test for). */
export async function api<T = unknown>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BACKEND_URL}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

// Shapes of the API responses the specs read (only the fields they use).
export interface ApiOrder {
  id: string;
  orderNumber: string;
  totalAmount: string | number;
  payments: { method: string }[];
  customer?: { name: string } | null;
}
export interface ApiShift {
  isOpen: boolean;
  openingCash: number;
  actualCash: number | null;
  difference: number | null;
  status: string;
  orderCount: number;
}
export interface ApiReturn {
  refundAmount: string | number;
  refundMethod: string;
}
export interface ApiProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  packagingUnits: { name: string; qtyPerPrev: number; barcode: string | null; priceLevel1: string | number | null }[];
}

/** Token for an account; changes the default password first when the account still has it. */
export async function apiLogin(acc: Account): Promise<string> {
  try {
    return (await login(acc.username, acc.password)).access_token;
  } catch {
    const t = (await login(acc.username, acc.defaultPassword)).access_token;
    await api('POST', '/auth/change-password', t, { currentPassword: acc.defaultPassword, newPassword: acc.password, newPin: acc.pin });
    return (await login(acc.username, acc.password)).access_token;
  }
}

const login = (username: string, password: string) =>
  api<{ access_token: string }>('POST', '/auth/login', undefined, { username, password });

/**
 * Log in through the login page. Users with both the POS and the back office land on the start screen
 * (/start, docs/round-start-dashboard.md); by default this picks "หน้าขาย (POS)" there like the older specs
 * expect. `{ start: 'stay' }` leaves the start screen open.
 */
export async function uiLogin(page: Page, username: string, password: string, opts: { start?: 'pos' | 'stay' } = {}) {
  await page.goto('/login');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('button[type=submit]').click();
  if (opts.start === 'stay') return;
  const left = await page
    .waitForURL((u) => u.pathname !== '/login', { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!left) return; // wrong password: stays on /login
  // the start screen may still be redirecting a POS-only user: wait until the URL settles
  await page.waitForURL((u) => u.pathname !== '/', { timeout: 10_000 }).catch(() => undefined);
  if (new URL(page.url()).pathname === '/start') {
    const pos = page.getByTestId('start-pos');
    const shown = await Promise.race([
      pos.waitFor({ timeout: 15_000 }).then(() => true),
      page.waitForURL((u) => u.pathname !== '/start', { timeout: 15_000 }).then(() => false),
    ]).catch(() => false);
    if (shown && new URL(page.url()).pathname === '/start') await pos.click();
  }
}

/** The hidden barcode-scanner input of the POS screen. */
export const scannerInput = (page: Page) => page.locator('input.sr-only[tabindex="-1"]');

/** Type a code like a barcode scanner (fast keystrokes + Enter). */
export async function scan(page: Page, code: string) {
  const input = scannerInput(page);
  await input.focus();
  await page.keyboard.type(code, { delay: 5 });
  await page.keyboard.press('Enter');
}

/** Cart as persisted by the POS (localStorage). */
export async function cartItems(page: Page): Promise<{ sku: string; quantity: number; name: string }[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('purim-pos-cart');
    return raw ? JSON.parse(raw).state.items : [];
  });
}

export async function expectCartQty(page: Page, sku: string, qty: number) {
  await expect.poll(async () => (await cartItems(page)).find((i) => i.sku === sku)?.quantity ?? 0).toBe(qty);
}

/** "1,234.50" / "฿1,234.50" -> 1234.5 */
export const money = (s: string) => Number(s.replace(/[^\d.-]/g, ''));
