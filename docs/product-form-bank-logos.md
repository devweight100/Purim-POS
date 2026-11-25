# Numpads by keyboard, product form stock + layout, bank logos (owner round 2026-11-25)

Progress / decisions file (read this first when continuing).

## Owner requests
1. Every numpad (POS + back office) takes keyboard digits at once, without a click first.
2. Product form: stock quantity field (create = opening stock, edit = adjustment movement through the inventory
   adjustment service; concurrency check against the stock the user saw).
3. Product form layout by priority: name, cost, prices 1-5, barcode, SKU, stock on top (and in Tab order); the rest
   below in "ข้อมูลเพิ่มเติม"; Enter = save; first field autofocused.
4. Bank logos for receiving accounts (built-in badges + optional uploaded logo), cashier selects the receiving
   account at transfer payment (keyboard), recorded on the payment.

## Status
- [x] 1 numpads: reproduced (spec 33 on 2044860: open-shift total stayed empty), root cause, central fix, Playwright
- [x] 2 product stock field: backend (+ e2e), frontend (spec 34)
- [x] 3 product form layout (spec 34 Tab order; specs 12 / 20 / 23 follow the new order)
- [x] 4 bank logos + account selection (backend e2e, spec 35, shared vitest/jest)
- [x] full verification + screenshots (table below)

## 1. Numpads
**Root cause.** Base UI dialogs give the initial focus to their *first tabbable element* and overrule React's
`autoFocus`. In the open-shift dialog that is the "เปิด Numpad ยอดเงินรวม" button, in the item editor (F3) the
"คืนค่าเดิม" button, in the close-shift / count / debt dialogs a button before the amount field. With the focus on a
button, typed digits went nowhere until the field was clicked. The same happened whenever a button inside the dialog
had the focus (after a banknote / 25 % / mode button, or Tab). `NumpadPopup` (F2 / F4 / payment amounts) and
`PinPad` already took window-level keys and were not affected.

**Fix (central, `frontend/src/lib/keyboard/pad-field.ts`).**
- `components/ui/dialog.tsx`: every dialog without its own `initialFocus` now focuses its pad field
  (`data-pad-field`, value selected so the first digit replaces it), else the field React auto-focused, else Base UI's
  default.
- `components/common/PadFieldKeys.tsx` (mounted once in `providers.tsx`): one document-capture keydown listener. A
  digit / "." / Backspace typed while the focus is *not* in a field of the topmost dialog (a button in it, the page
  behind, the POS scan box in the moment before the dialog took the focus) goes into that dialog's pad field and
  moves the focus there. Other fields of the dialog keep their keys; `data-own-digits` areas (bank choice) too;
  dialogs without a pad field (NumpadPopup, PinPad, confirm dialogs) are left alone.
- Scanner safety: it runs after the POS scan detector (window capture) and registers the field it typed into with
  `subscribeBurstAware`, so a scan from a focused button leaves no digits in the amount (spec 33 checks it).

**Pad fields marked:** open shift total, close shift counted cash, cash count (first note), cash drawer amount (F9),
item editor (price, or the discount when a discount type is chosen), bill discount, claim quantity, redeem points,
payment cash received, split transfer amount, debt payment amount (POS + back office). Already fine and unchanged:
F2 quantity / F4 price / payment numpads (`NumpadPopup`), manager / export PIN pads (`PinPad`).

## 2 + 3. Product form
**Order on top (DOM = Tab order, name focused):** ชื่อสินค้า -> ต้นทุน -> 1. <level 1 name> ... 5. <level 5 name>
(the shop's level names from `useLevelNames`) -> บาร์โค้ด -> รหัสสินค้า (blank = generated) -> จำนวนสต็อก (base unit).
**ข้อมูลเพิ่มเติม (each a folding section, title = a button):** หน่วย หมวดหมู่ และรายละเอียด (unit, category,
low-stock alert, size, colour, manufacturer name, product type) -> bundle items (bundles) -> หน่วยบรรจุ -> บาร์โค้ดทั้งหมด
(first one read-only, typed on top) -> ผู้จำหน่ายและต้นทุน (supplier names / codes) -> ราคาส่งตามจำนวน -> รูปภาพ.
Enter = save (useEnterSubmit: textarea Ctrl+Enter, buttons keep their Enter, Ctrl+Enter still saves); the barcode
fields' Enter moves to the next field (scanners end with Enter). Validation unchanged (name, bundle items, server
checks).

**Stock field.** Server: `stockQuantity` (+ `expectedStock` on update) on POST / PATCH `/products`, handled inside the
product's transaction by `InventoryService.adjustStock(type SET)` - the one stock path (FIFO batches + movement log):
- create, not 0: movement reason "สต็อกเริ่มต้น (เพิ่มสินค้าใหม่)", cost = the form cost;
- edit, changed: movement "ปรับจากหน้าแก้ไขสินค้า" (difference, user name), in the stock card;
- `expectedStock` is required with a change; when the stock changed meanwhile -> 409 `STOCK_CHANGED` with
  `currentStock`, nothing of the form saved. The form asks: "ตั้งเป็น N" (saves with the new expected value) or
  "ใช้ยอดปัจจุบัน" (field set to the current stock, form stays open). The edit form also refreshes the stock from
  `GET /products/:id/stock` when it opens (unless the user already typed).
