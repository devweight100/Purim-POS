# Round: start screen, monitor back, dashboard credit card, back-office debt payment into a shift

Owner round 2026-11-19/20. Branch `ccr-8f8b0741-si1a0o`.

## 1. Start screen `/start` (หน้าขาย (POS) / หลังบ้าน)
- Shown after login (`homePathFor` -> `/start`, phones with the summary still `/m`), after the password change, at `/`
  (redirects to `/start`) and when the desktop app opens.
- Big buttons (≥ 200 px tall, icon, title, description, "กด 1" / "กด 2"); header: shop name (settings mirror),
  user + role, version badge, ออกจากระบบ. Keys: `1` POS, `2` back office, ←/→ (↑/↓) move focus, Enter opens.
- Logic `frontend/src/lib/start-screen.ts` (vitest `start-screen.test.ts`):
  - back office = `firstBackOfficePage(user)`: the POS "เมนูหลัก" home (`backOfficeHomeFor`), else the first other
    page the user may open (settings first; a settings/users-only manager used to land on "ไม่มีสิทธิ์").
  - **Decision (owner may change):** a cashier counts as having a back office only if they may open a back-office
    page *beyond* the bills / customers / shifts lists that POS_SELL alone opens. So a POS_SELL (+POS_DISCOUNT)
    cashier goes **straight to the POS** (no chooser; the POS "เมนูหลัก" still opens the bills); the seeded cashier
    (POS_SELL, POS_DISCOUNT, MANAGE_CLAIMS) sees both buttons.
  - one option only -> straight there (POS-only -> /pos; no POS -> first back-office page).
  - **Offline:** the page needs no server call to render. A *selling device* (Settings > "เครื่องนี้ใช้ขายหน้าร้าน",
    explicit or automatic) that is offline (`navigator.onLine` false, or `/api/version` does not answer in 1.5 s)
    goes straight to the POS. The service worker answers a failed `/start` (or `/`) navigation with a redirect to
    the cached POS shell. A non-selling device shows the chooser with a "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" banner.
  - **Device setting:** pre-selects (focus + ring + label) the matching button: "ไม่ใช้ขาย" -> หลังบ้าน,
    otherwise หน้าขาย (the first button). It never skips the chooser.
  - `?go=pos|backoffice` (used by the desktop Ctrl+Shift+2; was F2 until docs/pos-keys-refresh.md) opens that option directly when allowed.
- Desktop (`desktop/start-url.js`, tested by `start-url.test.js`, run in CI): after auto-connect and after
  "เชื่อมต่อ" on the server screen -> `/start`; F1 / menu "หน้าขาย" -> `/pos`; F2 / menu "หลังบ้าน" ->
  `/start?go=backoffice` (first allowed back-office page, not a forced /dashboard); new menu item
  "หน้าเริ่มต้น" (Ctrl+Shift+H). Reload keeps reloading the current page; splash / watchdog / crash reload unchanged.

## 2. Monitor back button
`/monitor` "◀ กลับหลังบ้าน" -> `backOfficeHomeFor(user)` (the dashboard for every user who may open the monitor).

## 3. Dashboard
- Removed the bottom shortcut row (ไปที่หน้าขาย POS / ค้างชำระ ฿… / สต็อกต่ำ … รายการ): it repeated the KPI card
  "เงินเชื่อคงค้าง" and the mini metric "สินค้าใกล้หมด"; the POS is in the sidebar.
- KPI card 4 is now the credit-customer card (`GET /debts/credit-summary`): customers / bills still owing, total,
  overdue customers + amount (red border when something is overdue). Enter / click -> dialog (`GET
  /debts/owing-customers`): customer, phone, amount owed, bills, oldest bill, overdue amount / bills / oldest due
  date, "ดูหนี้"; search, "เฉพาะที่เกินกำหนด", ↑/↓ + Enter opens `/debts?customerId=…&status=unpaid`; link to the
  debts page "ยังชำระไม่ครบ" tab (`/debts?status=unpaid`, new param).
- Single source: `debtStats()` in `debts.service.ts` computes both the debts page cards and the dashboard card
  (owed = NOT (status PAID or remaining <= 0), overdue = owed and due date passed). e2e checks equality.
