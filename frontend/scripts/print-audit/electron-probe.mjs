// Drives the real desktop app (Electron) against running servers and records which print path
// each slip takes (main-process log) and the ESC/POS bytes it would send (PURIM_RAW_OUT).
// Usage (from frontend/):
//   xvfb-run -a node scripts/print-audit/electron-probe.mjs <electron binary> <desktop dir> <frontend url> <out dir> <orderNumber>
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [, , electronBin, desktopDir, frontend, out, orderNumber] = process.argv;
const home = path.join(out, 'home');
const userData = path.join(home, '.config', 'purim-pos-desktop');
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(
  path.join(userData, 'purim-pos-config.json'),
  JSON.stringify({ serverUrl: frontend, printerName: 'EPSON TM-T82 Receipt', kickMethod: 'auto', ...(process.env.PA_RECEIPT_MODE ? { receiptPrintMode: process.env.PA_RECEIPT_MODE } : {}) }),
);
const logs = [];
const app = await electron.launch({
  executablePath: electronBin,
  args: [desktopDir, '--no-sandbox'],
  env: {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    // PA_MODE=fallback: RAW sending fails (as on a PC whose spooler refuses it) -> driver fallback
    ...(process.env.PA_MODE === 'fallback' ? { PURIM_DRIVER_OUT: path.join(out, 'raw.bin') } : { PURIM_RAW_OUT: path.join(out, 'raw.bin') }),
    PURIM_PRINT_DEBUG: '1',
  },
});
app.process().stdout.on('data', (d) => logs.push(String(d)));
app.process().stderr.on('data', (d) => logs.push(String(d)));

let page;
for (let i = 0; i < 90 && !page; i++) {
  page = app.windows().find((w) => w.url().startsWith(frontend));
  if (!page) await new Promise((r) => setTimeout(r, 1000));
}
if (!page) {
  console.log('no app window', app.windows().map((w) => w.url()), logs.join(''));
  await app.close();
  process.exit(1);
}

const raw = path.join(out, 'raw.bin');
async function step(label, fn) {
  logs.push(`\n===== ${label}\n`);
  try {
    await fn();
  } catch (e) {
    logs.push(`[probe] step failed: ${String(e).split('\n')[0]}\n`);
    await page.screenshot({ path: path.join(out, `${label}-failed.png`) });
    return;
  }
  for (let i = 0; i < 20 && !fs.existsSync(raw); i++) await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 1500));
  if (fs.existsSync(raw)) {
    fs.renameSync(raw, path.join(out, `${label}.${process.env.PA_MODE === 'fallback' ? 'pdf' : 'bin'}`));
    logs.push(`[probe] raster bytes saved: ${label}.bin\n`);
  } else {
    logs.push(`[probe] NO raster bytes for ${label}\n`);
  }
}

await page.waitForLoadState();
await page.waitForTimeout(2000);
if (page.url().includes('/login')) {
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(process.env.PA_PASSWORD || 'Admin#Print2026');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/pos/);
}

for (const where of (process.env.PA_STEPS || 'orders').split(',')) {
  await step(`slip-${where}`, async () => {
    if (where === 'orders') {
      await page.goto(`${frontend}/orders`);
      await page.getByText(orderNumber).first().click();
      await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์สลิป 80mm/ }).click();
    } else {
      await page.goto(`${frontend}/pos`);
      await page.waitForTimeout(1500);
      for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i++) await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /ประวัติ/ }).first().click();
      await page.getByRole('dialog').last().getByText(orderNumber).first().click();
    }
    const dlg = page.getByRole('dialog').filter({ hasText: 'ตัวอย่างใบเสร็จรับเงิน' });
    await dlg.waitFor();
    await page.waitForTimeout(500);
    await dlg.getByRole('button', { name: /^พิมพ์ใบเสร็จ/ }).click();
  });
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
}

await page.screenshot({ path: path.join(out, 'window.png') });
fs.writeFileSync(path.join(out, 'electron-log.txt'), logs.join(''));
await app.close();
console.log(
  logs
    .join('')
    .split('\n')
    .filter((l) => /raster|print|=====|probe|silent/i.test(l))
    .join('\n'),
);
