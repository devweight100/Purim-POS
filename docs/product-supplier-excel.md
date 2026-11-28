# Product supplier, cost & barcode unification + Supplier Excel import/export

Date: 2026-11-28

## Owner request

1. **Product form (`ProductFormDialog`):** Previously there were two separate sections in "ข้อมูลเพิ่มเติม" that both asked for a supplier: "บาร์โค้ดทั้งหมด" (`BarcodesSection`) and "ผู้จำหน่ายและต้นทุน" (`SupplierCostSection`). Remove the separate "บาร์โค้ดทั้งหมด" section and let each supplier row in "ผู้จำหน่าย บาร์โค้ด และต้นทุน" hold its barcode(s), cost, and invoice name/code in one place.
2. **Existing unassigned multi-barcodes:** If an existing product already has multiple barcodes (e.g. 3 barcodes) with no supplier linked to them yet, show them in the bottom supplier section as 3 separate rows with supplier and cost left blank, ready to be filled in.
3. **Supplier, cost & barcode Excel workflow:** Add a separate Excel tool on the Products page (distinct from the per-unit product Excel) to manage suppliers, purchase costs, and supplier-specific barcodes. Exported files carry the permanent system ID (`รหัสระบบ (ห้ามแก้ไข)`, `products.id`) so SKU changes never break matching when importing back.

## Root causes & design decisions

- **Why supplier choices on barcodes were previously lost:** `product_barcodes` had no `supplier_id` column, and `productToApiPayload` stripped `supplierId` and sent `barcodes: string[]`. Meanwhile `product_suppliers` stored one row per `(product_id, supplier_id)` without barcodes.
- **Additive schema change (`20261214000000_product_supplier_barcodes`):** Added `barcodes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]` on `product_suppliers`.
  - Every barcode entered on any supplier row (plus the top `บาร์โค้ด` field and any unassigned barcode rows) is also synced into `product_barcodes`.
  - POS scanning, search, PO grid exact lookup (`?exact=1`), mobile lookup, delta sync triggers (`purim_sync_product_barcodes`, `purim_sync_product_suppliers`), and uniqueness checks against other products' SKUs / base barcodes / pack barcodes continue to work through `product_barcodes` without changing scan paths.
  - Two suppliers of the **same** product may list the same factory barcode on their respective `product_suppliers` rows without self-conflict, while cross-product and base-vs-pack collisions remain strictly blocked (HTTP 409).
- **Top `บาร์โค้ด` field (`MainFieldsSection`) kept:** Retained for fast single-barcode scanning when adding a product; Enter from a scanner moves focus to `รหัสสินค้า` (top) or `ต้นทุน/ชิ้น` (supplier row) instead of submitting the form.
- **Unassigned barcode rows in `productToForm`:**
  - When a product has no linked suppliers yet, every base-unit barcode appears as its own row in "ผู้จำหน่าย บาร์โค้ด และต้นทุน" with blank supplier & cost (`รอระบุผู้จำหน่าย`).
  - Saving a product while some barcode rows still have blank supplier keeps all those barcodes in `product_barcodes` (never dropped); filling cost/name without picking a supplier shows a validation message instead of silently dropping the typed cost.
- **Shared import/export rules (`shared/src/product-supplier-import.ts`):**
  - Matching priority: `รหัสระบบ (ห้ามแก้ไข)` (`products.id`) → `รหัสสินค้า (SKU)` → `บาร์โค้ดหลักสินค้า`. If `รหัสระบบ` is filled and does not exist, the row errors rather than guessing another product.
  - Scientific notation barcodes (`8.85871E+12`) and numeric 13-digit EAN-13 cells are normalized without precision loss; template and export format identifier columns as Text (`@`).
  - Untouched blank-supplier rows from an export (`includeUnlinked: true`) are skipped as `unchanged` so the owner can export all products, fill in a subset, and import the file back directly.
  - Upsert merges per `(product, supplier)` without deleting other suppliers of that product; typing `ลบ` in `คำสั่ง` unlinks that supplier and removes barcodes exclusive to it.
  - Missing supplier names are flagged in the preview banner (`ผู้จำหน่ายใหม่ที่จะสร้างเพิ่มอัตโนมัติ`) and created atomically on confirm.
  - Reference cost (`products.cost_price`) update mode selectable on preview: `zero_only` (default: fill only when current `costPrice` is 0), `average` (average of positive supplier costs), or `none`.
  - Export (`POST /api/exports/product-suppliers`, kind `product-suppliers`) requires a manager/admin PIN every time, strips costs for users without `VIEW_COST`, and writes `DATA_EXPORT` to `audit_logs`.

## What was not done

- No changes under `desktop/` (no client app update required).
- The existing per-unit product Excel import/export (`product-import.ts`) was intentionally kept unchanged so unit/pack imports stay separate from supplier/cost/barcode imports.
