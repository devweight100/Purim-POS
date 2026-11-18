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
| 14 | Sidebar order: master control / monitor / dashboard / reports first, sales next, finance mixed with settings | งานขาย & ลูกค้า -> สินค้า & คลัง -> จัดซื้อ & ผู้จำหน่าย -> ภาพรวม & รายงาน -> การเงิน -> ตั้งค่า & ระบบ (master control + monitor moved here, emoji removed); reordered again 2026-11-18, see "Sidebar order (2026-11-18)" | Frequency of use; items the role cannot open stay hidden (canAccessRoute, unchanged) |
| 15 | POS "แดชบอร์ด" button for every user (cashier landed on "ไม่มีสิทธิ์") | "เมนูหลัก" -> first back-office page the user may open (dashboard, products, orders... in the sidebar's group order since 2026-11-18), hidden when none (classic, neo, list layouts) | Role-appropriate |
| 16 | POS classic toolbar: logout right after the back button (and wrapping to a second line) | Logout last (after เปิด/ปิดกะ), icon-only below 2xl | Away from everyday buttons, one toolbar line |
| 17 | Products header "จัดการหมวดหมู่" link (duplicate of the sidebar item, made the header wrap) | Removed; categories also linked from ตั้งค่า > สินค้าและสต็อก | Duplicate |
| 18 | Settings: unused web-serial connect handler (dead code) | Removed | Dead code |

Not changed: business logic, calculations, printing output, data, API permissions (DELETE /products and reset stay ADMIN;
reset keeps backup-before-reset). The sale flow has no extra click.

### Owner's answers (2026-11-15) and what was done

| # | Question | Answer | Done |
|---|----------|--------|------|
| 1 | Backup button for managers? | Yes (backup only) | ตั้งค่า > ระบบ now shows to ADMIN and MANAGER: เวอร์ชันระบบ + สำรองข้อมูล (create / list / check). The red พื้นที่อันตราย stays ADMIN only (also in the API). Server matched: `POST /server-control/backup` and `GET /server-control/backups` now ADMIN + MANAGER (list no longer needs VIEW_REPORTS); download of a file and the off-site folder stay ADMIN. |
| 2 | Back up before "ลบสินค้าทั้งหมด"? | Yes, like the full reset | `DELETE /products` backs up first (`ServerControlService.backupBeforeWipe`, shared with the reset) and returns 400 with nothing deleted when the backup fails; the answer names the backup file (shown in the toast). Card + dialog text say so. Backend e2e. |
| 3 | Move products "ลบที่เลือก" to ระบบ? | No | Unchanged. |
| 4 | Remove the unused claim dialog from the POS? | Yes | `ProductClaimModal` + its PDF dialog and state removed from `PosDialogs` / `use-pos-dialogs`; the claims page keeps the component. |
| 5 | Loyalty settings to ตั้งค่า? | No | Unchanged (customers page). |
| 6 | Master Control (แผงควบคุมเครื่องแม่) still used? | Remove | `app/master-control` deleted, sidebar item, route permission and the desktop-app menu item removed; `/master-control` redirects to `/monitor` (old desktop apps keep the menu item until updated). Backend unchanged: its only API (`GET /server-control/telemetry`) is used by the monitor. Monitor (Pixel View) kept. |
| 7 | pos-neo? | Remove | `app/pos-neo`, `components/pos/neo/*`, `PosNeoListLayout`, `NEO_POS`, the neo logout style and the `pos_neo_screen_mode` key removed. There was no setting / toggle choosing it and the desktop app always opens `/pos`; `/pos-neo` (and `/pos-neo/...`) redirect to `/pos` (next.config `redirects`), so a bookmark or terminal pointing at it gets the normal POS. |

Tests: backend e2e "backups: ADMIN and MANAGER" and "delete all products: backup first"; Playwright `11-settings-system`
(manager sees ระบบ with backup, presses it, no download / danger zone) and a new test for the removed-screen redirects.

### Done

- Part A (claims over every bill) — commits 43395ec + Playwright fix.
- Settings tabs + ระบบ danger zone, POS back / logout — 8a12297.
- Install button removed, users page wipe moved, sidebar order, products header — 22f3347.
- Row delete menus, bank account confirm — c9680b9.
- Playwright `11-settings-system.spec.ts` (groups, typed confirmations, manager / cashier cannot see ระบบ).

### Next

- Nothing; verification done (see PROJECT_STATUS 2026-11-15, owner answers entry).

### Sidebar order (2026-11-18, owner)

| Before | After |
|--------|-------|
| งานขาย & ลูกค้า, สินค้า & คลังสินค้า, จัดซื้อ & ผู้จำหน่าย, ภาพรวม & รายงาน, การเงิน, ตั้งค่า & ระบบ | ภาพรวม & รายงาน, สินค้า & คลังสินค้า, งานขาย & ลูกค้า, จัดซื้อ & ผู้จำหน่าย, a divider (line + extra space), การเงิน, ตั้งค่า & ระบบ |

- "หน้าขายหน้าร้าน (POS)" stays above all groups (a launcher, not a group), then the document search (F3).
- Items and their order inside each group, permissions (`canAccessRoute`, groups with no allowed item hidden), the
  keyboard (`aria-expanded` group buttons), the mobile drawer and the online orders badge are unchanged. The divider
  (`separatorBefore` on การเงิน, `data-testid="sidebar-divider"`, `aria-hidden`) is drawn only when a group is shown
  above it, so a cashier who sees only งานขาย & ลูกค้า gets no divider.
- POS "เมนูหลัก" (`BACK_OFFICE_HOMES` in `lib/permissions.ts`) follows the same order: `/dashboard`, `/products`,
  `/orders`, `/customers`, `/claims`, `/shifts`. Admin / report users -> dashboard; the seed cashier (POS_SELL,
  POS_DISCOUNT, MANAGE_CLAIMS) -> ประวัติการขาย (`/orders`) as before; stock staff without reports -> สินค้า.
- The desktop app menu (`desktop/main.js` "ระบบขาย & หลังบ้าน") is a short list of page shortcuts, not the sidebar
  groups, so it was left as is. README has no sidebar table.
- Tests: vitest `back-office-home.test.ts`; Playwright `13-keyboard-layout` (group order with the divider, POS button on
  top, groups open, sales items in order, cashier sees only งานขาย & ลูกค้า and เมนูหลัก opens `/orders`).

## Round 3 (2026-11-18): products price columns, collapsible sidebar, table survey

Owner: make every column of the products table tighter so the price levels are their own columns (at least ราคา 1-3
at 1366x768, 1-5 at 1920x1080), let the back-office menu fold away, and fix the same kind of problems in every other
back-office table. Screenshots (before / after, seeded data with long Thai names, 3+ barcodes, prices 1-5, several
pages of rows) are in the session scratchpad `ui-round3/` (not committed).

### Products table (สินค้า > รายการสินค้า & ราคา)

| Before | After |
|--------|-------|
| ราคา 1 only; "แสดงราคา 2–5" stacked 2-5 in one small column | "ราคา 1".."ราคา 5" as own columns, chosen by the table's own width (`components/products/product-columns.ts`): 5 when they fit (1366x768 and up, 1093x614 with the sidebar collapsed), at least 1-3 (1093x614 with the sidebar open) |
| price toggle always shown | "แสดงราคา 4–5" only when 4-5 do not fit by themselves (then narrower 12 px numbers, no photo); remembered per browser (`purim_products_show_prices_45`) |
| header "ราคา 1" | subtitle = the shop's level name without "ราคา" (online shop settings `levelNames`, e.g. ปลีก / ส่ง / ส่งพิเศษ; none when it is just "ราคาระดับ N"), read from `GET /online-shop/level-coverage` (`lib/use-level-names.ts`) |
| sort on ราคา 1 only | every price column sorts (server already supported priceLevel1-5) |
| จำนวน and หน่วย two columns | one column: stock badge with the unit under it |
| category column from 1280 px | own column only on wide tables (>= 1300 px, i.e. 1920x1080); otherwise a small chip under the barcodes |
| cost column always | only with VIEW_COST (ADMIN / permission); the API already left the value out for others |
| 12-16 px cell padding, 40 px checkbox / 36 px chevron / 56 px edit columns | 8 px price cells, 32 / 28 / 40 px narrow columns, 13 px tabular numbers |

Kept: row click / ↑↓ / Enter, sort headers, selection, chevron + pack rows (same columns), barcodes (3 + "+N"),
"N ขนาดบรรจุ", search, filters, paging.

### Sidebar (back office)

- Button in the menu header ("ย่อแถบเมนู (Ctrl+B)") and **Ctrl+B** (desktop widths only, not in editable text) fold
  the 240 px menu into a 64 px icon rail; the content area starts after it (`main` margin follows). State per device in
  localStorage `purim_sidebar_collapsed` (`lib/store/sidebar-store.ts`, try/catch; first paint is expanded).
- Rail (`components/layout/SidebarRail.tsx`): expand button, POS launcher, document search (F3), one icon per group
  (same order, divider before การเงิน, groups the role cannot open stay hidden), user + logout. Every control has an
  aria-label and a tooltip on hover and keyboard focus. The online orders badge sits on the งานขาย & ลูกค้า icon.
- A group icon opens a flyout with the group's pages (reports with its sub-pages); `aria-expanded` / `aria-controls`,
  Enter opens it with the focus on the first page, ↑/↓ move, Escape or a click outside closes it and gives the focus
  back, choosing a page closes it.
- The expanded menu stays mounted (hidden) while collapsed, so its open groups and scroll position survive a toggle.
  Mobile drawer unchanged.

### Shared table approach (all back-office tables)

- `components/ui/table.tsx`: one density - 10 px cells, 40 px header row, 13 px headers (no 2xl padding jump);
  `globals.css` `.tbl` gives plain `<table class="tbl">` the same padding (components layer, cell utilities still win).
- The table box is a size container (`tbl-wrap`, set by ui/table; plain tables wrap in `<div class="tbl-wrap">`), so
  columns react to the width the table really has (sidebar open or collapsed), not to the window:
  `data-mid="hide"` (< 1150 px), `data-narrow="hide"` (< 1000 px), `data-narrow="wrap"` (date may wrap),
  `data-act-label` (action button text hidden, icon + aria-label stay). Replaces the old viewport `max-xl:nth-child`
  hiding in payables / claim stock / claims / shifts.
- `components/ui/table-cells.tsx`: `tc` column classes, `ClampText`, `TwoLine`, `RowActions` for new tables.
- Rules applied: document numbers, dates and money on one line; names clamp to 2 lines with a minimum width (never one
  word per line); action buttons side by side (no stacking); fixed percentage widths removed (auto layout).

### Per page (1366x768, both sidebar states, also 1093x614 / 1920x1080)

| Page | Before | After |
|------|--------|-------|
| ประวัติการขาย (orders) | bill numbers broken over 2 lines, customer names one word per line, 3 action buttons stacked | one-line numbers, customer clamped, actions in a row; narrow table: รายการ hidden, date wraps, A4 / 80mm icon only |
| ลูกหนี้ (debts) | bill numbers in 3 lines, customer 1 word per line, 2 stacked buttons | one-line, clamped names, buttons in a row; progress hidden < 1150 px, ยอดเต็มบิล < 1000 px |
| ใบสั่งซื้อ (PO) | action icons wrapped to 2 rows | one row, right aligned; # hidden / date wraps when narrow |
| เจ้าหนี้ (payables) | sideways scroll at 1366 (12 columns, supplier in 6 lines) | invoice + PO + bill date in one column; ส่วนลด / ประกบลดหนี้ hidden < 1150 px, # / จ่ายแล้ว / "จาก PO" < 1000 px (all in the bill details); ดูเอกสาร icon only |
| ส่งเคลมบริษัท (supplier returns) | 3 stacked action buttons, supplier 4 lines | buttons in a row; # / อ้างอิง PO hidden and labels icon-only when narrow |
| เคลมสินค้า (claims) | no product shown | **new column สินค้าที่เคลม**; # / จำนวน hidden when narrow |
| สต๊อกของเคลม | sideways scroll at 1366, product name one word per line | category moved under the name (no data removed); # / ทุน/หน่วย hidden < 1150 px |
| คลังสินค้า | SKU / barcode broken over lines | name clamp + codes on one line each, category chip truncated |
| ลูกค้าสมาชิก | names cut to one line, earn/redeem rate text in every row | names 2 lines; the member's earn/redeem rate is the tooltip of the points badge |
| ผู้จำหน่าย | phone / e-mail broken over lines | phone one line, e-mail truncated with tooltip, edit button has a name |
| ประวัติปิดกะ | sideways scroll at 1366 | shorter headers, time on one line; รอบ / เงินทอน / เข้า-ออก hidden when narrow, print icon only |
| รายงาน (6 tabs) | product / customer / supplier names one word per line | names clamp with a minimum width; inventory: ราคาทุน / มูลค่าขาย hidden when narrow; customers: average hidden, date wraps |
| การเงิน | range buttons 4 px apart | 8 px |
| หมวดหมู่, พนักงาน, อนุมัติ, บัญชี, ออเดอร์ออนไลน์ | fine | density only |

Columns hidden only when the table is narrow are listed above; nothing was removed outright (category in claim stock
moved under the name; the earn/redeem rate moved into a tooltip).

Tests: vitest `product-columns.test.ts`; Playwright `21-table-layout.spec.ts` (price columns at 3 sizes in both
sidebar states, level names, price sort, keyboard + chevron; sidebar button / Ctrl+B / reload / rail by Tab / flyout
Enter-↓-Escape / phone drawer; 24 table pages without sideways scroll and with 8 / 16 px spacing at 3 sizes in both
sidebar states); `13-keyboard-layout` and `20-product-sku` follow the new price columns.

## Round 4 (2026-11-18): products row, payables bills table, document numbers + dates

Plan (resume from "Next" after a restart):
- A. Products: no thumbnail / icon, no barcodes in the row (search by barcode / SKU unchanged), narrow category
  column (chip, truncated, tooltip), quantity + unit aligned in both sidebar states.
- B. Payables bills: columns เลขที่เอกสาร / วันที่ / บริษัท / ยอดเอกสาร with a paid progress bar; one "⋯" row menu
  (keyboard); row click / Enter opens the bill details (everything else moved there).
- C. Document numbers `<PP><YYMM>-<NNNN>` (2-letter prefix, CE 2-digit year, monthly 4-digit counter in a DB table),
  docs/document-numbers.md; short Thai list dates without time (one formatter), time only in details / orders /
  receipts.

Done: A (products row), B (payables bills: 4 columns + progress, ⋯ menu; vouchers tab ⋯ + row click), C numbers (backend counter table + e2e, docs/document-numbers.md). Next: C dates (frontend sweep), Playwright, screenshots, full verification.
