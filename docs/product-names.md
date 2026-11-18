# Product names: shop name, manufacturer name, supplier names (owner option ข)

Progress file of the feature (plan, decisions, done list). Branch `ccr-8f8b0741-si1a0o`.

## Request (short)

- Every product: **ชื่อร้าน** (`products.name`, primary, unchanged) and **ชื่อผู้ผลิต** (`products.manufacturer_name`,
  optional).
- Every supplier row of a product ("ผู้จำหน่ายและต้นทุน", `product_suppliers`): optional **ชื่อสินค้าของผู้ขาย**
  (`supplier_product_name`) and **รหัสสินค้าของผู้ขาย** (`supplier_sku`, the existing column).
- All product searches also match those names / codes (pg_trgm indexes), results show the shop name plus a small
  "ผู้ผลิต: …" / "ชื่อผู้ขาย: …" / "รหัสผู้ขาย: …" hint when the match came from another name.
- Supplier-facing documents choose "ใช้ชื่อร้าน / ใช้ชื่อผู้ผลิต" (default from settings, stored per document).
- Groundwork for matching a photographed supplier invoice to an open PO (no OCR now): a backend helper.

## Plan

1. Data: migration + schema, backend validation (trim, length), catalogue rows, product form fields.
2. Import / export: ชื่อผู้ผลิต column.
3. Search: shared matcher (`shared/src/product-names.ts`), backend SQL searches, every search screen + hint.
4. Documents: setting, PO / receiving / supplier returns name mode (stored), A4 PDFs.
5. Matching helper + endpoint + tests.
6. Tests (e2e, vitest, Playwright), screenshots, full verification, PROJECT_STATUS.

## Decisions

- Lengths: manufacturer name 200, supplier product name 200, supplier product code 100 characters, trimmed; blank =
  NULL. Longer input = Thai 400 (form / API); the import cuts nothing silently, it reports the row.
- `product_suppliers.supplier_sku` already existed. The product form showed it as "หมายเหตุ" (free text). It is now
  "รหัสสินค้าของผู้ขาย". The migration trims it; a stored value longer than 100 characters (a note, not a code) is
  moved to `supplier_product_name` (when that is empty) so nothing is lost.
- The product SKU rules are unchanged (system code, never from the client / file).

## Done

- (nothing yet)

## Next

- Step 1 (data).
