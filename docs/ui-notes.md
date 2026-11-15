# UI tidy-up round (screens and button placement) — progress notes

Branch `ccr-8f8b0741-si1a0o`. Resume from "Next" below after a rate limit / restart.

## Part A — claim search over every bill (done in code, see commits)

- Before: the claim screens (claims page "รับเคลมสินค้าใหม่", POS "สิทธิ์เคลม" customer claim stock, cart-line claim quota)
  read `GET /orders?limit=500` = the newest 500 bills of the shop, then filtered in the browser; older bills could not be claimed.
- After: `fetchClaimSearchOrders` asks `GET /orders?scope=claim&statusGroup=completed&search=<text>[&customerId=]`
  (pages of 500, newest first, at most 1,000 matching bills). The server search is a superset of what the browser rule
  matches: bill number, customer name / phone, note, product name / SKU and, in `scope=claim` only, the bundle snapshot on the
  bill line (`bundle_data`), the bundle's current parts, the walk-in name "ลูกค้าทั่วไป" (bills without customer) and
  `customerId`. `verifyClaimEligibility` (the eligibility rules) is unchanged and filters those bills as before.
- The claims-page dialog searched on every keystroke (each loading 500 bills); now 300 ms after typing stops, stale answers ignored.
- Found: `ProductClaimModal` is mounted in the POS (`PosDialogs`) but nothing opens it there (`setShowClaimModal(true)` is never
  called); the POS uses "สิทธิ์เคลม" (CustomerClaimStockModal) instead. Left as is (see "asked the owner?").
- Tests: backend e2e "claim search over every bill" (bill older than 520 newer bills found by number / phone / name / product /
  bundle part / customer; voided excluded; cashier allowed); Playwright `10-claims.spec.ts` second test.

## Part B — screens and buttons

Audit: Playwright screenshots (1366x768, scale 1) of every back-office page as admin, POS / orders / settings / users as
cashier (cashier gets "ไม่มีสิทธิ์" on settings / users), before and after, in the session scratchpad (not committed).
Destructive actions found: settings "ล้างข้อมูลทั้งหมด" (reset DB), users page "ล้างข้อมูลสินค้าทั้งหมด" (DELETE /products,
window.prompt), products "ลบที่เลือก" (bulk delete of selected rows, confirm), one-click row deletes (customers, suppliers,
categories, bank accounts — accounts had no confirmation at all), supplier-return cancel / restore (documents, confirm),
order void (manager flow). Install prompts: sidebar `PwaInstallButton` ("ติดตั้งโปรแกรม (Desktop App)", pulsing, with a
PWA how-to dialog). Settings: everything on one long page (receipt options, shop info + VAT + decimal qty + low-stock +
cash-approval limit mixed in the shop-info card, receipt texts, printer / drawer, backup, version, reset).

### Changes (where now -> where after, why)

