import { expect, test, type Response } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';

/**
 * Product photos are served by URL (GET /api/product-images/:id, small copy with ?size=thumb) instead of base64
 * inside the product list; the POS catalogue loads once and then only asks for changes (GET /api/products/sync).
 * The edit form keeps saved photos by id and uploads new ones with a thumbnail.
 */
// 2x2 PNG (red) and 1x1 PNG (blue thumbnail)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';
const THUMB = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';

interface FullProduct { id: string; images: { id: string; name: string | null; isCover: boolean; dataUrl: string; thumbDataUrl: string | null }[] }

test('photos by URL in the POS and the products page; delta sync; saving keeps photos', async ({ page }) => {
  const token = await apiLogin(ADMIN);
  const sku = `PHOTO-${Date.now()}`;
  const created = await api<FullProduct>('POST', '/products', token, {
    name: 'สินค้ามีรูป E2E', sku, basePrice: 35, priceLevel1: 35, unit: 'ชิ้น',
    images: [{ dataUrl: `data:image/png;base64,${PNG}`, thumbDataUrl: `data:image/png;base64,${THUMB}`, name: 'red.png', isCover: true }],
  });
  const imageId = created.images[0].id;

  const syncCalls: string[] = [];
  const isSync = (r: Response) => r.url().includes('/api/products/sync') && r.ok();
  page.on('response', (r) => {
    if (isSync(r)) syncCalls.push(new URL(r.url()).search);
  });
  const firstSync = page.waitForResponse(isSync);
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  const first = await firstSync;
  // compressed (brotli / gzip, whatever the browser accepts) through the Next.js /api rewrite
  expect(['br', 'gzip']).toContain(first.headers()['content-encoding']);
  const body = await first.json();
  const row = body.products.find((p: { sku: string }) => p.sku === sku);
  expect(row.images[0]).toMatchObject({ id: imageId, url: `/api/product-images/${imageId}`, thumbUrl: `/api/product-images/${imageId}?size=thumb` });
  expect(row.images[0].dataUrl).toBeUndefined();
  expect(row.stockBatches).toBeUndefined();

  // the POS card loads the small copy through the rewrite
  const card = page.locator(`img[src="/api/product-images/${imageId}?size=thumb"]`).first();
  await expect(card).toBeAttached();
  await expect.poll(() => card.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1);

  // later refreshes ask only for changes (cursor), not the whole catalogue
  await expect.poll(() => syncCalls.filter((q) => q.includes('since=')).length, { timeout: 40_000 }).toBeGreaterThan(0);

  // products page: thumbnail in the table, full photo in the edit form; saving keeps the photo row
  await page.goto('/products');
  const search = page.getByPlaceholder('ค้นหาชื่อ, รหัส, บาร์โค้ด...');
  await search.fill(sku);
  const tableRow = page.locator('tr', { hasText: sku }).first();
  const thumb = tableRow.locator('img').first();
  await expect(thumb).toHaveAttribute('src', `/api/product-images/${imageId}?size=thumb`);
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1);
  await tableRow.locator('button:has(svg.lucide-pencil)').click();
  const dialog = page.getByRole('dialog');
  const formImg = dialog.locator(`img[src="/api/product-images/${imageId}"]`);
  await expect(formImg).toBeVisible();
  await expect.poll(() => formImg.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(2);

  // add a second photo from a file; the browser makes the thumbnail
  await dialog.locator('input[type=file]').setInputFiles({ name: 'blue.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await expect(dialog.locator('img[src^="data:image/jpeg"]')).toBeVisible();
  await dialog.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(dialog).toBeHidden();

  const saved = await api<FullProduct>('GET', `/products/${created.id}`, token);
  expect(saved.images).toHaveLength(2);
  expect(saved.images[0]).toMatchObject({ id: imageId, name: 'red.png', isCover: true, dataUrl: `data:image/png;base64,${PNG}`, thumbDataUrl: `data:image/png;base64,${THUMB}` });
  expect(saved.images[1].name).toBe('blue.png');
  expect(saved.images[1].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(saved.images[1].thumbDataUrl).toMatch(/^data:image\/jpeg;base64,/);

  // the photo endpoint needs no login and is cacheable
  const img = await page.request.get(`/api/product-images/${imageId}`, { headers: { authorization: '' } });
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toBe('image/png');
  expect(img.headers()['cache-control']).toContain('immutable');
});
