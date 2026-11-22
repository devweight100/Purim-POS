# Back-office style guide (style pass, 2026-11-22)

Owner (translated): text size, colour, font and the table borders / badges differ from page to page and are not
clear; the program should look professional. No coloured boxes / badges around category and quantity values.
Alignment and offsets from the table edges (buttons, text, padding) must be the same everywhere.

One design system for back-office tables, lists and page chrome. It lives in **tokens + shared components**, not in
per-page classes:

| Where | What |
|-------|------|
| `frontend/src/app/globals.css` | tokens (`:root`, `@theme`), the `.tbl` table rules, `.page-title` / `.page-subtitle` / `.section-title`, `.doc-no` |
| `components/ui/table.tsx` | `Table` (adds `tbl` + the size container), header / row / cell without typography of their own |
| `components/ui/table-cells.tsx` | `tc.num` / `tc.doc` / `tc.date` / `tc.name` ..., `ClampText`, `TwoLine`, `RowActions` |
| `components/ui/status-chip.tsx` | `StatusChip` - the one chip style (status only) |
| `components/ui/button.tsx`, `input.tsx`, `badge.tsx` | one button / input scale; `Badge` has the chip shape |
| `lib/utils.ts` | `formatCurrency` (money), `formatListDate` / `formatListDateTime` (dates) |

The `.tbl` rules are **outside any CSS layer** on purpose: unlayered CSS wins over Tailwind utilities, so a stray
`text-xs`, `uppercase`, `font-black` or `bg-*` on a header or a cell cannot make one page differ from the next.
`e2e/28-style-pass.spec.ts` samples the computed styles of header and body cells on several pages and fails when
they drift.

## Type

One family: **Sarabun** (the existing Thai UI font, `--font-sans`). No monospace in the back office.

| Use | Size / weight | Token |
|-----|---------------|-------|
| Page title (h1) | 22 px semibold, primary colour, icon 22 px in the brand colour | `.page-title` (`text-title`) |
| Page subtitle | 12.5 px regular, muted | `.page-subtitle` (`text-sub`) |
| Section / card title | 16 px semibold | `.section-title` (`text-section`) |
| Table header | 13 px medium, muted, no capitals, no letter-spacing, slate-50 background | `.tbl th` (`text-th`) |
| Table body | 14 px regular, primary colour; names medium | `.tbl td` (`text-body`) |
| Secondary line (under a name, SKU, "โดย ...") | 12.5 px regular, muted | `text-sub text-muted-foreground` |
| Numbers / money | tabular digits, right aligned | `tc.num` |
| Document numbers, codes | tabular digits in the UI font, medium in tables (no `font-mono`) | `tc.doc` / `.doc-no` |

## Colour

| Token | Value | Use |
|-------|-------|-----|
| `text-fg` | slate-900 `#0f172a` | primary text |
| `text-muted-foreground` | slate-500 `#64748b` | secondary text, headers, units |
| `text-subtle` | slate-400 `#94a3b8` | "-" in empty cells, placeholders |
| `text-danger` | red-600 `#dc2626` | negative amounts / stock, overdue, out of stock |
| `text-ok` | emerald-700 `#047857` | paid, positive change |
| `text-warn` | amber-700 `#b45309` | low stock, partly paid |
| `text-info` | sky-700 `#0369a1` | links, info |

Colour is only for **meaning** (status, negative amounts, warnings). Prices, quantities, categories, units and plain
numbers are primary or muted text.

## Chips

`StatusChip` (24 px high, full radius, 12.5 px medium, light tint + inset ring) - only where the value **is a
status**: paid / unpaid, active / inactive, order / claim / PO status, stock-movement type, payment state.
Tones: success, warning, danger, info, neutral, primary. Category, quantity, unit, payment method, price and other
plain values are **plain text**, never a chip or a bordered box.

## Tables

- Header row 40 px, 13 px medium muted on slate-50, bottom border.
- Body rows ~44-48 px: 12 px cell padding top / bottom, 10 px left = right; the **first and last column use 16 px**
  so their content lines up with the card's 16 px edge padding (toolbar, pagination).