- Still overlapping (not at the bottom, left for the owner): KPI cards "รายได้สุทธิ" / "คืนเงิน & ยกเลิกบิล" repeat
  steps 3 / 2 of the flow banner above them.

## 4. Debt payment into a cashier shift (back office)
- Migration `20261206000000_debt_payment_shift`: `debt_payments.shift_id` (FK shifts, SET NULL). Backfill: cash
  receipts from their drawer movement, QR / transfer receipts by the old summary rule (receiving user's shift open
  at that time); checked on old data.
- `POST /debts/:id/pay` (`debts.service.ts payDebt`): `shiftId` (any OPEN shift; another cashier's needs ADMIN /
  MANAGER / MANAGE_DEBTS / ALL) or `noShift: true` (same rights).
  - into a shift: cash -> drawer movement DEBT_PAYMENT on that shift + ledger IN to that terminal's drawer (shift
    expected cash includes it, close-shift reconciliation unchanged); QR / transfer -> ledger IN to the chosen bank,
    counted in the shift's `debtCollectionQrTransfer` (now by `shift_id`, was by user + time window).
  - no shift: cash -> ledger IN to the safe (CASH_SAFE); QR / transfer -> chosen bank; no cash movement, no shift
    changes. Cancelling such a cash receipt reverses the safe row once.
  - chosen shift not OPEN -> 409 `{ code: 'SHIFT_NOT_OPEN', message: 'กะ SH… ปิดไปแล้ว …' }`, nothing written
    (the store-wide business lock serializes it with closeShift). The dialog reloads the open shifts, clears the
    choice and asks to pick again.
  - POS (no `chooseShift`): the device's current shift for cash and now also QR / transfer; an older client that
    sends no shift for QR keeps the old rule (caller's open shift). Cash without a shift is still refused.
  - Payment methods unchanged (CASH / TRANSFER / QR; the dialog's บัตรเครดิต button is refused by the server, as
    before). Receipt RC… unchanged + "เข้ากะ SH…" line when in a shift (receipt and history).
- `GET /debts/open-shifts` (MANAGE_DEBTS): shift number, cashier, terminal name (heartbeat name or จุดขาย #ID),
  opened time. Picker default: this user's own open shift if listed, else "ไม่เข้ากะแคชเชียร์".

## Verification
See PROJECT_STATUS.md entry 2026-11-20.

# Follow-up round (owner's answers, 2026-11-20)

## A. Start chooser always shown
- `startDecision` (`frontend/src/lib/start-screen.ts`) no longer skips the chooser when the user has one option: a
  POS-only cashier (POS_SELL / POS_DISCOUNT) sees both buttons. **Choice: disabled, not hidden** - "หลังบ้าน" is
  greyed, cannot be focused or opened (key 2 does nothing), shows a lock + "ไม่มีสิทธิ์เข้าหลังบ้าน" and "ให้ผู้ดูแลร้าน
  เพิ่มสิทธิ์ที่หน้า พนักงาน & สิทธิ์". The same for a user without the POS ("ไม่มีสิทธิ์ใช้หน้าขาย"). The allowed
  button is pre-selected; with both allowed the device setting decides as before.
- "Back office" is still a page beyond the bills / customers / shifts lists POS_SELL opens.
- Granting a right: changing a user's permissions revokes their sessions (security rule of round 3,
  `tokenVersion`), so the cashier is signed out; after logging in again the button is active.
- Kept: an offline selling device goes straight to the POS (when the user may sell); `?go=` opens an allowed option
  (an option the user may not open shows the chooser with that button disabled).

## B. Back-office debt payment: explicit shift choice
- `POST /debts/:id/pay` requires `shiftChoice`: a shift id (the picked OPEN shift), `'NONE'` (ไม่เข้ากะแคชเชียร์,
  back-office rights) or `'POS'` (the POS dialog: the device's current shift in `shiftId`, the old automatic rule).
  Missing / blank / not a string -> 400 `{ code: 'SHIFT_CHOICE_REQUIRED' }`, nothing written; the old `noShift`
  field and a bare `shiftId` are not a choice. A `shiftId` that disagrees with an explicit shift choice -> 400.
- Dialog (debts page): no default (was "this user's shift, else ไม่เข้ากะ"). The picker starts at "— เลือกกะที่รับเงิน —"
  with "* ต้องเลือก"; "ยืนยันรับชำระ" stays disabled with a hint above it ("ยังบันทึกไม่ได้: เลือกกะที่รับเงิน หรือ
  "ไม่เข้ากะแคชเชียร์" ก่อน", a label: click / tap focuses the picker). Every open starts without a choice. The picker is
  a native select (Tab, arrows, type-ahead).
- POS: `recordDebtPayment` sends `shiftChoice: 'POS'` + its current shift, unchanged behaviour.
- Note: a browser tab still running the previous build gets the 400 until it reloads (the desktop app and the
  browser load the current build from the server).

## C. No card button in the debt payment dialog
"บัตรเครดิต" removed (methods เงินสด / QR โอน / โอนธนาคาร, 3 columns). The dialog is shared, so the POS debt dialog lost
it too; the server refused card debt payments everywhere anyway.

## D. Dashboard
- KPI row: "รายได้สุทธิ (Net Sales)" and "คืนเงิน & ยกเลิกบิล" cards removed (steps 3 / 2 of the banner). The row is now
  2 equal cards, ออเดอร์สำเร็จ (count + average per bill) and ลูกค้าเงินเชื่อ (unchanged), filling the width.
- Banner: no "+", "-", "=" before ยอดขายรวม / คืนเงิน & ยกเลิกบิล / รายได้สุทธิ (also not before the void / return amounts
  under step 2).

## E. Back-office sidebar
- Investigation: the desktop sidebar was `position: fixed; height: 100%` - in a real window it always filled the
  window and stayed put. The owner's screenshot is a full-page capture: the browser renders a fixed element once, at
  the window's size (768 px), so below it the page background showed. Inside, all 6 groups were open by default
  (the menu was 1469 px tall in a 589 px area at 1366x768), so it scrolled internally and looked cut after
  "สินค้า & คลังสินค้า".
- Now (`components/layout/Sidebar.tsx`, `(main)/layout.tsx`):
  - the sidebar is a column of the page row (240 px / 64 px rail) as tall as the page (background + border run down
    the whole page, also in a full-page capture); inside, a panel `sticky top-0 h-dvh` fills the window, stays in
    place while the page scrolls, and pins the user box / version / ออกจากระบบ at its bottom. The row uses
    `overflow-x: clip` (not hidden) so it is no scroll container and sticky follows the window. A full-page capture
    still shows the panel where the window is (top), with the column continuing below - a capture cannot show a
    window-fixed panel along the whole page; in a real window it is always beside what you see.
  - Accordion: only the current page's group is open by default (sub pages too, e.g. `/reports/sales` opens
    ภาพรวม & รายงาน and the รายงาน submenu); others are closed. The user's opens / closes are remembered per device
    (`localStorage purim_sidebar_groups`, try/catch, in `sidebar-store.ts`); a remembered "closed" never hides the
    page being opened (that group re-opens on navigation, the user may close it again).
  - Compact: header 56 px, POS button one line (the "ขายสด" tag that overlapped the label was dropped), items /
    headers 4-6 px vertical padding, 4 px between groups. 1366x768: whole menu with the current group open fits
    (nav area 615 px, no scrolling); 1920x1080 likewise.
  - Still too short (e.g. 1093x614 on a report page with the 6 report links open): the nav area scrolls, a fade +
    "เลื่อนดูเมนูเพิ่ม" chip shows at the bottom (fade at the top once scrolled), and the current page's link
    (`aria-current="page"`) is scrolled into view.
  - Collapsed rail (Ctrl+B) unchanged, inside the same sticky panel.

## Screenshots
`/tmp/.../scratchpad/round-start2/` (before-* / after-*): dashboard viewport, scrolled to the bottom and full page at
1366x768 / 1093x614 (+1920x1080 viewport), collapsed rail, sidebar on /reports/sales and /users, the cashier-only
chooser (before: straight to the POS), the debt payment dialog before / after choosing a shift.
