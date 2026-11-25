# POS keyboard + scanner (owner bugs 2026-11-25)

Progress / decisions file for the round "PIN pad by keyboard, standby after payment, global scanner detector,
Enter submits POS dialogs". Updated with every step.

## Owner reports
1. The PIN numpad shown when claiming products (เคลมสินค้า -> manager approval at payment) works only by clicking.
2. After a payment the POS must return to standby (focus on the scan box); a scan must be recognised wherever the
   focus is on the POS page, without leaving the scanned characters in that other field.
3. Enter in any POS form / dialog = its primary action.

## Plan / status
- [x] `lib/keyboard/pad-keys.ts`: one key map for PIN pads + numpad (digits by physical key, so the main row works in
      the Thai layout too; Backspace, Delete, Enter, Escape; IME / Ctrl / Alt ignored).
- [x] `lib/pos/scan-burst.ts` + `lib/pos/use-pos-scan-burst.ts`: global scanner detector on the POS page only.
- [ ] shared `components/common/PinPad.tsx` used by every PIN dialog.
- [ ] standby after payment.
- [ ] Enter submits every POS dialog (`lib/keyboard/enter-submit.ts`).
- [ ] tests (vitest + Playwright), screenshots, full verification.
