# POS keyboard + scanner (owner bugs 2026-11-25)

Progress / decisions file for the round "PIN pad by keyboard, standby after payment, global scanner detector,
Enter submits POS dialogs". Keyboard-first shop; USB barcode scanners act as keyboards (fast keys + Enter).

## Owner reports
1. The PIN numpad shown when claiming products (เคลมสินค้า -> discount over the cashier's limit -> manager approval
   at payment) works only by clicking.
2. After a payment the POS must return to standby (focus on the scan box); a scan must be recognised wherever the
   focus is on the POS page, without leaving the scanned characters in that other field.
3. Enter in any POS form / dialog = its primary action.

## Root causes
1. `ApprovalDialog` (manager PIN: payment / claim / cash drawer) was 10 `<Button>`s and dots, with no key handling
   at all; Base UI put the focus on the first button "1" (reproduced on ea429f3: typing 7391 + Enter left the PIN
   empty, screenshot `before-approval-pin-typed-1366.png`). The export PIN dialog had a plain input (keyboard ok, but
   the main-row digits do not type digits while the Thai layout is active).
2. Standby: nothing put the focus back on the scan box when the payment dialog closed (Base UI returned it to the
   element that opened the dialog: the "ชำระเงิน" button, the note field ... or nowhere: `BODY` on ea429f3). In a
   browser the receipt is printed from a hidden iframe ~1-2 s after the sale and `print()` needs the frame focused:
   the focus then **stayed in the hidden frame**, so every later keystroke / scan went nowhere (found by the new e2e
   test). Scans: the old global listener (`useGlobalBarcodeScanner`) ignored every key typed while an input / textarea
   had the focus, so a scan in the customer search / note / quantity field typed the code into that field (and its
   Enter picked a member / confirmed a dialog).
3. Enter: many POS dialogs had no Enter handling (cash drawer, close shift, customer pick, claim quantity, void
   reason, ฿0 bill, QR / split / credit confirm, success screen, redeem points, debt payment ...); a few had it on
   one field only, without IME / auto-repeat guards.

Found while testing (fixed too):
- `NumpadPopup` handled digits on `window` but did not `preventDefault` them: a digit typed right after F2 / F4, before
  the dialog had the focus, also landed in the hidden scan box and made the next scan "ไม่พบสินค้าบาร์โค้ด 1885…".
  The numpad now consumes its keys, and both scan boxes drop leftover text when they lose the focus.
- The PIN field gets the focus a frame after the dialog opens; a PIN typed at once lost its first digit. The PinPad
  now also takes digit / Backspace / Delete keys that arrive while the focus is elsewhere (not in another field of
  its own dialog) and moves the focus into the PIN field.

## What was built
- `frontend/src/lib/keyboard/pad-keys.ts`: one key map for every number pad. Digits come from the physical key
  (`KeyboardEvent.code` Digit0-9 / Numpad0-9), so the main row works in the Thai layout too; Backspace, Delete
  (clear), Enter / NumpadEnter, Escape; Ctrl / Alt / Cmd combinations and IME composition are never pad keys.
- `frontend/src/components/common/PinPad.tsx`: **the one PIN pad** (masked numeric field + 12 on-screen keys that
  never take the focus). Used by `ApprovalDialog` (payment approvals incl. claims, cash drawer approvals) and the
  data-export PIN dialog (`ExportPinHost`). Focus on open (initialFocus), Enter = approve, Esc = cancel (only the
  PIN dialog closes, the payment stays), Backspace / Delete, paste keeps digits only, busy guard (one request).
  `NumpadPopup` (qty / price / amount / cash counting) uses the same key map.
- `frontend/src/lib/keyboard/enter-submit.ts`: `shouldSubmitOnEnter` + `useEnterSubmit` / `enterSubmitHandler`.
  Enter submits from a text / number field, a select or the dialog body; not during IME composition (keyCode 229),
  not on auto-repeat, not when a field already handled it (defaultPrevented); a textarea needs Ctrl+Enter; buttons,
  links, options, checkboxes and `[data-own-enter]` keep their own Enter (it presses that element); a promise
  returned by the action blocks further Enters until it settles (no double submit); keys coming from a nested
  dialog (React portal) are ignored.
- `frontend/src/lib/pos/scan-burst.ts` + `use-pos-scan-burst.ts`: the global scanner detector, **POS page only**
  (registered in `usePosController`, window capture phase, so it sees keys before fields, dialogs and the numpad).
  Constants (tested): `SCAN_MAX_KEY_GAP_MS = 35`, `SCAN_MIN_LENGTH = 4`, `SCAN_TERMINATOR_MAX_GAP_MS = 60`
  (Enter / Tab). On a burst: the Enter / Tab is stopped (it submits / picks / moves nothing), the field the burst
  started in gets its previous value back (native setter + input event, so React state follows), numpads / PIN
  pads restore their value (`subscribeBurstAware`), and the code goes to the add-to-cart flow (`processDetectedScan`
  -> `addToCart` in `lib/pos/pos-add.ts`, so the no-price popup and the start-of-bill dialog still apply; the list
  layout routes it through its own add flow via `registerScanHandler`). The focus stays where the cashier was.
- Standby: `PaymentModal` takes `finalFocus` (the POS passes its scan box), `usePaymentClosedStandby` focuses the
  scan box after the dialog closed (0 / 120 / 400 ms) and rescues a lost focus (body / print iframe) at 1.5 s and
  3 s; `printIframeOnce` gives the focus back after `print()`. Both layouts register their hidden scanner input
  as the scan box (`registerScanBox`).

