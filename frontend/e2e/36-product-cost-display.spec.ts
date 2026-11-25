import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Owner 2026-11-25: ต้นทุน edited in the product form (65) shows in the products and inventory tables at once;
 * the FIFO cost of the stock on hand (59.50) shows below it as a small "สต็อก ฿59.50" when the two differ, and
 * no second line when they are equal. The stock value (มูลค่าสต็อก) stays at the stock-on-hand cost.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-6);
const NAME = `น้ำยาล้างจาน สูตรมะนาว ขนาดแกลลอน 3.8 ลิตร-${TAG}`;
let token = '';
let productId = '';

type PageRes = { data: Array<{ id: string; unitCost?: number | null }>; stats: { totalValuation: number } };
const pageRes = () => api<PageRes>('GET', `/products/page?page=1&limit=5&stats=1&q=${encodeURIComponent(TAG)}`, token);

async function editCost(page: Page, value: string) {
  await page.goto('/products');
  await page.getByLabel(/^ค้นหาสินค้า/).fill(TAG);
  const row = page.locator('[data-row-nav]').filter({ hasText: NAME });
  await expect(row).toHaveCount(1);
  await row.focus();
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog').filter({ hasText: 'แก้ไขสินค้า' });
  await expect(form).toBeVisible();
  await form.locator('#product-form-cost').fill(value);
  await form.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(form).toBeHidden();
  return row;
}

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  const p = await api<{ id: string }>('POST', '/products', token, { name: NAME, basePrice: 89, priceLevel1: 89, costPrice: 59.5, unit: 'แกลลอน' });
  productId = p.id;
  await api('POST', '/inventory/adjust', token, { productId, type: 'ADD', amount: 10, unitCost: 59.5, reason: 'ปรับยอดเริ่มต้น' });
});

test('edited ต้นทุน shows in the products and inventory tables at once; the stock-on-hand cost as a second line', async ({ page }) => {
  const valuationBefore = (await pageRes()).stats.totalValuation;
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);

  // equal costs: one line only
  await page.goto('/products');
  await page.getByLabel(/^ค้นหาสินค้า/).fill(TAG);
  let cost = page.locator('[data-row-nav]').filter({ hasText: NAME }).getByTestId('product-cost');
  await expect(cost).toHaveText('฿59.50');
  await expect(cost.getByTestId('product-stock-cost')).toHaveCount(0);

  // 65 typed in the form: the table shows it right after saving, the stock cost below
  const row = await editCost(page, '65');
  cost = row.getByTestId('product-cost');
  await expect(cost.locator('span').first()).toHaveText('฿65.00');
  await expect(cost.getByTestId('product-stock-cost')).toHaveText('สต็อก ฿59.50');
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await expect.poll(() => horizontalOverflow(page), { message: `products ${size.width}x${size.height}` }).toEqual([]);
  }
  await page.setViewportSize(SIZES[0]);

  await page.goto('/inventory');
  await page.getByPlaceholder('ค้นหาชื่อสินค้า, SKU, บาร์โค้ด...').fill(TAG);
  const inv = page.locator('tr').filter({ hasText: NAME }).getByTestId('inventory-cost');
  await expect(inv.locator('span').first()).toHaveText('฿65.00');
  await expect(inv.getByTestId('inventory-stock-cost')).toHaveText('สต็อก ฿59.50');
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await expect.poll(() => horizontalOverflow(page), { message: `inventory ${size.width}x${size.height}` }).toEqual([]);
  }
  await page.setViewportSize(SIZES[0]);

  // the stock value is still 10 x 59.50 (FIFO), not 10 x 65
  expect((await pageRes()).stats.totalValuation).toBeCloseTo(valuationBefore, 6);
  expect((await pageRes()).data[0].unitCost).toBe(59.5);

  // back to 59.50: no second line in either table
  const again = await editCost(page, '59.5');
  await expect(again.getByTestId('product-cost')).toHaveText('฿59.50');
  await page.goto('/inventory');
  await page.getByPlaceholder('ค้นหาชื่อสินค้า, SKU, บาร์โค้ด...').fill(TAG);
  const inv2 = page.locator('tr').filter({ hasText: NAME }).getByTestId('inventory-cost');
  await expect(inv2).toHaveText('฿59.50');
  await expect(inv2.getByTestId('inventory-stock-cost')).toHaveCount(0);
});
