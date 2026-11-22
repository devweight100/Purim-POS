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
- Body rows ~44-48 px: 12 px cell padding top / bottom, 12 px left = right; the **first and last column use 16 px**
  so their content lines up with the card's 16 px edge padding (toolbar, pagination).
- Dividers between rows (`#edf1f5`), **no zebra**. Hover slate-50, selected indigo-50, keyboard row sky-50 with the
  sky focus outline.
- Header alignment follows the column: numbers and money right, status / actions centre, text left.
- Narrow helper cells (checkbox, chevron, the products price grid) use `cell-tight` (8 px each side) - the only
  exception, and the same on header and body.
- Empty state: one row, `tbl-empty` (128 px high, centred, muted text, optional icon). Loading: the same row with
  "กำลังโหลด...".
- Row actions: `size="sm"` buttons (32 px) side by side 8 px apart, or one ⋯ menu (`RowActionsMenu`).

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

| Page | Done | Notes |
|------|------|-------|
| (to be filled while the pass goes on) | | |
