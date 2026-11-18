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

## Data

| Field | Column | Limit | Where it is edited |
| --- | --- | --- | --- |
| ชื่อร้าน | `products.name` | (unchanged) | product form "ชื่อสินค้า *" |
| ชื่อผู้ผลิต | `products.manufacturer_name` VARCHAR(200) | 200 | product form, under the name; Excel column "ชื่อผู้ผลิต" |
| ชื่อสินค้าของผู้ขาย | `product_suppliers.supplier_product_name` VARCHAR(200) | 200 | product form, each supplier row |
| รหัสสินค้าของผู้ขาย | `product_suppliers.supplier_sku` VARCHAR(100) | 100 | product form, each supplier row |
| name mode of a PO | `purchase_orders.doc_name_mode` (SHOP / SUPPLIER) | | PO create / detail / receive / PDF |
| name mode of a supplier return | `supplier_return_notes.doc_name_mode` | | return create / PDF |
| default name mode | `store_settings.supplier_doc_name_mode` | | ตั้งค่า > สินค้าและสต็อก |

Migration `20261205000000_product_names`. Values are trimmed and inner spaces collapsed (`shared/src/product-names.ts`
`cleanNameField`); blank = NULL; longer than the limit = Thai 400 (form / API) or a row error (import, nothing saved).
The product SKU rules are unchanged.

## Name rules (shared/src/product-names.ts)

- **ใช้ชื่อร้าน (SHOP)**: every line prints the shop name.
- **ใช้ชื่อผู้ผลิต (SUPPLIER)**: each line, in this order:
  1. that document's supplier's product name for the product (its supplier row), with its code;
  2. else ชื่อผู้ผลิต (still with that supplier's code when the row has one);
  3. else the shop name.
- The supplier's code gets its own small column "รหัสผู้ขาย" on the A4 PO when any line has one; screens show it under
  the name ("รหัสผู้ขาย: … · ชื่อร้าน: …").
- The server resolves each line (`docName`, `docCode`, `docNameSource`) for the stored mode on every PO / return-note
  answer (list, detail, create, edit, issue, cancel, receive, payables bills, document search), so the screen, the PDF
  and a reprint always agree. The mode is stored on the document: changing the setting later does not change it.
- Supplier documents covered: purchase orders (create screen, detail, A4 PDF from the PO page / payables / F3
  search), goods receiving (GRN dialog, shortfall dialog), supplier returns / supplier credit notes (create dialog +
  A4). Payment vouchers list bills, not products.
- Customer-facing documents (receipts, slips, A4 receipt, online shop, picking slips) and every report keep the shop
  name; nothing there reads the new fields. The online shop's queries select explicit columns, so the new names are
  never public.

## Search

`searchMatchHint` / `matchesOtherNames` (shared) + SQL ILIKE on the new columns:

| Screen | How it searches | Hint |
| --- | --- | --- |
| POS (grid + list layout) | in the browser over the catalogue rows (they now carry `manufacturerName`, supplier name / code) | yes |
| products page, inventory page | `GET /products/page?q=` (SQL, trigram indexes) | yes |
| `GET /products?search=` | Prisma `contains` | n/a |
| PO item picker + supplier catalogue | in the browser over the catalogue | yes |
| supplier returns (overstock product picker) | in the browser | yes |
| claims (replacement product search) | in the browser | yes |
| mobile /m stock | `GET /products/lookup` (every word, SQL); rows carry the other names | yes |

Trigram GIN indexes `products_manufacturer_name_trgm_idx`, `product_suppliers_supplier_sku_trgm_idx`,
`product_suppliers_supplier_product_name_trgm_idx` (created only when pg_trgm is available, like
`20261125000000_trigram_search`).

## Import / export

- Excel per-unit format: new column "ชื่อผู้ผลิต" right after "ชื่อสินค้า" (template, export, import, preview diff).
  Blank cell = left as it is (same rule as the other optional columns).
- Supplier product name / code: **not** in the file. The import has no supplier columns today (the per-unit file and
  the old CSV carry none), so per the request they are left out. The old exact-header CSV parser (`lib/csv-parser.ts`)
  has no manufacturer column either; use the Excel / per-unit CSV format for it.

## Invoice matching (groundwork, no OCR)

Helper `backend/src/purchase-orders/supplier-line-match.ts`, endpoint
`GET /api/purchase-orders/match-line?supplierId=&text=&poId=&limit=` (MANAGE_PURCHASES):

- Candidates: the supplier's products (`product_suppliers`), or with `poId` the lines of that PO (each candidate then
  carries its `purchaseOrderItemId`).
- Ranking: supplier code equals the text (case / space-insensitive) → `matchedBy: 'supplierCode'`, score 1; shop SKU /
  barcode / pack barcode equals the text → `'barcode'`, 0.99; else the best pg_trgm `similarity()` of the text with
  the supplier's product name, the manufacturer name and the shop name → `'supplierName' | 'manufacturerName' |
  'shopName'` (score = similarity, below `minScore` 0.1 dropped). Without pg_trgm the same trigram measure is computed
  in JavaScript.
- Answer: `[{ productId, name, sku, manufacturerName, supplierProductName, supplierSku, purchaseOrderItemId,
  matchedBy, score }]`, best first, `limit` 1-20 (default 5).

Intended later flow:

1. The user picks the supplier's open PO on the receiving screen and takes a photo of the supplier's invoice.
2. OCR (later) turns the photo into lines: code, name, quantity, unit price.
3. For each line: `match-line?supplierId=<PO supplier>&poId=<PO>&text=<code>`; no `supplierCode` hit → again with the
   name. A score ≥ ~0.6 (or a code hit) fills the GRN row of `purchaseOrderItemId` with the invoice quantity / cost;
   lower scores are shown as choices; no candidate on the PO → search the supplier's other products (no `poId`) and
   offer "add to PO".
4. When the user confirms a match whose supplier code / name was not stored yet, save it on the product's supplier row
   (`PATCH /suppliers/:id/products/:productId` accepts `supplierSku` / `supplierProductName`), so the next invoice
   matches by code.

## Decisions

- `product_suppliers.supplier_sku` already existed. The product form showed it as "หมายเหตุ" (free text). It is now
  "รหัสสินค้าของผู้ขาย". The migration trims it; a stored value longer than 100 characters (a note, not a code) is
  moved to `supplier_product_name` (cut to 200) so nothing is lost.
- Names on documents are resolved live from the product master (like the shop name already was); the *mode* is
  stored per document. A reprint therefore prints the same mode; renaming the product later renames it on reprints,
  as for the shop name before.
- The toggle is a keyboard radio group (`components/common/DocNameModeToggle.tsx`: Tab to the selected choice, ←/→).
- PO create screen: the search scope radio no longer repeats the supplier's (long) name — it squeezed the item search
  to ~70 px at 1366x768 (name in the header; tooltip on the label).

## Done

- Schema + migration, shared rules + spec, backend save / validation / catalogue / searches / lookup, suppliers API.
- Product form fields, store mapping, Excel column (template / export / import / preview).
- Search everywhere + hint component (`components/common/SearchMatchHint.tsx`).
- Settings default, PO create / detail / receive / A4, supplier returns create / A4, payables + F3 PO PDF.
- Matching helper + endpoint + unit spec + e2e.
- Tests: backend e2e "product names" block (6 tests), jest `supplier-line-match.spec.ts`, shared
  `product-names.spec.ts`, vitest import / export, Playwright `23-product-names.spec.ts` (4 tests).
