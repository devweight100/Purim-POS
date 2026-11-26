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
- [ ] 2 audit + defaults
- [ ] 3 bundle picker
- [ ] 4 delete with replacement
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