- Permission: same rule as `POST /inventory/adjust` (MANAGE_INVENTORY / ADMIN), checked in the service too;
  bundles refused (their stock comes from the children; the field is disabled for them).
- Decimals: the shop's quantity setting (`decimalQtyEnabled` in the form, `adjustStock` on the server).

## 4. Bank logos
- `shared/src/thai-banks.ts`: KBank, SCB, Krungthai, Bangkok Bank, Krungsri, ttb, GSB, BAAC, GH Bank, UOB, CIMB,
  KKP, LH Bank, TISCO, ICBC, PromptPay, other; colour + abbreviation per bank; `inferBankCode` for accounts saved
  before (old free-text names); `bankLogoError` (PNG / JPEG / WebP by MIME *and* first bytes, <= 150 KB, never SVG).
- Migration `20261209000000_bank_logos` (additive): `bank_accounts.bank_code`, `bank_accounts.logo_url`.
- `components/common/BankLogo.tsx`: the uploaded logo when set, else the badge drawn as inline SVG (offline, no bank
  logo files shipped).
- Settings > บัญชีการเงิน: bank dropdown (+ name field for "อื่น ๆ"), badge preview, "ใช้โลโก้ของร้านเอง"
  (file redrawn through a canvas to a 128 px PNG: only pixels survive; SVG refused), "ใช้สัญลักษณ์ธนาคาร" removes it.
- POS QR / transfer: one account = preselected; several = nothing preselected, list with logos, number keys 1-9,
  arrows (selection follows), Enter confirms (Enter with nothing chosen picks the focused one); confirming without a
  choice is refused with a message. Split: account select starts empty when there are several. The chosen account
  is sent as `bankAccountId` (already stored on `payments` and posted to that bank in the ledger).
- Bill detail (back office orders): "ชำระโดย" lines, QR / transfer with the receiving account and its logo.

## Decisions
- Numpad fix is central (dialog default focus + one listener) rather than per dialog; dialogs opt in with
  `data-pad-field`. The first redirected digit replaces the field's value (same as the on-screen numpads).
- No vitest for pad-field: the frontend has no DOM test environment (no jsdom); covered by Playwright spec 33.
- Stock: single warehouse - the system has no warehouses / branches (one stock pool per product), nothing to choose.
- Stock field only sends a change on edit (untouched = no stock in the request, so other edits never conflict).
- The concurrency check compares with the stock the form showed (refreshed at open); a mismatch never overwrites.
- Collapsible sections are open by default (keyboard + existing tests reach everything); a closed section is
  remembered per browser (localStorage, convenience only).
- Price labels show the shop level names with the number ("1. ราคาปลีก"); aria-label stays "ราคา N".
- The reference cost field moved to the top as "ต้นทุน" (same field `costPrice`); the supplier section keeps the
  average cost button ("ใช้เป็นต้นทุน").
- Bank: an account without `bank_code` shows the badge inferred from its name; saving it in settings stores the code.
- Several accounts: no default preselection at payment (owner: explicit choice). The server still accepts a QR
  payment without an account (older clients / offline queue) and books it to the default bank as before.
- Shift summary: it has no per-bank place (only QR / transfer totals); not changed. The bill detail shows the account.
- Desktop client: no change needed (it loads the pages from the server; no keyboard / form code of its own).

## Verification (2026-11-25)
| Check | Result |
| --- | --- |
| backend `tsc --noEmit` | ok |
| backend jest | 190 / 190 (shared thai-banks spec included) |
| backend e2e (fresh DB) | 139 / 139 (new: product form stock 4, bank logos + receiving account 2) |
| fresh-DB `migrate deploy` + `migrate diff` to schema.prisma | empty diff |
| frontend `tsc --noEmit` | ok |
| frontend eslint | 0 errors (98 warnings, was 99) |
| frontend vitest | 346 / 346 (new: thai-banks 3) |
| frontend `next build` | ok |
| Playwright full suite (fresh DB) | 137 / 137 (new: 33 numpads 3, 34 product form 3, 35 bank logos 2); after the last two layout fixes 14 / 15 / 32 / 33 / 35 re-run on a fresh DB: all pass |
| desktop `npm test` + `node --check *.js` | 13 / 13, ok (desktop untouched) |
| no horizontal scroll 1366x768 / 1920x1080 / 1093x614 | product form, accounts page + dialog, POS transfer screen: none (specs 34 / 35 + screenshot script) |

Reproduced on 2044860 (spec 33, before the fix): open-shift dialog, digits typed without a click left
"ยอดเงินรวมในลิ้นชัก" empty (focus on the "เปิด Numpad" button); item editor focus on "คืนค่าเดิม".

Screenshots (deviceScaleFactor 2, long Thai names, several barcodes, prices 1-5, 3 bank accounts) in the session
scratchpad `form-bank/`: before / after of product add + edit, accounts page + edit dialog, POS transfer screen;
after only: filled add form, "ข้อมูลเพิ่มเติม", transfer with an account chosen, bill detail (before = no payment
lines).
