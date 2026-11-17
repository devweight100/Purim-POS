import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';

test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
let adminToken = '';
let productId = '';

async function placeOrder(dev: string) {
  const s = await api<{ token: string }>('POST', '/public/shop/session', undefined, { dev: { id: `${dev}${TAG}`, name: 'ลูกค้าทดสอบ' } });
  return api<{ id: string; orderNo: string }>('POST', '/public/shop/orders', s.token, {
    contactName: 'คุณมานี มีของ', contactPhone: '0812345678', fulfillment: 'PICKUP',
    items: [{ productId, quantity: 2, unitId: null }],
  });
}

test.beforeAll(async () => {
  adminToken = await apiLogin(ADMIN);
  const r = await api<{ id: string }>('POST', '/products', adminToken, { name: `ปูนเหตุผล ${TAG}`, sku: `RS-${TAG}`, unit: 'ถุง', basePrice: 100, priceLevel1: 100, costPrice: 1 });
  productId = r.id;
  await api('POST', '/inventory/adjust', adminToken, { productId, type: 'ADD', amount: 100, reason: 'ปรับยอดเริ่มต้น' });
  await api('PUT', '/online-shop/config', adminToken, { enabled: true });
});

async function adminPage(page: Page) {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await page.waitForURL(/\/(pos|dashboard)/);
}

test('repro: type a reject reason', async ({ page }) => {
  const o = await placeOrder('rej');
  await adminPage(page);
  page.on('console', (m) => console.log('console', m.type(), m.text()));
  await page.goto('/online-orders');
  await page.getByTestId('online-order-row').filter({ hasText: o.orderNo }).click();
  const detail = page.getByTestId('online-order-detail');
  await detail.getByRole('button', { name: 'ยกเลิกออเดอร์' }).click();
  const input = page.locator('#reject-reason');
  await expect(input).toBeVisible();
  console.log('focused:', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
  await page.keyboard.type('สินค้าหมด', { delay: 30 });
  console.log('value after keyboard:', await input.inputValue());
  await page.waitForTimeout(1500);
  console.log('value later:', await input.inputValue());
  await input.click();
  await page.keyboard.type('abc', { delay: 30 });
  console.log('value after click+type:', await input.inputValue());
  console.log('inert:', await page.evaluate(() => Array.from(document.querySelectorAll('[inert]')).map((e) => e.tagName + '.' + String(e.className).slice(0, 40))));
  await page.screenshot({ path: 'test-results/repro-reject.png' });
});
