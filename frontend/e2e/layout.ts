import type { Page } from '@playwright/test';

/** The window sizes the owner checks: 1366x768, 1920x1080 and 1366x768 at Windows 125 % (1093x614 CSS px). */
export const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 1093, height: 614 },
] as const;

/**
 * Horizontal scroll on the page or inside it: the document wider than the window, or a visible element that
 * scrolls sideways (overflow-x auto/scroll with content wider than the box). Returns readable descriptions.
 */
export function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const se = document.scrollingElement as HTMLElement;
    if (se.scrollWidth > se.clientWidth) out.push(`document ${se.scrollWidth} > ${se.clientWidth}`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowX)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden') continue;
      const head = Array.from(el.querySelectorAll('th')).map((t) => (t.textContent || '').trim().slice(0, 12)).slice(0, 4).join('|');
      out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} ${el.scrollWidth} > ${el.clientWidth} ${head}`);
    }
    return out;
  });
}

/**
 * Spacing rule (round 2): buttons / links / selects that are on screen keep >= 8 px from a neighbour on the same
 * row (or column) and >= 16 px from the window edge. Only what is really visible counts (elementFromPoint), the
 * back-office sidebar and toasts are left out. `within` limits the check to one area.
 */
export function spacingIssues(page: Page, within?: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root: ParentNode = sel ? document.querySelector(sel) ?? document : document;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.top < 0 || r.bottom > vh || r.left < 0 || r.right > vw) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
    };
    const all = Array.from(root.querySelectorAll('button, a[href], [role="button"], select'))
      .filter((b) => !b.closest('[data-sonner-toaster], nextjs-portal, [data-slot="sidebar"]'))
      .filter(visible);
    // inner controls of a row button (a card with unit buttons) are judged inside their own group only
    const name = (b: Element) => ((b.getAttribute('aria-label') || b.textContent || b.tagName) as string).trim().replace(/\s+/g, ' ').slice(0, 24);
    const rects = all.map((b) => b.getBoundingClientRect());
    const issues: string[] = [];
    for (let i = 0; i < all.length; i++) {
      const a = rects[i];
      if (a.left < 15.5) issues.push(`edge-left ${Math.round(a.left)}px: ${name(all[i])}`);
      if (vw - a.right < 15.5) issues.push(`edge-right ${Math.round(vw - a.right)}px: ${name(all[i])}`);
      for (let j = i + 1; j < all.length; j++) {
        if (all[i].contains(all[j]) || all[j].contains(all[i])) continue;
        const b = rects[j];
        const v = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const h = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        let gap: number | null = null;
        if (v > Math.min(a.height, b.height) / 2) gap = Math.max(a.left, b.left) - Math.min(a.right, b.right);
        else if (h > Math.min(a.width, b.width) / 2) gap = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom);
        if (gap !== null && gap > -1 && gap < 7.5) issues.push(`gap ${Math.round(gap)}px: ${name(all[i])} | ${name(all[j])}`);
      }
    }
    return Array.from(new Set(issues));
  }, within);
}
