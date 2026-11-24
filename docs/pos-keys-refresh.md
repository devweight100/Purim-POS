# POS keys + live data refresh (F2 conflict, F5 รีเฟรชข้อมูล)

Progress file for this round (keep committed). Owner issues:
1. Desktop app: F2 in the POS jumps to the back office (F2 is a POS key).
2. The POS does not pick up back-office edits made after it loaded the products; owner asks for F5 or better.

## Plan / status
- [x] 1. Desktop accelerator audit + fix (menu-shortcuts.js, tests, docs)
- [x] 2a. Reproduce live-update gaps (two browsers), find root causes
- [x] 2b. Fix causes (settings announced + re-read on the event, member name, cart)
- [x] 2c. Cart re-pricing with notice (not while payment dialog open)
- [x] 2d. F5 รีเฟรชข้อมูล + last-sync time + hint
- [x] 2e. Tests (backend e2e, Playwright, desktop), docs, screenshots, PROJECT_STATUS

## 1. Desktop shortcut audit

Page shortcuts (frontend): POS `use-pos-keyboard.ts` / `PosListLayout.tsx`: F2 quantity, F3 item discount
(empty cart: global document search F3), F4 price, F8 picking slip, F9 cash drawer, F10 / Ctrl+P / Ctrl+Shift+P
held bills, F12 payment, Ctrl+H history, Ctrl+M member, Ctrl+E clear cart, arrows / Delete / + / -;
start-of-bill dialog Alt+1..5 (price level); back office Ctrl+B (sidebar), Ctrl+Enter (product form, PO);
dialogs: Enter / Escape / numpad keys. New: F5 รีเฟรชข้อมูล (POS).

Desktop before (desktop/main.js):

