# Round B (owner items 4, 6, 8, 9, 10 + style leftovers)

Branch `ccr-8f8b0741-si1a0o`. Spec: owner list "Round B". Item 9 (price fallback) was done before this round
(`shared/src/price-level.ts`, `docs/pos-price-level.md`); here it is only checked for quotes.

## Status

| Item | State |
|------|-------|
| 4 SKU editable (create + edit, blank = generated) | done (code + tests; full-suite run at the end) |
| 6 Export filter dialog + PIN on every export | todo |
| 8 Dashboard debtors / creditors / upcoming expenses | todo |
| 9 Quotes use the shared price rule (check only) | todo |
| 10 LINE staff group notification + reminders | todo |
| Leftovers: PO status chips Thai, stock-card "-:", stat tiles | done |
| Release v1.5.11 notes (no tag) | todo |

## Decisions (safest option, owner may change)

(filled in per item below)

## 4. Product code (SKU) typed by the user

Replaces the 2026-11-18 rule "SKU = permanent system ID".
- Form (`ProductDetailsSection`): field "รหัสสินค้า" (normal input, in the Tab order), placeholder / hint
  "เว้นว่างให้ระบบสร้าง" (edit: "เว้นว่าง = ใช้รหัสเดิม"), copy button kept in the edit form. Payload sends the trimmed code.
- Server (`products.service.ts`): create keeps a typed code (whitespace collapsed, max 64), blank / missing ->
  generated internal EAN-13 (`product-sku.ts`, same format). PATCH with a different code renames; blank = keep.
  Unique against every product SKU, product barcode **and pack-unit barcode** (409 naming the other product), and
  not equal to one of the product's own barcodes in the same request. Permission unchanged (MANAGE_INVENTORY).
- Import: match id -> SKU -> barcode (unchanged). A row matched by its **system id** with another SKU renames it
  (`skuRenamed`); a row matched by barcode keeps the stored code (`skuKept`, toast explains). Preview shows
  "รหัสสินค้า: old ➔ new" for a rename.
- Decision: renaming by an import row matched only by barcode is NOT done (a typo in the code column could silently
  rename a product); only the id column (exported files have it) renames.
- Tests: backend e2e block "product code (SKU): typed by the user ..."; vitest `product-sku.test.ts`; Playwright
  `20-product-sku`.

## Leftovers from the style pass

- PO status in Thai everywhere on the PO page: chips / tabs / status dialog / toasts ร่าง, ออกแล้ว, รับบางส่วน,
  รับครบ, ยกเลิก (`PoStatusBadge.tsx` `PO_STATUS_TH`).
- Stock card dialog: the server sends `referenceNo: "-"` for movements without a document; the dialog showed "-:"
  before the reason. Now the prefix is shown only for a real document number.
- Stat tiles: one style from tokens (`.stat-tile*` in `globals.css`, docs/ui-style.md "Stat tiles") on orders, debts,
  payables, claims, claim inventory, supplier returns, shifts and the 6 report tabs (46 tiles). Decision: values are
  primary text; red only for owed / overdue / voided / negative figures (colour = meaning rule).
