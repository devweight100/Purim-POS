import { expect, test, type Request } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';

interface BillsPage {
  data: { poId: string; poNumber: string; remainingPayable: number; paymentStatus: string; alreadyPaidAmount: number; alreadyDiscountAmount: number }[];
  meta: { total: number };
  summary: { billCount: number; suppliers: { supplierId: string; openCount: number }[] };
}

/**
 * Payables are computed and paged by the server (GET /payables/bills): 52 bills of one supplier = 2 pages, the
 * selection survives paging, the settle dialog pays the selected bills with a discount (the discount lowers what is
 * paid, the bills are settled), the voucher shows in the history. The supplier-returns dialog loads the chosen
 * supplier's POs from the server; the page asks for every returnable claim (GET /claims/returnable).
 */
test('payables: server pages, selection across pages, settle several bills with a discount', async ({ page }) => {
  const token = await apiLogin(ADMIN);
  const tag = `AP${Date.now()}`;
  const sup = await api<{ id: string; name: string }>('POST', '/suppliers', token, { name: `ผู้ขาย ${tag}`, creditTerms: 30 });
  const prod = await api<{ id: string }>('POST', '/products', token, { name: `สินค้า ${tag}`, sku: `${tag}-P`, basePrice: 50, priceLevel1: 50, unit: 'ชิ้น' });
  for (let i = 0; i < 52; i++) {
    const po = await api<{ id: string; items: { id: string }[] }>('POST', '/purchase-orders', token, {
      supplierId: sup.id, status: 'ISSUED', items: [{ productId: prod.id, quantity: 1, unitCost: 10 + i }],
    });
    await api('POST', `/purchase-orders/${po.id}/receive`, token, {
      clientReceiptId: crypto.randomUUID(), items: [{ purchaseOrderItemId: po.items[0].id, receivedQty: 1, unitCost: 10 + i }],
    });
  }
  const all = await api<BillsPage>('GET', `/payables/bills?search=${encodeURIComponent(tag)}&limit=500`, token);
  expect(all.meta.total).toBe(52);

  const requests: string[] = [];
  page.on('request', (r: Request) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) requests.push(decodeURIComponent(u.pathname + u.search));
  });
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);

  await page.goto('/payables');
  await expect.poll(() => requests.some((r) => r.startsWith('/api/payables/bills?page=1&limit=50'))).toBe(true);
  // the page no longer downloads every PO / the newest 200 vouchers to build the bills
  expect(requests.some((r) => r.startsWith('/api/purchase-orders'))).toBe(false);

  await page.getByPlaceholder('ค้นหาเลขที่ PO, ชื่อบริษัทผู้จำหน่าย...').fill(tag);
  await expect.poll(() => requests.some((r) => r.includes('/api/payables/bills?') && r.includes(`search=${tag}`))).toBe(true);
  await expect(page.getByTestId('bill-pager')).toContainText('จากทั้งหมด 52 บิล');
  const rows = page.locator('tbody tr', { hasText: tag });
  await expect(rows).toHaveCount(50);

  // newest first: page 2 holds the 2 oldest bills; select them, then one bill on page 1
  await page.getByTestId('bill-pager').getByTitle('หน้าถัดไป').click();
  await expect(rows).toHaveCount(2);
  await page.locator('thead').getByRole('checkbox').check({ force: true });
  await page.getByTestId('bill-pager').getByTitle('หน้าแรก').click();
  await expect(rows).toHaveCount(50);
  await rows.first().getByRole('checkbox').check({ force: true });
  await expect(page.getByText('3 บิล', { exact: true })).toBeVisible();
  // oldest two cost 10 + 11, the newest 61
  await expect(page.getByText('เลือกบิลแล้ว ยอดรวม:')).toContainText('฿82');

  await page.getByRole('button', { name: /สร้างใบชำระหนี้ \(ออกใบสำคัญจ่าย\)/ }).click();
  await expect.poll(() => requests.some((r) => r.includes('/api/payables/bills?') && r.includes('open=1') && r.includes('slim=1'))).toBe(true);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /บันทึกชำระหนี้/ })).toBeEnabled();
  await dialog.getByPlaceholder('0.00').fill('2');
  await expect(dialog.getByText('ยอดเงินสุทธิที่ต้องจ่ายจริง:').locator('..')).toContainText('฿80');
  await dialog.getByRole('button', { name: /บันทึกชำระหนี้/ }).click();
  await expect(page.getByText(/สร้างใบชำระหนี้ .* สำเร็จ \(3 บิล\)/)).toBeVisible();

  // server: the 3 bills are settled; the discount lowered what was paid (82 of bills = 80 money + 2 discount)
  const paid = await api<BillsPage>('GET', `/payables/bills?search=${encodeURIComponent(tag)}&paymentStatus=PAID&limit=500`, token);
  expect(paid.data.map((b) => b.remainingPayable)).toEqual([0, 0, 0]);
  expect(paid.data.every((b) => b.alreadyDiscountAmount === 2)).toBe(true);
  const vouchers = await api<{ data: { voucherNumber: string; netPaidAmount: string; discountAmount: string; totalBillsAmount: string }[] }>(
    'GET', `/payables/vouchers?search=${encodeURIComponent(sup.name)}`, token);
  expect(vouchers.data).toHaveLength(1);
  expect([Number(vouchers.data[0].totalBillsAmount), Number(vouchers.data[0].discountAmount), Number(vouchers.data[0].netPaidAmount)]).toEqual([82, 2, 80]);

  // the voucher (print view) opened; the history tab lists it; the supplier card counts the 49 open bills
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /ประวัติการจ่ายเงิน/ }).click();
  await expect(page.getByText(vouchers.data[0].voucherNumber).first()).toBeVisible();
  await page.getByRole('tab', { name: /สรุปยอดหนี้ตามบริษัท/ }).click();
  const card = page.locator('div.rounded-2xl', { hasText: sup.name }).filter({ hasText: 'บิลค้าง' }).last();
  await expect(card).toContainText('49 บิลค้าง');

  // supplier returns: the dialog loads this supplier's POs (all pages) from the server
  requests.length = 0;
  await page.goto('/supplier-returns');
  await page.getByRole('button', { name: /สร้างใบส่งคืน \/ ลดหนี้บริษัท/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(sup.name) }).first().click();
  await expect.poll(() => requests.some((r) => r.startsWith(`/api/purchase-orders?supplierId=${sup.id}`))).toBe(true);
  const oldestOpen = all.data[all.data.length - 3].poNumber; // still unpaid after the voucher above
  await expect(page.getByRole('dialog').getByText(oldestOpen)).toBeVisible();
  expect(requests.some((r) => r.includes('/api/purchase-orders?limit=1000'))).toBe(false);
  // pending supplier claims: every returnable claim from the server, not the newest 500 claims
  expect(requests).toContain('/api/claims/returnable');
  expect(requests.some((r) => r.startsWith('/api/claims?'))).toBe(false);
});