| Key | Where | Action | Conflict |
|---|---|---|---|
| F1 | menu + **globalShortcut** | POS | global: taken from every program; F-key rule |
| F2 | menu + **globalShortcut** | back office | **POS F2** (root cause of the owner's issue) |
| Ctrl+Shift+P | menu | products page | **POS Ctrl+Shift+P = held bills** |
| Ctrl+Shift+H | menu | start screen | none |
| Ctrl+Shift+I | menu | inventory | none |
| Ctrl+Shift+R | menu | reports | none |
| Ctrl+R | menu | reload | none (page does not use it) |
| F11 | menu + **globalShortcut** | fullscreen | none on the page; global was wrong |
| Ctrl+Shift+S | menu + **globalShortcut** | server setup | none on the page; global was wrong |

Root cause: `globalShortcut.register('F2', ...)` (and the F2 menu accelerator) added in the start-chooser round.
A global shortcut is taken by Electron before the page ever sees the key (and from every other program on the
PC); a menu accelerator also fires before the page's keydown.

After (`desktop/menu-shortcuts.js`, menu accelerators only, no globalShortcut):

| Key | Action |
|---|---|
| Ctrl+Shift+H | หน้าเริ่มต้น (เลือก หน้าขาย / หลังบ้าน) |
| Ctrl+Shift+1 | หน้าขาย (POS) |
| Ctrl+Shift+2 | หลังบ้าน |
| Ctrl+Shift+3 | สินค้า |
| Ctrl+Shift+I | คลังสินค้า |
| Ctrl+Shift+R | รายงาน |
| Ctrl+Shift+S | ตั้งค่าเชื่อมต่อเซิร์ฟเวอร์ |
| Ctrl+R | โหลดหน้าจอใหม่ |
| F11 | เต็มจอ |

Rule (tested by `desktop/menu-shortcuts.test.js`): no F-key except F11; desktop-only shortcuts are Ctrl+Shift+...;
none equals a page shortcut; main.js takes every accelerator from the map and registers no global shortcut.
F5: Electron with an app menu has no F5 reload, so F5 reaches the page: the POS handles it (รีเฟรชข้อมูล);
other pages reload themselves when running in the desktop app (the browser reloads on F5 by itself).
Needs a new desktop client release (the old client keeps the global F2 until updated).

## 2. POS did not pick up back-office edits

### Measured (POS open in one browser, edits from a second one; perf-free test DB, `next start` + built backend)

| Edit | Reached the open POS (before) | Mechanism |
|---|---|---|
| ราคา 1-5, pack prices, name, manufacturer, barcode add / change | 0.4-2.1 s | product_changes trigger -> SSE `product` -> delta |
| category, active / inactive, stock adjust, new product, deleted product | 0.4-2.1 s | same |
| member price level | 0.6 s (open bill re-priced) | customer_changes -> SSE `customer` -> customer delta |
| customer name | list in 0.6 s, **name on the open bill never** | |
| VAT, receipt options | **3-15 s** (only the 15 s poll; the `settings` event was ignored) | |
| price level names | **3-15 s**, never announced (online_shop_config not mapped to an event) | |
| **lines already in the cart** | **never** (price captured when scanned) | |

SSE through the Next rewrite (`next start`, as the installer runs it) is not buffered: events arrive in ms. The
catalogue / customer delta syncs and every database trigger were complete (backend e2e block "POS live data"
proves each edit type writes product_changes / customer_changes and shows in the next delta).

### Root causes
1. **Cart lines kept the price they were scanned at.** Since the price-level round each line carries its own level
   prices; a catalogue change re-priced nothing until the cart was touched (and a line with a discount never).
   With the POS open and items already scanned / a held bill recalled, the till charged the old price. This is
   what the owner saw ("the POS had already loaded").
2. **Settings were poll-only**: the client ignored the realtime `settings` event, and level names
   (`online_shop_config`) produced no event at all -> up to 15 s, VAT / receipt / level names on a bill.
3. The member name on an open bill did not follow a rename.

Not causes (checked): missing product_changes rows (all tables have triggers incl. packs / barcodes / suppliers /
categories), SSE in the desktop app (same `next start` proxy; Electron does not throttle a visible window),
selling-device flag (the POS always keeps the catalogue), stale IndexedDB (only used when the server is unreachable;
the next load is a full one).

### Fixes
- `lib/pos/cart-catalogue-refresh.ts` + `cart-store.applyCatalogPrices`: after every catalogue change the lines priced
  by the catalogue are re-priced at the bill level (fresh level prices, roll-up, wholesale steps); manual (F4) and
  agreed online-order prices, an edited old bill and held bills are untouched; lines keep their order; changed lines
  show "ราคาอัปเดต ฿20.00 → ฿25.00" (until the next cart change) and a toast "ราคาอัปเดต: …". Never while the
  payment dialog is open: it runs when the dialog closes.
- Realtime `settings` -> settings re-read at once; `online_shop_config` writes announce `settings`;
  GET /settings returns `settingsVersion` (store settings + level names updated_at).
- Open bill takes the member's new name.
- F5 = รีเฟรชข้อมูล (`lib/pos/pos-refresh.ts`): server check (GET /api/version, 2.5 s); offline -> "ออฟไลน์อยู่"
  toast, nothing replaced; online -> unsent bills pushed first, then full catalogue (`fetchProducts({ full })`),
  full customer list (`fetchCustomers({ full })`), settings and shift; toast "รีเฟรชข้อมูลแล้ว HH:MM:SS".
  Cart, held bills and the outbox are never cleared. Works while a dialog is open (never reloads the POS).
  Button `PosRefreshButton` in the POS top bar (touch) / action bar (list): icon, F5 chip, last catalogue sync time
  (`lib/sync-status.ts`).
- F5 elsewhere: the browser reloads; in the desktop app (no F5 in its menu) `ClientDbSync` reloads the page.

### Tests
- backend e2e "POS live data" (7): every edit type -> change-log row + next delta; settings -> event + version.
- vitest `cart-catalogue-refresh.test.ts` (6).
- Playwright `30-live-refresh.spec.ts` (4): two contexts, edits reach the POS within 8 s without reload (prices,
  pack, name, barcode, active, new product, member level); cart notice + payment dialog deferral; F5 keeps cart /
  held bills, offline message; F2 / F4 open their dialogs; no horizontal scroll at 3 sizes, top-bar spacing.

Note: in the code F2 = จำนวน (quantity) and F4 = ราคา (price) on a cart line; both are page keys now free in the
desktop app.
