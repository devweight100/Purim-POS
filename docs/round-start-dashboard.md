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
  - `?go=pos|backoffice` (used by the desktop F2) opens that option directly when allowed.
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
