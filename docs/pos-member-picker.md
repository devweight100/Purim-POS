# POS member picker, history customer name, held-bill delivery note (owner requests 2026-11-27)

Progress / decisions file for the round "history shows the member, member picker after payment, address in the
member list" and the follow-up "บิลส่งของ for held bills".

## Owner requests (translated)
1. The sales history opened from the POS (ประวัติ, Ctrl+H) does not show the customer name although a member was
   selected; it must show the member's name.
2. Member picker: (a) a setting whether the member picker pops up and waits after every completed payment;
   (b) show the customer's address in the member list, and make the picker larger so it is tidy.
3. Held bills must print a slip / bill for delivering goods or collecting money from the customer - not a receipt,
   called "บิลส่งของ", with prices and every line, only not paid yet.

## 1. History customer name

**Root cause.** `orders` has no customer-name column: a member bill is linked by `customer_id`, and `GET /orders`
returns the member as `customer: { id, name, phone }`. The POS history (`OrderHistoryModal`) read only
`order.customerName`. Until f979cd8 ("shifts, orders ... use the server only") the history merged the terminal's
local completed orders first, and those local objects carried `customerName`, so the name showed for sales made on
that terminal; since the history is server-only, every member bill showed "ลูกค้าทั่วไป (Walk-in)". Not an API
problem, not offline-sync specific (outbox bills are posted with `customerId`, same relation).

