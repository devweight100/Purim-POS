import { expect, type Page } from '@playwright/test';
import { BACKEND_URL } from './env';

export type Account = { username: string; defaultPassword: string; password: string; pin: string };

/** Direct backend call (setup / checks that the UI is not under test for). */
export async function api<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
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

/** Token for an account; changes the default password first when the account still has it. */
export async function apiLogin(acc: Account): Promise<string> {
  try {
    return (await api('POST', '/auth/login', undefined, { username: acc.username, password: acc.password })).access_token;
  } catch {
    const t = (await api('POST', '/auth/login', undefined, { username: acc.username, password: acc.defaultPassword })).access_token;
    await api('POST', '/auth/change-password', t, { currentPassword: acc.defaultPassword, newPassword: acc.password, newPin: acc.pin });
    return (await api('POST', '/auth/login', undefined, { username: acc.username, password: acc.password })).access_token;
  }
}

/** Log in through the login page. */
export async function uiLogin(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('button[type=submit]').click();
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
