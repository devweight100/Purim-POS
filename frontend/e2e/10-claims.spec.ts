import { expect, test, type Request } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ADMIN, BACKEND_DIR } from './env';
import { api, apiLogin, uiLogin } from './helpers';

/**
 * The claims screens ask the server for what they show, over every claim (they read the newest 500 claims):
 * the claims page pages / searches on the server with summary cards over every claim, the claim stock page and the
 * dashboard get their figures computed on the server, the supplier returns page its cards per supplier.
 */
test('claims page, claim stock, dashboard and supplier returns use the server claims queries', async ({ page }) => {
  const token = await apiLogin(ADMIN);
  const tag = `CLQ${Date.now()}`;
  const product = await api<{ id: string }>('POST', '/products', token, { name: `เคลม ${tag}`, sku: `${tag}-P`, basePrice: 80, priceLevel1: 80, costPrice: 40, unit: 'ชิ้น' });
  const made: string[] = [];
  for (let i = 0; i < 17; i++) {
    const c = await api<{ claimNumber: string }>('POST', '/claims', token, {
      productId: product.id, quantity: 1, claimType: 'WARRANTY', resolutionType: 'SUPPLIER_RMA', problemDescription: `ชำรุด ${tag} ${i}`,
    });
    made.push(c.claimNumber);
  }
  expect(new Set(made).size).toBe(17);
  const all = await api<{ meta: { total: number }; summary: { totalClaims: number } }>('GET', '/claims/list?limit=1', token);

  const requests: string[] = [];
  page.on('request', (r: Request) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) requests.push(u.pathname + u.search);
  });
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);

  // claims page: 17 matches of the search = 2 pages of 15; the card counts every claim
  await page.goto('/claims');
  await expect(page.getByText(`จากทั้งหมด ${all.meta.total} รายการ`)).toBeVisible();
  await page.getByPlaceholder(/ค้นหาเลขที่ใบเคลม/).fill(tag);
  await expect(page.getByText('จากทั้งหมด 17 รายการ')).toBeVisible();
  await expect.poll(() => requests.some((r) => r.startsWith('/api/claims/list?') && r.includes(`search=${tag}`))).toBe(true);
  await expect(page.locator('tbody tr', { hasText: made[16] })).toHaveCount(1); // newest first
  await page.getByText('หน้า 1 จาก 2').locator('xpath=following-sibling::button[1]').click();
  await expect(page.locator('tbody tr', { hasText: made[0] })).toHaveCount(1);
  await expect(page.getByText(String(all.summary.totalClaims), { exact: true }).first()).toBeVisible();

  // claim stock: figures and pages from the server
  await page.goto('/claim-inventory');
  await expect.poll(() => requests.some((r) => r.startsWith('/api/claims/claim-stock?'))).toBe(true);
  await page.getByPlaceholder(/ค้นหา/).first().fill(tag);
  await expect(page.getByText(`เคลม ${tag}`).first()).toBeVisible();

  // dashboard: claim refunds of the period from the server
  await page.goto('/dashboard');
  await expect.poll(() => requests.some((r) => r.startsWith('/api/claims/refund-summary'))).toBe(true);

  // supplier returns: cards per supplier from the server
  await page.goto('/supplier-returns');
  await expect.poll(() => requests.includes('/api/claims/returnable/summary')).toBe(true);

  expect(requests.some((r) => r.startsWith('/api/claims?') || r === '/api/claims/returnable')).toBe(false);
});

/**
 * A bill older than the newest 500 bills can be claimed: the claim dialog (claims page) and the POS "สิทธิ์เคลม"
 * search every bill on the server (they read GET /orders?limit=500 before).
 */
test('claim search finds a bill older than the newest 500 bills', async ({ page }) => {
  const token = await apiLogin(ADMIN);
  const tag = `OLDB${Date.now()}`;
  const req = createRequire(path.join(BACKEND_DIR, 'package.json'));
  const { PrismaClient } = req('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const product = await api<{ id: string }>('POST', '/products', token, { name: `ของเก่า ${tag}`, sku: `${tag}-P`, basePrice: 90, priceLevel1: 90, costPrice: 40, unit: 'ชิ้น' });
  let orderNumber = '';
  try {
    const admin = await db.user.findFirst({ where: { username: ADMIN.username } });
    const customer = await db.customer.create({ data: { name: `ลูกค้าบิลเก่า ${tag}`, phone: `08${String(Date.now()).slice(-8)}` } });
    orderNumber = `${tag}-B`;
    await db.order.create({
      data: { orderNumber, userId: admin.id, customerId: customer.id, subtotal: 90, totalAmount: 90, createdAt: new Date('2019-01-15T04:00:00Z'),
        items: { create: [{ productId: product.id, quantity: 1, baseQuantity: 1, unitName: 'ชิ้น', unitPrice: 90, total: 90 }] } },
    });
    const now = Date.now();
    await db.order.createMany({ data: Array.from({ length: 510 }, (_, k) => ({ orderNumber: `${tag}-N${k}`, userId: admin.id, subtotal: 1, totalAmount: 1, createdAt: new Date(now - k * 1000) })) });
  } finally {
    await db.$disconnect();
  }
  const newest = await api<{ data: { orderNumber: string }[] }>('GET', '/orders?limit=500', token);
  expect(newest.data.some((o) => o.orderNumber === orderNumber)).toBe(false);

  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/claims');
  await page.getByRole('button', { name: 'รับเคลมสินค้าใหม่' }).first().click();
  const searched = page.waitForRequest((r) => r.url().includes('/api/orders?') && r.url().includes('scope=claim'));
  await page.getByPlaceholder(/พิมพ์ค้นหา เช่น ORD-2026/).fill(orderNumber);
  await searched;
  await expect(page.locator('tr', { hasText: orderNumber }).filter({ hasText: `ของเก่า ${tag}` })).toHaveCount(1);
  await page.keyboard.press('Escape');

  // POS "สิทธิ์เคลม": the customer's claimable stock includes the old bill
  await page.goto('/pos');
  // no shift open on this terminal: skip opening one (looking up claims needs no shift)
  await page.getByRole('button', { name: 'ข้ามการเปิดกะ' }).click();
  await page.getByRole('button', { name: 'สิทธิ์เคลม' }).first().click();
  await page.getByPlaceholder('ค้นหาชื่อลูกค้า / เบอร์โทร / เลขบิล...').fill(`ลูกค้าบิลเก่า ${tag}`);
  await page.keyboard.press('Enter');
  await expect(page.getByText(`ของเก่า ${tag}`).first()).toBeVisible();
});