**Fix.** `frontend/src/lib/order-customer.ts` `orderCustomerName(order)`: the member's current name
(`customer.name`), else a name kept on the bill object (`customerName`, the POS's own objects), else null
(walk-in). The history fills `customerName` with it when it loads the bills, so the list row, the item breakdown
("ลูกค้า: ..."), the search by customer name and "ขายซ้ำ" (repeat order keeps the member) all work; the reprint already
read `customer.name` (receipt-mapper). The back office bills list / detail and the dashboard already handled
both shapes; they now use the same helper (one rule).

There is no "typed customer name without a member" on POS bills: the checkout has no such field (a walk-in bill
stores no name). Nothing to show for those beyond "ลูกค้าทั่วไป".

Tests: vitest `order-customer.test.ts` (5); backend e2e "a member bill in the sales history list" (GET /orders
carries the member, walk-in = null); Playwright `44` test 1 (Ctrl+H row, search, item breakdown show the member;
walk-in row "ลูกค้าทั่วไป"). Reproduced before the fix: screenshot `before-pos-history-*` (member bill
IN2611-0001 shown as walk-in).

## 2. Setting "เปิดหน้าเลือกสมาชิกรอไว้หลังรับชำระเงิน"

- **Where / scope**: shop-wide, `store_settings.pos_pick_member_after_sale` (migration
  `20261212000000_pos_member_after_sale`, default **false** = nothing changes until the shop turns it on), next to
  "เลือกลูกค้าก่อนเริ่มบิลทุกครั้ง" under ตั้งค่า > การขายและใบเสร็จ. Every POS behaviour setting there is shop-wide
  (`posAskCustomerAtStart`, `walkInLevelNeedsDiscount`, decimal qty); there is no per-terminal POS behaviour
  setting, so this follows them. Terminals pick the change up with the usual settings refresh (F5 / live sync).
- **When ON**: the success screen of a sale closes (Enter, the 5 s auto close, the button, or closing the receipt
  preview) -> `PaymentModal.onSaleClosed` -> instead of the standby focus the member picker opens with the focus in
  its search (header says "รับชำระเงินแล้ว · เลือกสมาชิกสำหรับบิลถัดไป ... Esc = ไม่ระบุสมาชิก"). A cancelled
  payment and a payment edit from the history do not open it.
  - typed member code / phone / name + Enter (↑/↓ to choose) = that member for the next bill, then standby;
  - a **scanned member code** (member card) or phone = that member (exact code, or exactly the phone's digits,
    single match; never when the code is also a product code);
  - a **scanned product** closes the picker ("no member") and goes to the cart through the normal add flow (the
    scanner burst detector restores the search text; the scan is not lost); focus back on the scan box;
  - Esc / ✕ = sell without a member, standby on the scan box.
  - the search keeps the focus against the receipt print frame / the payment dialog's focus return (timed checks
    0-3 s) and against any late "back to the scan box" focus (also for Ctrl+M: found by e2e 45, a scan right before
    Ctrl+M took the typing into the hidden scan box).
  - with "เลือกลูกค้าก่อนเริ่มบิลทุกครั้ง" also on: leaving the auto-opened picker without a member (Esc / product
    scan) counts as that choice (ลูกค้าทั่วไป ราคาปลีก, like the start dialog's own Esc), so the start dialog does
    not ask again; picking a member sets the level as before.
- **OFF (default)**: unchanged - after payment the focus returns to the scan box (docs/pos-keyboard-scan.md; e2e 32
  and 44 check it).
- The member picker opened with **Ctrl+M** keeps its behaviour from docs/pos-keyboard-scan.md: a product scan adds
  to the cart and the picker stays open (the cashier is choosing a member for the current bill). Only the member
  card scan selecting the member is new there.

## 3. Member picker

- Each row: name (+ บุคคล / บริษัท), phone, member code (+ tax id, credit limit when set), **address** on its own
  line (address, else the tax-invoice address; one line with ellipsis, full text in the `title` tooltip; "ไม่มีที่อยู่"
  when empty), points and price level on the right. Plain text (no badges/emoji), per docs/ui-style.md.
- Dialog: 920 px wide (max window - 32 px), up to 820 px high (window - 32 px), the list takes the free height
  (several rows at 1093x614), no horizontal scroll at 1366x768 / 1920x1080 / 1093x614; walk-in level buttons 8 px
  apart. The old dialog's content overflowed it sideways (before screenshot).
- Search also matches the address, the member code and the company (the list is the in-memory customer list, so
  it costs nothing; the server search was not needed).
- ↑/↓/Enter unchanged.

## 4. บิลส่งของ (delivery note) for held bills

- **Where**: held-bills sheet (F10 on an empty cart): each held bill has "บิลส่งของ" (next to ใบจัดของ); held online
  orders in the same sheet too; the current cart: **Shift+F8** (both layouts; named in the ใบจัดของ button's
  tooltip). A cart-header button was tried and removed: the header has no room at 1366 / 1093 px (e2e 17 spacing
  check put "ล้างตะกร้า" at the window edge). All buttons are keyboard reachable; the preview dialog opens with the focus on
  "พิมพ์บิลส่งของ": Enter = print, Esc = close, Tab to "สลิป 80mm" / "กระดาษ A4".
- **Content** (`components/pos/DeliveryNoteView.tsx`): shop header (Settings > รูปแบบใบเสร็จ rules, seller tax id left
  out), title "บิลส่งของ (ไม่ใช่ใบเสร็จรับเงิน)", reference (held bill label / online order no.), print date + time,
  held / ordered time, customer or member name, phone, **address** (member's address, else tax address; online:
  the delivery address), note, every line with quantity, unit, unit price, line discount and line total, goods
  total, bill discount, points discount, claim credit, delivery fee (fee line of the bill / the online order's fee,
  "ร้านแจ้งภายหลัง" when not set), grand total, a boxed "ยังไม่ได้ชำระเงิน · ยอดที่ต้องชำระ ฿x", signature lines
  ผู้ส่งของ / ผู้รับของ, the cashier's name. No receipt number, no VAT / tax-invoice wording, no payment method, no
  cash received / change.
- **Formats**: slip 80 mm (default, same pipeline as every slip: desktop app raster job, browser print preview) and
  A4 (the shared A4 store header; prints through `printDocumentIframe(..., 'a4')` like the other A4 documents).
- **Amounts** (`lib/delivery-note.ts`): the held bill's own lines at print time, through the shared pricing functions
  (`shared/src/pricing.ts`, the cart's and the checkout's rules). The held-bills sheet now shows the same total (it
  had its own formula that ignored redeemed points / claim credit). The payment re-checks prices as today: if a
  catalogue price changes between the print and the payment, the paid total can differ from the printed note.
- **No side effects**: printing creates no order, no stock movement, takes no document number and leaves the held
  bill as it is (e2e 45 compares orders count, stock movements and the stored held bills before / after).
- **Audit**: held bills live on the terminal only (localStorage), so their prints are not logged on the server (no
  print count). Held online orders are server-side: `GET /online-shop/orders/:id/delivery-note` (read only: no claim,
  no status change) and `POST /online-shop/orders/:id/delivery-note/print` (audit log `PRINT_DELIVERY_NOTE` with the
  total and format; returns the count). The 2nd and later prints say "พิมพ์ครั้งที่ n". Reprint is allowed.
- Held-bills sheet: wider (560 px), the member name wraps normally (it was one word per line), actions in two rows
  (เรียกคืนบิลนี้; บิลส่งของ / ใบจัดของ / ลบ).

Tests: vitest `delivery-note.test.ts` (4); Playwright `45-held-bill-delivery-note` (3): held bill by keyboard with
discounts, member phone / address, content and forbidden words, slip job (80 mm) and A4 job captured from the desktop
bridge stub, no horizontal scroll, nothing sold / no stock movement / held bill unchanged; Shift+F8 on the cart;
held online order at the agreed prices + fee, print logged, reprint marked, order unchanged.

## Status
- [x] 1. history name (root cause, fix, back office checked, tests)
- [x] 2. setting + auto-open + scan / member-card handling + focus rules
- [x] 3. picker with addresses, larger, address search
- [x] 4. held-bill delivery note (slip + A4, cart, online orders, audit for online orders)
- [x] tests, full verification, screenshots before / after

## Screenshots (deviceScaleFactor 2, session scratchpad `pos-member/`)
`before-` / `after-` + `pos-history`, `member-picker`, `settings`, `held-bills` at 1366x768, 1920x1080, 1093x614;
after only: `member-picker-after-sale`, `delivery-note-slip`, `delivery-note-a4`.

## Desktop client
No desktop change needed: the POS is served by the server; the Electron client prints the delivery note through
the existing `printSilent` path (80 mm raster job / A4 job) like the picking slip and receipts.
