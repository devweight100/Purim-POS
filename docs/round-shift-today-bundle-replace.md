# Round: shift hand-over, today by default, bundle picker, delete with replacement

Owner requests 2026-11-26. Progress file of this round (plan, done, next, decisions).

## Plan

1. Shift hand-over bug (A opens shift -> logs out -> B logs in/out -> A logs in: A's shift seems gone).
2. Every date-range page defaults to TODAY (Asia/Bangkok).
3. Bundle items: type-to-search product picker.
4. Delete a used product with a replacement product.
5. (added by coordinator) 5a shop-wide point rates + one shared rate function; 5b member import with points.

## Progress

- [x] 1 reproduce + root cause (see Shift section)
- [x] 1 fix + backend e2e + Playwright (`frontend/e2e/38-shift-handover.spec.ts`, store-flow 'shift hand-over on one PC')
- [x] 2 audit + defaults (`frontend/e2e/39-today-default.spec.ts`)
- [x] 3 bundle picker (`frontend/e2e/40-bundle-picker.spec.ts`)
- [x] 4 delete with replacement (store-flow 'delete a used product with a replacement', `frontend/e2e/41-product-replace.spec.ts`)
- [ ] full verification

## Decisions

(filled in as the work goes)

## 1. Shift hand-over

Model (kept): a shift belongs to ONE user on ONE terminal (the PC's cash drawer, `shifts.terminal_id` = the device's
`purim_terminal_id`, desktop config copy). A terminal holds at most one open shift; another user cannot open a shift
on it until that shift is closed. Logout never closes a shift.

Reproduced (Playwright, 2026-11-26): the plain A -> logout -> B -> logout -> A path gives A the same shift back.
It breaks when B has an open shift left under another terminal id (another PC, or an old id): B's open-shift dialog
offers "ใช้กะนี้ต่อที่เครื่องนี้" (BUG-03 recovery for a lost terminal id) and that button RE-KEYS THE WHOLE PC to
B's other terminal id (`setTerminalId`). When A logs back in, `/shifts/current?terminalId=<B's id>` has nothing for
A: A gets the "count the drawer" dialog, A's shift (with its sales and cash) looks gone, and opening again is refused
because B's shift now sits on that id. Root cause: a per-user recovery action changes a per-device identity while the
device's own id still holds another user's open shift (the id was not lost at all).

Fix:
- Server: `ShiftsService.terminalOccupant()` = another user's open shift on a terminal. `GET /shifts/terminal-status`
  returns it (`{ busy }`); `GET /shifts/mine-elsewhere` sets `canContinueHere: false` + `blockedBy` when the caller's
  current terminal holds another user's open shift (so "ใช้กะนี้ต่อที่เครื่องนี้" can no longer re-key a PC that is not
  lost); `POST /shifts/open` refusal names the shift and its owner.
- POS open-shift dialog: a red notice "เครื่องนี้มีกะ SH… ของ <name> เปิดอยู่ …" (the shift is intact, its owner must
  log in here and close it), counting grid hidden, ตกลง / ข้ามการเปิดกะ disabled, button "ออกจากระบบ ให้เจ้าของกะเข้าใช้".
  The continue button of the user's own shift elsewhere is disabled with the reason.
- Shift store: the cached shift is only used when it belongs to the logged-in user; a `/shifts/current` reply that
  arrives after the user changed is dropped; any sign-out path (not only the logout buttons: 401, disabled account,
  change-password page, no-access page) forgets the previous user's shift (auth-store subscription).
- Outbox / held bills (unchanged, verified): an offline sale carries its `shiftId` and `ownerId`; it is sent only while
  its owner is logged in (B never sends A's sale) and lands in A's shift once A is back (Playwright checks it). Held
  bills are carts kept on the device, without a shift; a resumed bill is sold into the shift of whoever checks it out.
  Closing a shift is refused while the outbox still has bills of that shift.
- Already-broken devices (PC re-keyed by the old button): A's dialog lists A's shift under "คุณมีกะที่ยังเปิดอยู่";
  if B's shift sits on the PC's current id, B logs in there and closes it first, then A continues.

## 2. Today by default (Asia/Bangkok)

Audit of every page with a date range / date filter (fresh open -> today; nothing is remembered across visits,
so a fresh open is always today; presets unchanged unless noted):

| Page | Before | Now |
| --- | --- | --- |
| แดชบอร์ด `/dashboard` | 7 วันล่าสุด | วันนี้ (presets วันนี้/7 วัน/30 วัน/เดือนนี้/ทั้งหมด) |
| รายงาน `/reports/*` (ยอดขาย & กำไร, สินค้าขายดี, มูลค่าคลัง, การชำระเงิน & กะ, ลูกค้า & หนี้, จัดซื้อ & เคลม) | 30 วันล่าสุด | วันนี้ (presets วันนี้/เมื่อวาน/7 วัน/30 วัน/เดือนนี้/เดือนที่แล้ว/ปีนี้/ทั้งหมด/กำหนดเอง) |
| บิลขาย `/orders` | ทุกวันที่ (empty dates) | วันนี้ in both date boxes + NEW presets วันนี้/เมื่อวาน/7 วัน/เดือนนี้/ทุกวันที่ |
| ประวัติกะ `/shifts` | ทุกช่วงวันที่ | วันนี้ (= closed today or still open) |
| สต็อกการ์ด `/inventory` tab | ช่วงเวลาทั้งหมด | วันนี้ (Bangkok midnight, was the PC's local midnight) |
| งบกำไรขาดทุน `/finance?view=pl` | 1st of month .. today | today .. today + NEW preset วันนี้ |
| การเงิน `/finance` (ledger, expenses, summary) | วันนี้ | unchanged |
| POS ประวัติบิล (OrderHistoryModal) | วันนี้ | unchanged |
| Monitor `/monitor` | today figures | unchanged |
| มือถือ `/m` บิล tab | every day | วันนี้ ("ทุกวัน" clears it) |
| มือถือ `/m` ยอดขาย | วันนี้ | unchanged |

Not changed (decision): เคลม `/claims` date filter stays empty = all - a claim is a workflow that stays open for days;
hiding yesterday's open claims would lose work. Bank reconcile statement date already defaults to today.
Pages without a date filter: payables, POs, debts, supplier returns, customers, online orders.

Bug found and fixed on the way: `GET /orders?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` used UTC midnight..UTC
midnight (picking one day showed nothing, a range missed the last day and took 7 h of the day before). It now uses
the shared Bangkok day filter (`dateRangeFilter`: whole Bangkok days, end inclusive); ISO timestamps unchanged.
Shared helper: `frontend/src/lib/date-presets.ts`.

## 3. Bundle items picker

`frontend/src/components/products/ProductSearchPicker.tsx` (new, reusable combobox): server paging search
`GET /products/page?q=&limit=20&status=all` (the products page search: name, SKU, ชื่อผู้ผลิต, barcodes, pack
barcodes, supplier names/codes; ILIKE, Thai text as typed), 200 ms debounce, newest reply wins, rows of the previous
text are dropped at once (an early Enter never picks a stale row). Keyboard: type, ↑/↓ (skips rows that cannot be
picked), Enter picks (never submits the product form), Escape closes the list. Rows show name, SKU, two barcodes,
price, stock; a row that cannot be picked is greyed with the reason: "สินค้าชุดนี้เอง", "เป็นสินค้าชุด (ใส่ชุดซ้อนชุด
ไม่ได้)", "ปิดใช้งานอยู่".

`BundleItemsSection`: the picker replaces the dropdown rows and the "เพิ่มสินค้าเข้าชุด" button; a pick adds a row
(quantity 1) and focuses its quantity (selected, type the number); picking a product already in the bundle focuses its
quantity instead of adding a second row. Rows show name / SKU / "ปิดใช้งาน" chip, quantity, unit price, line total,
stock; names of rows the page does not hold come from GET /products/:id. The form no longer loads the whole
catalogue when a bundle is edited.

Server (`assertBundleChildren`): a NEWLY added child that is a bundle (no nesting, so no cycles) or a disabled product
is refused (400); rows the bundle already had are kept as they are (old data never blocks an edit); self was
already refused.

## 4. Delete a used product with a replacement

Before: a product named in any document was refused (`PRODUCT_IN_USE`), only "ปิดการใช้งาน" was offered.
Now the delete dialog of such a product (`ReplaceProductDialog`) offers a REPLACEMENT; unused products delete as before.

API (same rights as delete: ADMIN / MANAGER + MANAGE_INVENTORY):
- `GET /products/:id/replace-check?replacementId=` -> counts (บิลขาย, รายการในบิล, ใบคืน, ออเดอร์ออนไลน์, ใบสั่งซื้อ,
  ใบคืนผู้จำหน่าย, เคลม, คลังเคลม, ประกันทดแทน, ชุดสินค้า, ความเคลื่อนไหวสต็อก, ล็อตสต็อก), barcodes, problems.
- `POST /products/:id/replace { replacementId, moveBarcodes = true }`.

Refused (409 with the reason): stock != 0 (`STOCK_NOT_ZERO`: "ต้องปรับสต็อกให้เป็น 0 ก่อน", the dialog has
"ไปปรับสต็อกเป็น 0" -> inventory adjust dialog of that product), same product, kind mismatch (a bundle only by a bundle,
a normal product only by a normal one: no nested bundles, so no cycle), inactive replacement, bundle cycle, replacement
not found.

One transaction (`backend/src/products/product-replace.ts`; business advisory lock, both product rows locked, 120 s):
1. Snapshot BEFORE repointing: `snapshot_name` / `snapshot_sku` (new nullable columns) = the old product's name / code on
   order_items, order_return_items, online_order_items, purchase_order_items, customer_claims, claim_inventory (lines that
   already have one keep it); supplier_return_note_items / replacement_warranties fill their own product_name / sku where
   empty; claims get unit_price / unit_name from the old product where empty (claim_records fell back to the product).
2. Repoint product_id to the replacement: order_items, order_return_items, online_order_items, purchase_order_items,
   supplier_return_note_items, customer_claims (product_id and replacement_product_id), claim_inventory,
   replacement_warranties, stock_batches (stock nets to 0: batches settled at 0 first so the replacement's stock and FIFO
   cost do not change; the receipt history moves), audit_logs STOCK_* (stock card; details keep the old name / code and get
   `replacedProductId`). Prices / amounts are never touched.
3. Bundles containing the old product: the replacement takes its place; if the bundle already holds the replacement the
   quantities are added (one row).
4. Supplier links merged (`ON CONFLICT (product_id, supplier_id) DO NOTHING`: an existing link of the replacement wins).
5. Barcodes: "ย้ายบาร์โค้ดไปสินค้าทดแทน" (default on) moves the base-unit barcodes (unique shop-wide, so no clash possible);
   off = they are freed with the product. The old SKU is freed. Pack barcodes go with the old packs (decision: their
   unit does not exist on the replacement).
6. Tombstone `product_replacements` (old id PK -> replacement, old name / code, user, counts); earlier tombstones that
   pointed at the old id are re-pointed (chains).
7. Delete the product (packs, photos, wholesale prices, remaining supplier rows / barcodes, its own bundle rows by
   cascade). Audit `PRODUCT_REPLACE` on both ids (counts, moved rows, user). `product_changes` trigger -> POS terminals
   drop the old product on their next delta sync.

Display: the response walk that already turns quantities into numbers (`common/qty.ts`) now also applies the snapshot:
a line with `snapshotName` shows `product.name/sku` = the original (and `product.replacedBy`), so bills, slips, PO,
returns, claims, online orders keep the original name without per-screen changes. Lines without a snapshot are
untouched (renaming a product still shows the new name on old bills, as before). claim_records view: snapshot first.
Reports by product / stock card: grouped by product_id -> counted under the replacement.

Offline / late lines: `POST /orders/checkout` maps a line whose product id is in `product_replacements` to the
replacement (chains followed, loop-safe; a pack id of the old product is dropped -> base unit), so held bills and the
offline outbox written before the delete still sync. The online shop maps cart lines the same way (base unit).
Unknown ids are still refused. Desktop client: no change needed (it loads the web app; the terminal-id bridge is unchanged).

Migration `20261210000000_product_replace` (additive: nullable columns, new table, CREATE OR REPLACE VIEW claim_records with
the same columns). Fresh-DB `migrate diff` empty.