- Dividers between rows (`#edf1f5`), **no zebra**. Hover slate-50, selected indigo-50, keyboard row sky-50 with the
  sky focus outline.
- Header alignment follows the column: numbers and money right, status / actions centre, text left (dates left).
- A first column that is hidden on narrow screens / tables (`#`, `hidden xl:table-cell`, `data-mid` / `data-narrow="hide"`) hands the 16 px edge padding to the next visible cell.
- Narrow helper cells (checkbox, chevron, the products price grid) use `cell-tight` (8 px each side) - the only
  exception, and the same on header and body.
- Empty state: one row, `tbl-empty` (128 px high, centred, muted text, optional icon). Loading: the same row with
  "กำลังโหลด...".
- Row actions: `size="sm"` buttons (32 px) side by side 8 px apart, outline; at most one filled (primary) button per row for the row's main job (e.g. ลูกหนี้ "รับชำระ"); or one ⋯ menu (`RowActionsMenu`).
- Weights in a table body: 400 regular, 500 medium (names, totals, document numbers); no bold / black.

## Page chrome

- Page: `max-w-[1600px]`, 16 px padding (24 / 28 px on larger screens), 16 px between blocks.
- Header: title + subtitle on the left, actions on the right (default size, 40 px, 8 px apart).
- Toolbar / filter bar: inputs and selects 40 px, 8 px gaps; search first.
- Card: white, slate-200 border, `rounded-2xl`, 16 px padding.
- Pagination: under the table inside the card, "แสดง a-b จาก n" on the left, page size + buttons (32 px) on the right.

## Buttons

One scale from `components/ui/button`: `sm` 32 px (rows, pagination, compact toolbars), default 40 px (page header,
toolbars, dialogs), `lg` 44 px (POS / main dialog action); radius 8 px; 14 px medium text (13 px for `sm`);
icons 16 px (14 px for `sm`); 8 px between buttons. Variants: primary (indigo), outline (secondary), ghost,
destructive (red, also the last item of a ⋯ menu after a divider). Size, radius, weight and text size are never set
with ad-hoc classes on a `Button`.

## Money, dates, numbers

- Money: `formatCurrency` everywhere -> `฿1,234.50`, **always 2 decimals** (also whole amounts: `฿4,798.00`), so
  money columns line up; negative `-฿1,234.50`. The online shop's `baht` and the mobile `baht` follow the same rule.
  Not changed: printed documents (their own fixed 2-decimal formatter) and the pixel monitor screen.
- Dates: `formatListDate` "22 พ.ย. 69" / `formatListDateTime` "22 พ.ย. 69 14:05" (docs/ui-notes.md round 4).
- Quantities: `toLocaleString()` / `formatQty`, unit as muted text next to the number.

## Online shop (/shop)

Keeps its own large text for 40+ customers (body >= 18 px, see e2e 15) and its own high-contrast borders; within
the shop: one title size, one price style (same money rule), one status badge component (`shop/StatusBadge`).

## Page checklist

Screenshots (before / after, 1366x768 unless noted, seeded data with long Thai names, 20 categories, prices 1-5,
27 inactive products, 260 stock movements) are in the session scratchpad `style-pass/before/` and `style-pass/after/`
as `<before|after>-<page>-<size>.png`.