| # | Before | After | Why |
|---|--------|-------|-----|
| 1 | Sidebar footer: pulsing "ติดตั้งโปรแกรม (Desktop App)" button + PWA install guide dialog (`PwaInstallButton`) | Removed (component deleted) | Owner asked; the shop uses the real desktop app. Desktop app, its self-update and the "download new installer" link in เวอร์ชันระบบ (shown only when an app update exists) are kept. `manifest.ts` kept (phones / `/m` shortcut). |
| 2 | Settings: one long page | Tabs (`?tab=` in the address): ข้อมูลร้าน / การขายและใบเสร็จ / สินค้าและสต็อก / การเงิน / เครื่องพิมพ์และลิ้นชัก / ผู้ใช้และสิทธิ์ / ระบบ | Group settings like a Thai shop thinks of them; each setting in one place |
| 3 | Low-stock threshold inside "ข้อมูลร้านค้า & นิติบุคคล" | ตั้งค่า > สินค้าและสต็อก (`?tab=stock`) | Owner: wrong place |
| 4 | Cash in/out approval limit inside shop info | ตั้งค่า > การเงิน (+ link card to บัญชีธนาคาร & QR) | Money setting |
| 5 | VAT + decimal quantities inside shop info | ตั้งค่า > การขายและใบเสร็จ, card "การขาย", beside receipt options, receipt texts and the live preview | Sales rules |
| 6 | Big "จัดการบัญชีการเงิน & รูป QR Code" banner at the top of settings | Link card in การเงิน | Not a setting of this page |
| 7 | Printer & cash drawer card in the middle of the page | Own tab เครื่องพิมพ์และลิ้นชัก (per device) | Hardware |
| 8 | - | ผู้ใช้และสิทธิ์ tab: links to พนักงาน & สิทธิ์ and การอนุมัติ (only those the role may open) | Findability |
| 9 | Backup card, version card and the reset card under the form (backup shown to ADMIN + MANAGER) | ตั้งค่า > ระบบ, ADMIN only: เวอร์ชันระบบ, สำรองข้อมูล, then a separated red "พื้นที่อันตราย" | Owner: dangerous buttons together, not pressable by accident |
| 10 | Users page "เครื่องมือผู้ดูแลระบบ: ล้างข้อมูลสินค้าทั้งหมด" (window.prompt "ล้างสินค้า") | ระบบ > พื้นที่อันตราย > "ลบสินค้าทั้งหมด..." dialog, confirm button disabled until "ลบสินค้าทั้งหมด" is typed | Owner; same API (DELETE /products, ADMIN) |
| 11 | Reset dialog said "the system cannot back up automatically before clearing" (wrong) | Says the server backs up first and deletes nothing if the backup fails (what the backend does); still needs "RESET" | Correct text |
| 12 | Every save button labelled differently, one save at the bottom of the receipt texts card saving everything | One "บันทึกการตั้งค่า" per group (same PATCH /settings with the whole form, as before); receipt options keep their own save | Consistency |
| 13 | Row delete as a red trash icon right next to edit (customers, suppliers, categories, bank accounts) | "⋮" menu with "ลบ..." (`RowDeleteMenu`), confirmation kept; bank account delete now asks first (deleted on one click before) | Avoid accidental deletes |
| 14 | Sidebar order: master control / monitor / dashboard / reports first, sales next, finance mixed with settings | งานขาย & ลูกค้า -> สินค้า & คลัง -> จัดซื้อ & ผู้จำหน่าย -> ภาพรวม & รายงาน -> การเงิน -> ตั้งค่า & ระบบ (master control + monitor moved here, emoji removed) | Frequency of use; items the role cannot open stay hidden (canAccessRoute, unchanged) |
| 15 | POS "แดชบอร์ด" button for every user (cashier landed on "ไม่มีสิทธิ์") | "เมนูหลัก" -> first back-office page the user may open (dashboard, orders, products...), hidden when none (classic, neo, list layouts) | Role-appropriate |
| 16 | POS classic toolbar: logout right after the back button (and wrapping to a second line) | Logout last (after เปิด/ปิดกะ), icon-only below 2xl | Away from everyday buttons, one toolbar line |
| 17 | Products header "จัดการหมวดหมู่" link (duplicate of the sidebar item, made the header wrap) | Removed; categories also linked from ตั้งค่า > สินค้าและสต็อก | Duplicate |
| 18 | Settings: unused web-serial connect handler (dead code) | Removed | Dead code |

Not changed: business logic, calculations, printing output, data, API permissions (DELETE /products and reset stay ADMIN;
reset keeps backup-before-reset). The sale flow has no extra click.

### Asked the owner? (kept as is, please decide)

- Managers no longer see the backup card (it is in ระบบ, admin only). The backend still lets a MANAGER create / list backups.
  Should managers have a backup button somewhere?
- "ลบสินค้าทั้งหมด" has no automatic backup on the server (the full reset has). Add one?
- Products page "ลบที่เลือก" (bulk delete of ticked rows, confirm dialog) stays on the products page: it is an everyday
  clean-up, not a delete-all. Move it to ระบบ too?
- `ProductClaimModal` is mounted in the POS but nothing opens it (the POS uses "สิทธิ์เคลม"); the claims page uses it. Remove from the POS?
- Loyalty points settings ("ตั้งค่าสะสมแต้ม") live on the customers page. Move to ตั้งค่า > การขายและใบเสร็จ?
- Monitor (Pixel View) and แผงควบคุมเครื่องแม่: kept, moved to the bottom group. Still used?
- pos-neo layout keeps logout next to its back button (separate design); change too?

### Done

- Part A (claims over every bill) — commits 43395ec + Playwright fix.
- Settings tabs + ระบบ danger zone, POS back / logout — 8a12297.
- Install button removed, users page wipe moved, sidebar order, products header — 22f3347.
- Row delete menus, bank account confirm — c9680b9.
- Playwright `11-settings-system.spec.ts` (groups, typed confirmations, manager / cashier cannot see ระบบ).

### Next

- Nothing; verification done (see PROJECT_STATUS 2026-11-15). Owner questions above remain.
