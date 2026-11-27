# PO grid entry (owner round, 2026-11-27)

Owner (translated): enter purchase-order lines like typing into a spreadsheet; give the grid more room and make the
bill summary small; Enter moves between cells; the product form's category picker becomes a searchable dropdown.

## Done

- [x] before screenshots (e0f9c59)
- [x] shared `po-calc`: pack units (`unitFactorOf`, `baseQtyOf`, `poUnitOptions`), per-unit discount (`unit` type,
      `lineOwnDiscount`, `parseUnitDiscount`, `unitDiscountText`), default unit price (`defaultPoUnitPrice`),
      `stockCostPerUnit(..., unitFactor)`; `toBaseUnitLine` removed (no longer used)
- [x] migration `20261213000000_po_item_units`
- [x] backend: units resolved by the server, receive in packs, last-prices endpoint, exact code search, reports
- [x] frontend grid, search popup, compact header / slim footer, VAT column on demand
- [x] detail dialog / receive dialog / PDF / supplier-return PO list show or convert the pack unit
- [x] product form category combobox (`components/common/SearchableSelect.tsx`)
- [x] tests + after screenshots

## The grid (`purchase-orders/_components/PoItemsGrid.tsx`, model `po-grid.ts`)

Columns: ลำดับ · รหัสสินค้า/บาร์โค้ด · ชื่อสินค้า · จำนวน · หน่วย · ราคาต่อหน่วย · ส่วนลดต่อหน่วย · (VAT) · ราคารวม · ลบ.
Headers are shortened below 1536 px (รหัส/บาร์โค้ด, ราคา/หน่วย, ลด/หน่วย; full text in the tooltip).

- There is always one empty row at the bottom (`withTrailingBlank`).
- Code cell + Enter: `GET /products/page?exact=1&status=active&q=` (new `exact` flag: SKU any case, barcode or pack
  barcode, whole code only). One hit -> the product (a pack barcode also selects that pack); otherwise the search popup
  opens with the typed text. Name cell + Enter -> the popup with the typed text.
- Popup (`PoProductSearchDialog.tsx`): server search `GET /products/page` (active products, the products page search:
  name, SKU, ชื่อผู้ผลิต, barcodes, pack barcodes, supplier names / codes, with the "รหัสผู้ขาย: ..." hint), ↑/↓, Enter
  picks (base unit), a pack chip picks that pack, Alt+S = only this supplier's products, Esc = back to the cell.
  `ProductSearchPicker` (bundle round) is an inline combobox, so it was not reused as is; its request is now the
  shared `searchProductPage()` used by both.
- Enter order: code -> (name only while no product) -> qty -> unit -> price -> discount (-> VAT when shown) -> next
  row's code; Shift+Enter goes back; Tab as usual. A cell with a wrong value (qty 0, decimals when the shop does not
  allow them, bad discount) keeps the focus with a toast. Unit cell: ↑/↓ change the unit in place.
- Ctrl+Delete or the bin button deletes a row. The same product + unit twice is allowed (shown "ซ้ำแถว n").
- Enter never saves: saving is the button, Ctrl+S or Ctrl+Enter (not while the popup is open).
- ราคารวม = qty x (price - discount per unit), read only (before VAT and the bill discount, which are in the footer).

## Layout

Header strip in two compact rows (32 px controls): supplier (change button + name), ชื่อบนเอกสาร toggle, product
catalogue button (icon below 1280 px), cancel; then วันที่บิล, ครบกำหนด, เลขบิลผู้ขาย and a folding หมายเหตุ (one line,
grows while focused). These dates / invoice no. / notes are now sent on create and edit (the server already accepted
them). Footer on one row at 1093 px: line count, "VAT รายบรรทัด" switch (+ ไม่มี / รวม / แยก for all lines when
shown), รวม, ลดรายการ, ลดท้ายบิล ("100" baht or "5%"), VAT (when > 0), สุทธิ, save. All 8 lines + the empty row fit at
1093x614; no sideways scroll at 1366x768 / 1920x1080 / 1093x614 (e2e 46 checks).

## Owner decisions and how they were built

