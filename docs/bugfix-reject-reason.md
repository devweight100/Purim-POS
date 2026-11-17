# Bug: cannot type the cancel reason (online orders, desktop app) — progress notes

Owner: on ออเดอร์ออนไลน์ "ยกเลิกออเดอร์" opens the reason dialog but nothing can be typed, so the order cannot be
cancelled (a reason is required). Probably in the Electron desktop app.

## Findings
- Chromium (Playwright), 1366x768 / 1920x1080 / 1093x614: typing works in every path tried (opened from the list,
  ?id=, keyboard Enter/Space on the button, unclaimed, claimed by me, accepted, after the customer / product
  pickers, unsaved fee edit, realtime events while typing). No inert / focus-trap / row-nav / remount problem.
- Electron 33 desktop app under Xvfb, real X key events (xdotool, not CDP): typing works, UNTIL the page has shown a
  native `window.confirm()` or `window.alert()` once. After that the input is focused (document.hasFocus() true,
  activeElement = #reject-reason) but no keystroke reaches it, not even after clicking into it; only re-focusing the
  OS window (alt-tab) brings the keyboard back. Main-process webContents.focus() / blur()+focus() did not restore it.
  Main-process dialog.showMessageBox (update offer) does not cause it. Known Electron issue (keyboard focus lost after
  renderer alert/confirm). `window.prompt()` throws "prompt() is not supported" in Electron.
- Online orders page itself has native confirms (เสร็จ on an unpaid order, "move bill to this terminal", LINE
  unlink) and the back office has ~12 more; any of them earlier in the session leaves the keyboard dead, and the
  reject reason is the first place where typing is mandatory.

## Plan
1. Shared in-page dialogs: `ReasonDialog` (+ `askReason()` / `askConfirm()` through one host in Providers).
2. Replace every window.prompt / window.confirm / window.alert in the back office + POS; eslint rule forbids them.
3. Playwright: reject with a typed reason, link request reject, finance/payables/debts reason, nested dialog typing,
   no native dialog event anywhere in those flows; layout at 3 sizes.

## Fix
- `components/common/ReasonDialog.tsx`: shared in-page reason dialog (focus in the field with the default text
  selected, Enter confirms, Escape closes only this dialog, confirm disabled while blank when required, fresh field
  each time, Enter does not bubble to row-nav lists / outer dialogs through the React portal).
- `lib/ask-dialog.ts` + `components/common/AskDialogHost.tsx` (mounted in Providers): `await askReason({...})`
  (string | null) and `await askConfirm({...})` (boolean) for the call sites that used prompt / confirm inline.
- Replaced every native dialog in the back office / POS: prompts in LinkRequests (reject link, default text kept,
  may be blank as before), RecurringPanel (skip), finance page (cancel ledger row, cancel expense), payables (cancel
  voucher: confirm + prompt merged into one dialog with the same warning text and default reason; cancel bill),
  debts (cancel payment receipt, opened over the history dialog); the online-order reject dialog now uses
  ReasonDialog. Confirms: online order "เสร็จแล้ว" unpaid, move bill to this terminal (fetchPosPayload), LINE
  unlink, LINE token delete, bulk product delete, customer delete, supplier duplicate / delete, supplier return
  cancel / restore, bank account delete, payable rollback (page + bill detail). Same API calls and validation.
- eslint `no-restricted-globals` / `no-restricted-properties` forbid prompt / confirm / alert in `src/` (the
  customer shop `src/app/shop/**` keeps its one confirm: phones, not the desktop app).
- Desktop app untouched (the web UI is served by the server, so installed desktop clients get the fix).

## Verified
- Electron (real X keys): "เสร็จแล้ว" -> in-page confirm, real Escape closes it, reject reason typed with real keys,
  Enter cancels the order with the reason; no native dialog.
- e2e/18-reason-dialogs.spec.ts (5 tests, fail on any native dialog), src/lib/ask-dialog.test.ts.

## Done / next
- [x] reproduced (scratchpad scripts rsn/x2.js, rsn/e.js)
- [x] fix + tests
- [ ] full verification, PROJECT_STATUS
