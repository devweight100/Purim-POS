# POS member picker + history customer name (owner request 2026-11-27)

Progress / decisions file for the round "history shows the member, member picker after payment, address in the
member list".

## Owner request (translated)
1. The sales history opened from the POS (ประวัติ, Ctrl+H) does not show the customer name although a member was
   selected; it must show the member's name.
2. Member picker: (a) a setting whether the member picker pops up and waits after every completed payment;
   (b) show the customer's address in the member list, and make the picker a bit larger so it is tidy.

## Plan / status
- [ ] 1. root cause + fix of the history name (list, detail, reprint, repeat order; back office checked)
- [ ] 2. setting "เปิดหน้าเลือกสมาชิกรอไว้หลังรับชำระเงิน" (default off) + auto-open + scan while open
- [ ] 3. picker: address in the rows, larger dialog, address search
- [ ] tests (Playwright, vitest), full verification, screenshots before / after