- **Pack unit**: new nullable columns `purchase_order_items.unit_id` (no FK: packs are rewritten when a product is
  saved), `unit_name`, `unit_factor INT NOT NULL DEFAULT 1 CHECK >= 1`. Quantity, unit cost and received qty of a line
  are in its unit (2 ลัง @ 1,200). The server decides the unit from the product's packaging units (`unitId`, else name +
  factor); the client's factor is never trusted. Editing a DRAFT keeps a stored pack even if the product's packs changed
  since (same product, name and factor). Old lines: unit null, factor 1 = base unit, unchanged.
- **Receiving**: in the line's unit (partial: 1 of 2 ลัง; decimals only when the shop allows them) -> stock batch of
  qty x factor base units at cost per base unit = line amount / (qty x factor) (gross, or net when VAT-registered;
  4 decimals like every batch). Stock card: base units, reason "รับเข้าจากใบสั่งซื้อ PO... (1 ลัง x12)" and
  `orderedUnit / orderedUnitQty / unitFactor` in the audit details. Adjust-and-complete re-prices in the same unit.
- **Money consumers unchanged**: payables, finance, obligations, planning, purchase_order_item_totals trigger all use
  receivedQty x (total / quantity) - both in the line's unit, so the value is right. Purchases report "receipts" (stock
  batches are base units) now divides the per-pack price by the factor. Supplier-return PO list converts to base units.
- **Per-unit discount**: new `discountType: 'unit'` (baht off each unit, line discount = qty x value) in po-calc, the
  only rule; "5%" maps to the existing `percent` (same as % of the line). The server validates `unit` <= unit price.
  Older whole-line `baht` discounts: shown per unit when they divide exactly (then saved as `unit`, same total), else
  kept as they are ("฿x/รายการ" placeholder) until the cell is edited.
- **VAT**: hidden by default; the switch shows a per-line VAT column; editing a PO with VAT lines shows it.
- **Default price**: `GET /purchase-orders/last-prices?productId&supplierId&excludePoId` (newest price per unit factor
  from this supplier, not cancelled) + product cost; `defaultPoUnitPrice`: same unit -> other unit converted by the
  factors -> cost x factor. A price typed by the user is never overwritten; changing the unit recomputes.
- **PDF / detail**: quantity column "2 ลัง", "(ลัง ละ 12 ชิ้น)" under the name, "(฿x/ลัง)" under a per-unit discount;
  detail dialog "2 ลัง = 24 ชิ้น".

## Category combobox

`SearchableSelect` (role combobox): type to filter (any part, any case), ↑/↓, Enter picks, Esc closes the list only,
Tab closes; Enter / Esc reach the form (save / close) only while the list is closed. "+ สร้างหมวดหมู่" kept (selects the
new category as before). `#product-form-category` is the input (e2e 13 updated).

## Migration notes

Additive only: three columns, factor default 1, check constraint. No data change; existing POs read and behave as
before. `prisma migrate diff` empty on a fresh DB. No desktop change: the desktop client loads the web pages, so **no
new desktop client is needed**.

## Tests

- vitest: `lib/__tests__/po-calc.test.ts` (pack units, per-unit discount baht / %, default price), `po-grid.test.ts`
  (rows, Enter order, exact codes, stored lines).
- jest: `po-calc.spec.ts` (+3).
- backend e2e block "PO lines in a pack unit + per-unit discount": old line stays base, exact code search, server
  unit, refusals, partial receive -> base stock + FIFO cost per base unit, payable value, stock card, last prices,
  stored pack kept after the product's packs changed, adjust-and-complete.
- Playwright `46-po-grid-entry` (grid flow, edit + receive, category combobox); 13 / 23 follow the new controls.

## Screenshots

Session scratchpad `po-grid/`: `before-*` / `after-*` for po-create (8 lines), po-search-popup, po-pdf (pack line),
product-form-category at 1366x768, 1920x1080, 1093x614 (deviceScaleFactor 2). The before product-form-category shots
at 1366 / 1093 show the form top only (the native select was below the fold; 1920 shows it).

## Verification (2026-11-27)

- backend: tsc OK, jest 204/204, e2e 159/159 on a fresh `*_test` DB, `prisma migrate diff` (DB vs schema) empty.
- frontend: tsc OK, eslint 0 errors (94 warnings), vitest 402/402, `next build` OK.
- Playwright full suite on a fresh DB: 157/157 (incl. new 46). After the last focus fix (PoItemsGrid, a cell is
  focused only once enabled) 23 + 46 + the screenshot run were re-run green.