## Decisions
- **Payment dialog open**: a scan adds nothing; toast "ปิดหน้ารับเงินก่อนสแกนสินค้า" (one at a time), the field it
  landed in (e.g. cash received) is restored and the scanner's Enter does not confirm the payment. Applies to every
  PaymentModal instance (also the payment edit from the sales history).
- **Barcode fields keep their own behaviour**: the hidden scanner input of both layouts is marked
  `data-barcode-input`. The product search boxes are *not* marked: a burst there restores what the cashier had typed
  and adds the scanned item (better than the old "add the first search result of text+code").
- Back-office forms (product barcode fields etc.) are untouched: the detector exists only on the POS page.
- **Legacy rule kept** for "no field focused and no dialog open": up to 200 ms between keys, >= 2 characters (the
  old global listener's rule), so nothing that used to scan stops scanning. Inside a field or with a dialog open only
  the strict rule counts, so a person typing a code + Enter in a field is never treated as a scan.
- Playwright `keyboard.type()` without a delay types like a scanner: spec 29 (start-of-bill member search, 12 keys at
  0 ms then Enter) now types at a person's speed (60 ms per key).
- A person who types and then scans within 35 ms of their last key joins the burst; the field then goes back to its
  value before that key (accepted: not humanly realistic).
- Customer pick (Ctrl+M): ↑/↓ moves a highlight, Enter picks it once something was typed or the highlight was moved
  (Enter on an untouched empty search does nothing: avoids picking a random member). Quick add form: Enter = save.
- Confirm-only dialogs (repeat order, edit bill items, refund claim) open with the focus on their primary button:
  Enter presses it, Esc cancels.
- There is no hold-bill name dialog in the POS (F10 / Ctrl+P hold without a name), nothing to change there.
  Cancel reason dialogs (`askReason` / `ReasonDialog`) already submitted on Enter.

## Dialogs checked / fixed (Enter = primary action)
| Dialog | Before | Now |
| --- | --- | --- |
| Manager approval PIN (payment, claim, cash drawer) | mouse only | PinPad: keys, Enter, Esc, focus |
| Export PIN (back office) | input, main row needed English layout | PinPad (same) |
| Qty / price / cash numpads (F2 / F4 / payment / shift) | Enter ok | shared key map, no repeat confirm, scan-safe |
| Start of bill | Enter ok | + IME / repeat guard |
| Open shift / count cash | Enter in some fields | Enter anywhere |
| Close shift | none | Enter = ปิดกะ (disabled while the count is invalid) |
| Cash drawer (F9) | none | Enter = บันทึก (validation toasts as the button) |
| Item edit (F3) / bill discount | Enter in the discount field only | Enter anywhere, not with an invalid value |
| Item note | Enter (no IME guard) | shared rule |
| Claim quantity (เคลม) | none, no focus | focus on qty, Enter = บันทึกสินค้าเคลม |
| Claim refund confirm | none | focus on confirm |
| Customer pick (Ctrl+M) + quick add | none | ↑/↓ + Enter; Enter = save |
| Payment: cash | Enter ok | + IME / repeat guard |
| Payment: QR / split / credit / ฿0 bill / success | none | Enter = confirm / close |
| Debt payment (POS + back office) | none | Enter = ยืนยันรับชำระ |
| Redeem points | none | Enter = ใช้แต้ม |
| Void reason (history) / repeat / edit confirm | none | Enter = confirm / focus on primary |
| Ask reason / confirm (`askReason`, `askConfirm`) | ok | unchanged |
| Unit picker / method cards | buttons | unchanged (Enter presses the focused one) |

Also fixed: clicking inside the bill-discount dialog moved the focus to the hidden scanner input (the dialog was not
in `focusClickBlocked`).

## Status
- [x] pad keys, PinPad, ApprovalDialog, ExportPinHost, NumpadPopup
- [x] scanner detector + routing + payment notice
- [x] standby after payment (+ print iframe focus)
- [x] Enter in POS dialogs
- [x] vitest: `scan-burst.test.ts`, `pad-keys.test.ts` (key map, PIN editing, Enter rule), `pin-pad.test.tsx`
- [x] Playwright `32-pos-keyboard-scan.spec.ts`
- [x] full verification

## Verification (2026-11-25)
| Check | Result |
| --- | --- |
| backend `tsc --noEmit` | ok |
| backend jest | 187 / 187 |
| backend e2e (fresh DB) | 133 / 133 |
| frontend `tsc --noEmit` | ok |
| frontend eslint | 0 errors (99 warnings, as before) |
| frontend vitest | 343 / 343 (new: scan-burst 10, pad-keys + Enter rule 10, pin-pad 2) |
| frontend `next build` | ok |
| Playwright full suite (fresh DB) | 129 / 129 (new `32-pos-keyboard-scan` 6; `29` types at human speed) |
| desktop `npm test` + `node --check *.js` | 13 / 13, ok (desktop untouched) |
| no horizontal scroll, PIN dialog 1366x768 / 1920x1080 / 1093x614 | 0 px (spec 32 + screenshots) |

Reproduced on ea429f3 (screenshot script, keyboard only): PIN dialog focus on button "1", typing 7391 + Enter left the
PIN empty; focus after the sale = BODY. After: focus in the PIN field, approved by keyboard, focus after the sale =
the scan box, next scan added. Screenshots (deviceScaleFactor 2, before / after) in the session scratchpad
`pos-kbd/`.

## Desktop client
No desktop change needed: the POS pages are served by the server, the Electron client only loads them; it has no
scanner / keyboard handling of its own besides the menu accelerators (Ctrl+Shift+...) and F11, which do not touch
digits / Enter / Tab. Its silent print uses hidden windows (no focus steal); the iframe focus fix is for browsers.
