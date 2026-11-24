# POS keys + live data refresh (F2 conflict, F5 รีเฟรชข้อมูล)

Progress file for this round (keep committed). Owner issues:
1. Desktop app: F2 in the POS jumps to the back office (F2 is a POS key).
2. The POS does not pick up back-office edits made after it loaded the products; owner asks for F5 or better.

## Plan / status
- [x] 1. Desktop accelerator audit + fix (menu-shortcuts.js, tests, docs)
- [ ] 2a. Reproduce live-update gaps (two browsers), find root causes
- [ ] 2b. Fix causes (backend change logs / settings / SSE / client)
- [ ] 2c. Cart re-pricing with notice (not while payment dialog open)
- [ ] 2d. F5 รีเฟรชข้อมูล + last-sync time + hint
- [ ] 2e. Tests (backend e2e, Playwright, desktop), docs, screenshots, PROJECT_STATUS

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
