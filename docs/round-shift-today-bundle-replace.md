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
- [ ] 1 fix + backend e2e + Playwright
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
