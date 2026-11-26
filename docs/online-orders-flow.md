# Online orders: full-screen window + step flow (owner request 2026-11-26)

Owner (translated): open an online order as a full window (now every click scrolls the page a long way); order the
buttons; updating the status is confusing, many buttons, unclear what to do after accepting. Show the buttons in
order (รับงาน, จัดของ, จัดเสร็จ, กำลังส่ง) one at a time; taking the payment can happen in any status, keep it shown.

## Plan / progress
1. [x] BEFORE screenshots (scratchpad `online-orders-flow/before-*`).
2. [x] Pure step logic `frontend/src/lib/online-order-steps.ts` (+ vitest).
3. [ ] Full-screen detail window, step indicator, one primary button, fixed รับเงิน slot, secondary area.
4. [ ] List rows: next step text.
5. [ ] POS held-bills sheet: same step text.
6. [ ] Playwright: update 15 / 16 / 18, new spec for the full-screen + keyboard path.
7. [ ] AFTER screenshots, checks, PROJECT_STATUS.
