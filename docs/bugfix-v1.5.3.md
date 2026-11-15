# Bug fixes for v1.5.3 (tester report)

Branch `ccr-8f8b0741-si1a0o`. Order: 01, 02, 03, 04, 05, 06, 12, 10. (07/08/09/11 = another agent.)
Status per bug: reproduced? / real cause / fix / files / test.

## Progress
- BUG-01: DONE. Files: frontend/src/components/pos/PaymentModal.tsx, src/lib/order-sync-service.ts, src/lib/offline-db.ts.
  Tests: e2e/12-tester-v153.spec.ts (BUG-01 x2: 1093x614 typing + Enter, 1366/1920 banknote + Enter, stock 24->22), vitest src/lib/__tests__/checkout-no-hang.test.ts.
- BUG-02: DONE. Files: frontend/src/components/common/ClientDbSync.tsx (SSE realtime refresh, throttled),
  src/lib/store/product-store.ts (refresh asked during a load runs again after it), src/components/pos/classic/
  ClassicProductPanel.tsx (stock badge always shown). Test: e2e/12 "BUG-02" (adjust elsewhere -> card within 6 s,
  sale lowers card and server equally, new window same number).
- BUG-03: DONE. Files: desktop/main.js + preload.js (terminal id kept in the app config, sync IPC; page storage
  flushed every 10 s / on close / before quit), frontend/src/lib/terminal-id.ts (desktop copy wins, existing id handed
  over on upgrade), src/lib/api.ts + src/components/pos/OpenShiftModal.tsx (banner "ใช้กะนี้ต่อที่เครื่องนี้"),
  backend shifts.service/controller/module + server-control.service (GET /shifts/mine-elsewhere). Tests: backend e2e
  "BUG-03" (store-flow, 66/66), Playwright e2e/12 "BUG-03" (storage lost -> continue same shift, ฿700, reload keeps
  it), Electron scratch run: SIGKILL right after opening the shift -> relaunch: same terminal id, no count prompt.
  (OpenShiftModal also carries the BUG-04 keyboard change, committed with it.)
- BUG-04: DONE. Cause: the note/coin count inputs of the open-shift and close-shift count screens were readOnly
  (click = numpad only); the total field opened the numpad on any click. Fix: OpenShiftModal.tsx + CountCashModal.tsx
  inputs editable (inputMode numeric, aria-label "จำนวน แบงค์ 500 ฿"...), Tab between them, Enter = ตกลง, the note
  picture / calculator icon still opens the numpad (touch). Payment cash amount: typed + Enter (BUG-01).
  Close-shift "เงินสดที่นับได้" was already a normal input. Test: e2e/12 "BUG-04" (open 1x500 + 2x100 by keyboard,
  close-shift count by keyboard -> 700, "พอดี").
- BUG-05..BUG-10: investigated (findings below), not fixed yet.
- Final verification: not run yet.

## Findings so far (WIP)

Tooling: scratchpad scripts (Playwright in Chromium and the real Electron desktop app via `_electron` + Xvfb).
Note: `pkill -f "next start"` does not kill `next-server` (process renames itself) - kill both before restarting.

### BUG-01 (cash confirm pale / does nothing)
- Straight flow (browser and Electron desktop, admin and cashier, fresh install + UI reset path): sale WORKS at
  1366x768 and 1920x1080. Not reproduced there.
- Reproduced on a short window: 1093x614 CSS px (= 1366x768 with Windows display scaling 125%, also any small
  window): the cash step is taller than the dialog (h-90dvh, overflow-y-auto), the footer with "ยืนยันรับเงินสด"
  is cut by the dialog edge: what shows is a pale strip, a click on most of it hits the dialog backdrop (nothing
  happens, no message), Enter does nothing (no Enter handling; focus on a banknote button re-clicks it).
- Other silent paths found: errors only as a 2 s toast at bottom-right (over the button); `isSubmitting` stays true
  forever if the outbox lock (navigator.locks) or IndexedDB open never answers -> button disabled with no message.
