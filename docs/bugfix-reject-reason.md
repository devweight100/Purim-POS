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

## Done / next
- [x] reproduced (scratchpad scripts rsn/x2.js, rsn/e.js)
