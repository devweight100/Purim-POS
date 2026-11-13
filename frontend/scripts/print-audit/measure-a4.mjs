// Height of each .a4-page sheet of captured A4 print HTML, in mm (print media, 794 px window).
// Usage: node scripts/print-audit/measure-a4.mjs file.html [...]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await page.emulateMedia({ media: 'print' });
for (const f of process.argv.slice(2)) {
  await page.setContent(fs.readFileSync(f, 'utf8'), { waitUntil: 'networkidle' });
  const r = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.a4-page')).map((el) => {
      const kids = Array.from(el.children).map((c) => Math.round((c.getBoundingClientRect().height / 96) * 25.4));
      // natural height: what the content needs without the 297 mm minimum
      el.style.setProperty('min-height', '0', 'important');
      const natural = Math.round((el.getBoundingClientRect().height / 96) * 25.4 * 10) / 10;
      return { natural, kids };
    }),
  );
  console.log(f.split('/').pop(), JSON.stringify(r));
}
await browser.close();
