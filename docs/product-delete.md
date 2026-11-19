# Deleting and disabling products (owner 2026-11-19)

## Why "ลบไม่ได้" before

`DELETE /products/:id` refused every product that had a row in `stock_batches` ("มีประวัติการขาย สต็อก หรือการสั่งซื้อแล้ว ... ปิดการใช้งานแทน"). The opening stock adjustment (0 -> 24 on the inventory page) creates such a batch, so a product that was never sold could not be deleted. `stock_batches.product_id` has no cascade either, so the database would have refused too. There was also no way to disable a product in the UI (`products.is_active` existed, nothing set it).

## Rules

A product can be **deleted for good** only while no business document names it. Checked (`backend/src/products/product-delete.ts`, one SQL statement per check):

| Code | Document | Table |
| --- | --- | --- |
| SALE | บิลขาย (incl. credit sales / debts) | order_items |
| SALE_RETURN | ใบคืนสินค้า/ลดหนี้ | order_return_items |
| ONLINE_ORDER | ออเดอร์ออนไลน์ | online_order_items |
| PURCHASE_ORDER | ใบสั่งซื้อ | purchase_order_items |
| GOODS_RECEIPT | การรับสินค้าเข้าจากใบสั่งซื้อ | stock_batches with purchase_order_id |
| SUPPLIER_RETURN | ใบคืนสินค้าผู้จำหน่าย | supplier_return_note_items |
| CLAIM | ใบเคลม (product or replacement) | customer_claims |
| CLAIM_STOCK | รายการในคลังเคลม | claim_inventory |
| WARRANTY | ประกันสินค้าทดแทน | replacement_warranties |
| BUNDLE | ชุดสินค้าที่ใช้สินค้านี้เป็นส่วนประกอบ | product_bundle_items (child) |

Held bills (พักบิล) live only on each terminal; a held line of a deleted / disabled product is refused at checkout.

**Delete** (`DELETE /products/:id`, ADMIN / MANAGER or MANAGE_INVENTORY), one transaction with a row lock on the product:
- removed: stock batches (opening stock / adjustments), the product, and by cascade its barcodes, packs, photos, supplier rows, wholesale prices and its own bundle rows;
- stock still on hand needs `?confirmStock=1` (else 409 `STOCK_CONFIRM_REQUIRED`); the page says "ยังมีสต็อก 24 ชิ้น มูลค่าทุน ฿288 จะถูกลบออกจากคลัง" (value only for VIEW_COST);
- kept: `audit_logs` (the stock movement history is the audit trail and the P&L reads write-offs from it). Added: one `PRODUCT_DELETE` entry (name, SKU, stock, value, counts removed) and, with stock, a `STOCK_PRODUCT_DELETE` movement (stock card: "ลบสินค้า (สต็อกออกจากคลัง)", not a P&L write-off);
- the `product_changes` trigger records the delete: POS terminals drop the product on their next delta sync.

**Refused** (409 `PRODUCT_IN_USE`, `blockers: [{ code, text: "บิลขาย 3 ใบ", count }]`): the dialog lists the documents and offers "ปิดการใช้งาน" right there.

**Bulk** "ลบรายการที่เลือก": `POST /products/delete-check {ids}` first, one confirmation for the deletable ones (stock per product listed), `POST /products/bulk-delete {ids, confirmStock}` (each product in its own transaction; answer `deleted` / `blocked` / `needsStockConfirm` / `notFound`), then the blocked ones are listed per product with their documents and can all be disabled.

## Disable / enable

`POST /products/set-active {ids, isActive}` (MANAGE_INVENTORY), audit `PRODUCT_DISABLE` / `PRODUCT_ENABLE`.

- Not sold: POS grid / search / scanner (scanner says the product is disabled), checkout refuses it (server).
- Not offered: online shop and the mobile lookup (server), PO item picker, adjust-stock picker (unless opened from its own row), claim replacement search, supplier return picker, bundle item picker (client, `sellableProducts()` in `lib/store/product-store.ts`). The product store keeps disabled products so documents and history still find them by id.
- The POS delta sync sends the changed row with `isActive: false` / `true`; re-enabling brings it back everywhere.
- Products page: status filter ใช้งาน (default) / ปิดใช้งาน (count) / ทั้งหมด (`GET /products/page?status=`; the default of the API stays `all`, the inventory page lists every product); a disabled row is greyed with a "ปิดใช้งาน" chip.
- Dashboard stock figures already counted active products only (unchanged).

## Products table "⋯" menu

Replaces the pencil (shared `RowActionsMenu`): แก้ไข, สต็อกการ์ด / ประวัติความเคลื่อนไหว and ปรับสต็อก (open the inventory page dialogs via `/inventory?product=<id>&open=card|adjust`; not for bundles), สร้างสินค้าคล้ายกัน (add form prefilled; no SKU, barcodes, pack barcodes, photos or stock), ปิดการใช้งาน / เปิดใช้งาน, ลบสินค้า (danger, last). Row click / Enter still open the edit form. No barcode / price label printing exists yet, so it is not in the menu.