| Page | Done | Screenshots (`<before|after>-<name>-1366x768.png`) | What changed |
|------|------|------|------|
| ภาพรวม: แดชบอร์ด `/dashboard` | [x] | dashboard | title icon like every page, page shell, no monospace / black weights, money 2 decimals; layout (owner's round-start decisions) unchanged |
| รายงาน `/reports` + 6 tabs (`/reports/sales`, `bestsellers`, `inventory`, `payments`, `customers`, `purchases`) | [x] | reports, reports-sales, reports-bestsellers, reports-inventory, reports-payments, reports-customers, reports-purchases | table style, category / percentage plain text, SKU / codes muted (no indigo), sale value / spend not coloured, stock status = chip |
| สินค้า `/products` | [x] | products, products-bulk-bar, products-row-menu-active | category plain muted text (no chip), quantity plain number + unit (red = out / negative, amber = low, no badge / emoji), price 1 medium (no green), all prices `฿x.xx`, inactive = neutral chip, bundle = plain text; ⋯ menu / bulk bar show only the enable / disable that applies; price columns 1-5 by width kept |
| คลังสินค้า `/inventory` (3 tabs + สต็อกการ์ด dialog) | [x] | inventory, inventory-stock-card-tab, inventory-product-stock-card-dialog | category plain, stock number plain (colour = meaning), packaging breakdown muted, stock status + movement type = chips; **stock-card tab fixed** (count = list, server paging) |
| หมวดหมู่ `/categories` | [x] | categories | count / colour plain text, smaller icon tile |
| สต๊อกของเคลม `/claim-inventory` | [x] | claim-inventory | SKU / claim no. primary text, category plain, no boxes around "รอส่ง" |
| ใบสั่งซื้อ `/purchase-orders` (+ detail / receive dialogs) | [x] | purchase-orders | PO status = shared chip, money medium, unit in the receive dialog plain text |
| เจ้าหนี้ `/payables` (3 tabs, voucher list) | [x] | payables | header no longer in a card, "+ +" fixed, voucher bill numbers plain list, payment method plain text, progress bar + ⋯ kept |
| ผู้จำหน่าย `/suppliers` | [x] | suppliers | table / page chrome via tokens |
| ส่งเคลมบริษัท `/supplier-returns` | [x] | supplier-returns | header no longer in a card, DN numbers primary text, status chips |
| ประวัติการขาย `/orders` (+ detail dialog) | [x] | orders | payment method plain text ("เงินสด + QR"), status / "เคลมแล้ว" = chips, all row buttons outline (no filled indigo / orange), date left aligned |
| ออเดอร์ออนไลน์ `/online-orders` | [x] | online-orders | page shell / emoji; its cards and status pills unchanged (already one style) |
| ลูกค้า `/customers` | [x] | customers | no avatar tile, type / price level / points plain text, debt link without a box |
| ลูกหนี้ `/debts` | [x] | debts | customer type plain, due date + "เกินกำหนด" plain red text, remaining amount red text (no box), paid amount not green, status chips without icons, no duplicate "เคลียร์แล้ว" chip; page padding like the others |
| เคลมสินค้า `/claims` | [x] | claims | header no longer in a card, claim resolution = shared chip, claim no. primary text |
| ประวัติปิดกะ `/shifts` | [x] | shifts | round number plain, shorter headers (no sideways scroll), result chips without icons, print = outline button |
| การเงิน `/finance` (+ panels) | [x] | finance | table style via tokens, recurring due chips = shared chip |
| บัญชีธนาคาร `/accounts` | [x] | accounts | page shell / tokens |
| อนุมัติ `/approvals` | [x] | approvals | page shell / tokens |
| พนักงาน `/users` | [x] | users | header like every page (no card / icon tile) |
| ตั้งค่า `/settings` 8 tabs | [x] | settings-store … settings-system | page title, selects / buttons on the scale, emoji removed from labels |
| เลือกหน้า `/start` | [x] | start-chooser | checked: already consistent (version badge no longer monospace) |
| POS ประวัติการขาย dialog (Ctrl+H) | [x] | pos-history-dialog | item count = link text (no box), payment method plain text, numbers primary text |
| มือถือ `/m` | [x] | m-mobile | money `฿x.xx` (same rule); layout unchanged |
| ร้านออนไลน์ `/shop` (home, products, cart, orders) | [x] | shop-home, shop-products, shop-cart, shop-orders | money `฿x.xx` (same rule); large text kept; already one title / button / badge style |
| Sidebar rail flyout (collapsed) | [x] | rail-hover-flyout | opens on hover after 100 ms, closes 250 ms after leaving icon + flyout; click / Enter / Escape as before |
| จอมอนิเตอร์ `/monitor` | [x] | monitor | checked, not changed (pixel-art screen with its own look) |

1920x1080: dashboard, products, orders, payables, customers, reports-sales, inventory-stock-card-tab.
