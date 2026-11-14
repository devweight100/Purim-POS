import { expect, test, type Request } from '@playwright/test';
import { ADMIN } from './env';
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
