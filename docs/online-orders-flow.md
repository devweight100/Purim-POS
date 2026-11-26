# Online orders: full-screen window + step flow (owner request 2026-11-26)

Owner (translated): open an online order as a full window (now every click scrolls the page a long way); order the
buttons; updating the status is confusing, many buttons, unclear what to do after accepting. Show the buttons in
order (รับงาน, จัดของ, จัดเสร็จ, กำลังส่ง) one at a time; taking the payment can happen in any status, keep it shown.

Back office "ออเดอร์ออนไลน์" (`/online-orders`). UI only: the server rules, the status machine
(`shared/src/online-shop.ts` `nextStatuses`) and the claim lock (docs/online-shop.md) are unchanged.

## What changed
- **One step rule** `frontend/src/lib/online-order-steps.ts` (`onlineOrderStep({status, fulfillment, paid})`, pure,
  vitest `online-order-steps.test.ts`): the steps (ใหม่ → รับงาน → จัดของ → จัดเสร็จ → กำลังส่ง (delivery only) →
  เสร็จ), the current step, ONE next-step action + label, the one-line hint, the list text and the state of the
  รับเงิน slot. Used by the list rows, the order window and the POS held-bills sheet.
- **Full-screen order window** (`components/online-orders/OnlineOrderDetail.tsx`, a Base UI dialog covering the
  screen): header (order no, status chip, pickup / delivery, customer + phone, order time, ปิด Esc), step bar
  (step indicator, "ตอนนี้: <hint>", claim badge "คุณกำลังจัด / กำลังจัดโดย X / ยังไม่มีใครรับจัด"), body = item table
  (scrolls on its own) + right panel (money, the รับเงิน slot, delivery address / note / member, LINE notice, staff
  alerts), footer = next-step button on the left, rare actions on the right. The page itself no longer scrolls
  when an order is opened; the list keeps its scroll and the opened row stays highlighted and focused after Esc.
- **Next step, one button** (focused, Enter does it; after each step the next one gets the focus):

  | Status | Button | Notes |
  |--------|--------|-------|
  | ใหม่ | รับงาน | delivery needs ค่าส่ง: Enter without it shows the message and puts the focus in the fee field; Enter in the fee field = รับงาน. Accepting claims the order (as before). |
  | รับแล้ว | เริ่มจัดของ | status กำลังเตรียมของ (claims). "พิมพ์ใบจัดของ" as a secondary button from here on. |
  | กำลังเตรียมของ | จัดของเสร็จ | READY, ends the claim (as before). |
  | จัดเสร็จ, delivery | ออกไปส่ง | DELIVERING. |
  | จัดเสร็จ, pickup unpaid | (none) | "ขั้นต่อไป: กด รับเงิน" and the รับเงิน button gets the focus; payment closes a pickup order (as before). |
  | จัดเสร็จ, pickup paid (rare) | ส่งมอบแล้ว | DONE. |
  | กำลังไปส่ง | ส่งเสร็จ | DONE; unpaid keeps the existing "ยังไม่ได้รับเงินในหน้าขาย" confirmation. |
  | เสร็จแล้ว / ยกเลิก | none | hint only. |

  Picking steps (รับงาน, เริ่มจัดของ, จัดของเสร็จ) stay visible but disabled while someone else holds the order, with the
  reason; hand-over steps and payment are open to every cashier (round 3 rule).
- **รับเงิน always in the same place** (right panel under the total): disabled with "รับงานก่อนจึงรับเงินได้" on a new
  order (prices / fee are agreed on accept), the open-as-POS-bill flow from รับแล้ว through กำลังไปส่ง, "ชำระแล้ว · บิล
  <no> (<amount>)" once paid. A paid delivery order still walks ออกไปส่ง → ส่งเสร็จ.
- **Rare actions** away from the step button (footer, far right): "แก้ไขรายการ" toggle (quantity / price / delete /
  add product / member; the fee field is always editable while the order is editable), and the "อื่นๆ" menu:
  รับจัดออเดอร์นี้ (claim without accepting), ปล่อยงาน, ปลดล็อก/โอนมาที่ฉัน (managers, confirmation), ปิดออเดอร์เลย
  (ข้ามขั้นตอน) (the old "เสร็จแล้ว" shortcut the server allows from รับแล้ว / จัดเสร็จ; unpaid confirmation kept), and
  after a divider ยกเลิกออเดอร์ (reason dialog, as before). Unsaved edits: closing asks first; steps refuse until saved.
- **List**: status filter tabs + search on one row; each row shows order no / time, customer · pickup or delivery ·
  items, claim badge, status chip, the next step ("→ รอรับงาน", "→ รอจัดของ", "→ กำลังจัดของ", "→ รอส่ง · ยังไม่รับเงิน",
  "→ รอรับเงิน", "→ กำลังส่ง") and the total. ↑ / ↓ move between rows, Enter opens.
- **POS held-bills sheet** (`PosOnlineOrders.tsx`): no status buttons there; each online order shows "ขั้นตอน: <list
  text>" from the same rule.

## Decisions
- PREPARING is no longer skippable from the main row (server still allows ACCEPTED → จัดของเสร็จ / DELIVERING / DONE);
  the only skip left is "ปิดออเดอร์เลย (ข้ามขั้นตอน)" in the อื่นๆ menu, for e.g. a customer who paid outside the
  POS. The picking slip is offered from รับแล้ว on (not on a new order).
- Keyboard: the window opens with the focus on the next-step button (or รับเงิน when that is the next step); a
  live update from another terminal never moves the focus out of a field; Esc that closes the อื่นๆ menu does not
  also close the window.
- Colours: step button = primary (indigo), รับเงิน = emerald (money), rare actions outline / menu.

## Tests
- vitest `online-order-steps.test.ts` (7): sequence per fulfillment / paid, list texts, payment slot, every offered
  status change is allowed by `nextStatuses`, claim-locked actions.
- Playwright: new `43-online-orders-flow.spec.ts` (2: list ↑/↓ + Enter, full-screen box at the 3 sizes, steps by
  Enter only, fee focus, Esc back to the focused row with the new next-step text, paid delivery → ออกไปส่ง → ส่งเสร็จ;
  pickup ready unpaid → รับเงิน focused, Enter opens the POS bill). Updated `15-online-shop`, `16-claim-picking`,
  `18-reason-dialogs` for the new buttons / menu.

## Screenshots
Session scratchpad `online-orders-flow/`: `before-*` (commit d584aa1) and `after-*` for list, detail-new,
detail-accepted, detail-ready-delivery, detail-paid at 1366x768, 1920x1080, 1093x614 (deviceScaleFactor 2).
