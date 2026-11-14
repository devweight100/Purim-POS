import { expect, test, type Request } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';

/**
 * The management lists are paged, searched and sorted by the server: the products table asks GET /products/page,
 * the customers page GET /customers?page=, the orders page GET /orders?page=; totals come from the server.
 */
test('products, customers and orders pages ask the server for one page at a time', async ({ page }) => {
  const token = await apiLogin(ADMIN);
  const tag = `PG${Date.now()}`;
  for (let i = 0; i < 55; i++) {
    await api('POST', '/products', token, { name: `แบ่งหน้า ${tag} ${String(i).padStart(2, '0')}`, sku: `${tag}-${i}`, basePrice: 10 + i, priceLevel1: 10 + i, unit: 'ชิ้น' });
  }
  await api('POST', '/customers', token, { name: `ลูกค้าแบ่งหน้า ${tag}`, phone: `09${String(Date.now()).slice(-8)}` });
  const allProducts = await api<unknown[]>('GET', '/products', token);

  const requests: string[] = [];
  page.on('request', (r: Request) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) requests.push(u.pathname + u.search);
  });
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);

  // products: search runs on the server, 55 matches = 2 pages of 50
  await page.goto('/products');
  await page.getByPlaceholder('ค้นหาชื่อ, รหัส, บาร์โค้ด...').fill(tag);
  await expect.poll(() => requests.some((r) => r.startsWith('/api/products/page?') && r.includes(`q=${tag}`))).toBe(true);
  await expect(page.getByText(/แสดง\s*1\s*-\s*50\s*จากทั้งหมด\s*55\s*รายการ/)).toBeVisible();
  // sort by name descending on the server: the first row is the last name
  await page.getByRole('columnheader', { name: /ชื่อสินค้า/ }).click();
  await page.getByRole('columnheader', { name: /ชื่อสินค้า/ }).click();
  await expect(page.locator('tbody tr').first()).toContainText(`${tag} 54`);
  expect(requests.some((r) => r.includes('sort=name') && r.includes('dir=desc'))).toBe(true);
  await page.getByRole('button', { name: 'ถัดไป ›' }).click();
  await expect(page.locator('tbody tr', { hasText: tag })).toHaveCount(5);
  // export = every product, not the page
  await page.getByRole('button', { name: /ส่งออก Excel/ }).click();
  await expect(page.getByText(`ส่งออกข้อมูลสินค้า ${allProducts.length} รายการ`)).toBeVisible();

  // customers: server search
  await page.goto('/customers');
  await page.getByPlaceholder(/ค้นหา/).first().fill(tag);
  await expect(page.locator('tbody tr', { hasText: `ลูกค้าแบ่งหน้า ${tag}` })).toHaveCount(1);
  await expect.poll(() => requests.some((r) => r.startsWith('/api/customers?') && r.includes('page=1') && r.includes(`search=${tag}`))).toBe(true);

  // orders: page + range counts from the server
  const orders = await api<{ meta: { total: number } }>('GET', '/orders?limit=1', token);
  await page.goto('/orders');
  await expect(page.getByText(`จากทั้งหมด ${orders.meta.total.toLocaleString()} บิล`)).toBeVisible();
  expect(requests.some((r) => r.startsWith('/api/orders?') && r.includes('counts=1') && r.includes('page=1'))).toBe(true);
  // the orders page no longer downloads the product list
  expect(requests.filter((r) => r === '/api/products').length).toBe(0);
  // claimed badges: asked for the bills of the page (when it has bills), never the newest-500 claims list
  if (orders.meta.total > 0) await expect.poll(() => requests.some((r) => r.startsWith('/api/claims/claimed-orders?orderIds='))).toBe(true);
  expect(requests.some((r) => r.startsWith('/api/claims?'))).toBe(false);
});