- Fix: sticky footer always inside the dialog; amount field is a real input (type digits, Enter confirms, says
  "ขาดอีก ฿x"); inline error in the dialog; no-shift check with a clear message; outbox lock wait limited to 20 s
  and IndexedDB open to 8 s (error instead of hang; work already started is never cut short). Enter anywhere on the
  cash screen confirms (capture handler; before, Enter on the focused ฿50 button added another ฿50).

### BUG-02 (POS tile "เหลือ 0" after +24)
- POS tile shows stock ONLY when <= low-stock threshold (red "เหลือ N"); with 24 it shows nothing ("unknown").
- Reproduced: POS open while stock adjusted elsewhere: tile keeps "เหลือ 0" until the next 15 s poll
  (ClientDbSync). Navigation POS<->inventory refreshes correctly (delta sync + triggers are correct).
- The backend already emits SSE change events (/api/events/stream, works through the Next rewrite) but the
  frontend never connects (startRealtime imported, never called). fetchProducts() also returns immediately when a
  load is running (a refresh request during a load is lost, e.g. right after a sale).
- Server note: PrismaService re-emits every entity written in the last 6 s on EVERY COMMIT (also read-only
  transactions like /products/sync and /shifts/current) -> a client refreshing on events loops for ~6 s (and
  forever for 'shift', since reading the current shift commits). Client: no refresh on 'shift' events, refreshes
  of one kind >= 2 s apart. Server not changed (worth a follow-up: emit only on commits of writing transactions).
- After "ล้างข้อมูลทั้งหมด" (TRUNCATE, no triggers) a client with an old delta cursor keeps deleted products until
  F5 (settings page reloads itself; other terminals are told to press F5).

### BUG-03 (shift asked again after restart)
- Shift is kept in DB (OPEN) keyed by user + terminalId; terminalId lives only in the page's localStorage.
- Reproduced in Electron: app ended without a clean shutdown (SIGKILL ~ crash / power off / Task Manager / Windows
  shutdown): localStorage of that session lost -> new terminal id (and logged out) -> server correctly says "no
  open shift for this terminal" -> count prompt; old shift stays OPEN orphaned. Clean close keeps it (Linux).
- Fix: desktop keeps a durable terminal id in its config + flushStorageData; web offers to continue the user's open
  shift left on a lost terminal id (refused when that terminal sent a heartbeat in the last 60 s from ANOTHER IP =
  another live device; same IP = this machine before its restart). Old desktop apps (no getTerminalId) still get
  the banner path.

### BUG-04: confirmed in code: OpenShiftModal count inputs are readOnly (only click opens numpad).
### BUG-05: confirmed: DB correct (cost_price 12, stock batch unit_cost 12, audit costValue 288); products list /
  inventory show ฿20 = display mapping (inventory dialog even labels basePrice as "ต้นทุนฐาน").
### BUG-06: confirmed: useProductForm never sends supplierEntries; productToForm sets supplierEntries: [].
### BUG-10: confirmed: openAdjustDialog / type buttons preset a reason.
### BUG-12: mechanism found: the method cards sit where "ย้อนกลับ" was (1280x720, 1093x614: back button centre is
  inside the "แบ่งชำระ" card) -> double click on ย้อนกลับ opens Split. Escape closes only the topmost dialog (ok).
  Guard added (method click ignored 600 ms after going back).


## Test setup
Fresh DB `bug_test_*` on localhost:5433 seeded by `backend/scripts/prepare-database.js`, then via the UI/API:
supplier "บริษัททดสอบ จำกัด", bank account 000-0-00000-0, product "น้ำดื่มทดสอบ 600 มล." price 20 cost 12,
stock 0 -> 24 via inventory "ปรับยอด" with reason "ปรับยอดเริ่มต้น".

## Notes for BUG-07/08/09/11 (other agent)
- Product form labels were not tied to inputs; added aria-labels on name, prices, supplier rows, reference cost.
