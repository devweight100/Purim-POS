'use strict';
/**
 * Keyboard shortcuts of the desktop app menu (docs/pos-keys-refresh.md).
 *
 * Rule: the web pages own F1-F12 and the plain Ctrl / Alt shortcuts (a menu accelerator fires before the page's
 * keydown, so a desktop F2 used to steal the POS key). Desktop-only shortcuts therefore use Ctrl+Shift+... and are
 * menu accelerators only (never globalShortcut, which would also take the key from every other program).
 * The only F-key the app keeps is F11 (fullscreen): no page uses it. F5 is left to the page: the POS refreshes its
 * data (รีเฟรชข้อมูล), other pages reload themselves like in a browser.
 */

/** Desktop menu accelerators (Electron accelerator syntax). */
const DESKTOP_SHORTCUTS = Object.freeze({
  start: 'CommandOrControl+Shift+H', // หน้าเริ่มต้น (เลือก หน้าขาย / หลังบ้าน)
  pos: 'CommandOrControl+Shift+1', // หน้าขาย (POS); 1 / 2 like the start screen buttons
  backOffice: 'CommandOrControl+Shift+2', // หลังบ้าน (first back-office page the user may open)
  products: 'CommandOrControl+Shift+3', // สินค้า (was Ctrl+Shift+P = the POS hold-bill key)
  inventory: 'CommandOrControl+Shift+I',
  reports: 'CommandOrControl+Shift+R',
  reload: 'CommandOrControl+R',
  fullscreen: 'F11',
  serverSetup: 'CommandOrControl+Shift+S',
});

const F_KEYS = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);

/**
 * Shortcuts of the web pages (POS, back office, dialogs). A desktop accelerator must never equal one of them.
 * F-keys: POS F2 quantity, F3 item discount / document search, F4 price, F5 refresh data, F8 picking slip,
 * F9 cash drawer, F10 held bills, F12 payment; F1, F6, F7 are kept free for the page as well.
 */
const PAGE_SHORTCUTS = Object.freeze([
  ...F_KEYS.filter((k) => k !== 'F11'),
  'CommandOrControl+P', // hold bill / held bills
  'CommandOrControl+Shift+P', // hold bill / held bills
  'CommandOrControl+H', // sales history
  'CommandOrControl+M', // member
  'CommandOrControl+E', // clear cart
  'CommandOrControl+B', // collapse the back-office sidebar
  'CommandOrControl+Enter', // save (product form, PO)
  'Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5', // start-of-bill price level
]);

/** Same accelerator written differently (CmdOrCtrl / Ctrl / Control, any case, any modifier order). */
function normalizeAccelerator(acc) {
  const parts = String(acc || '').split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const alias = { cmdorctrl: 'ctrl', commandorcontrol: 'ctrl', control: 'ctrl', command: 'ctrl', cmd: 'ctrl', option: 'alt' };
  const mapped = parts.map((p) => alias[p] || p);
  const key = mapped.pop() || '';
  const order = ['ctrl', 'alt', 'shift', 'super'];
  const mods = [...new Set(mapped)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...mods, key].join('+');
}

/** Problems of an accelerator map (empty = fine): F-keys other than F11, page shortcuts, duplicates. */
function shortcutProblems(map = DESKTOP_SHORTCUTS) {
  const page = new Set(PAGE_SHORTCUTS.map(normalizeAccelerator));
  const seen = new Map();
  const problems = [];
  for (const [name, acc] of Object.entries(map)) {
    const n = normalizeAccelerator(acc);
    const key = n.split('+').pop();
    if (/^f\d+$/.test(key) && n !== 'f11') problems.push(`${name}: ${acc} uses an F-key (only F11 is allowed)`);
    if (page.has(n)) problems.push(`${name}: ${acc} is a page shortcut`);
    if (seen.has(n)) problems.push(`${name}: ${acc} duplicates ${seen.get(n)}`);
    seen.set(n, name);
  }
  return problems;
}

/** Text for a menu / guide: CommandOrControl+Shift+1 -> Ctrl+Shift+1. */
function shortcutLabel(acc) {
  return String(acc).replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl');
}

module.exports = { DESKTOP_SHORTCUTS, PAGE_SHORTCUTS, normalizeAccelerator, shortcutProblems, shortcutLabel };
