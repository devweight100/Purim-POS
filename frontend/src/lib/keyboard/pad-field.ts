/**
 * Keyboard digits for every dialog with a number pad / amount field (docs/product-form-bank-logos.md, part 1).
 *
 * Owner: whenever a numpad appears (quantity, price, cash received, cash count, open / close shift, cash drawer,
 * debt payment, split payment, points, claim quantity ...), digits typed on the keyboard must land in it at once,
 * without clicking it first.
 *
 * Root cause found: Base UI dialogs give the initial focus to their FIRST tabbable element (the "open numpad"
 * button of the open-shift dialog, "คืนค่าเดิม" of the item editor, a method card ...) and overrule React's
 * `autoFocus`; with the focus on a button the digits went nowhere. After a click on a banknote / "25%" / mode button
 * the focus also stays on that button.
 *
 * The fix has two parts, both central:
 * 1. `dialogInitialFocus` (used by components/ui/dialog.tsx for every dialog without its own `initialFocus`):
 *    the dialog's pad field (`data-pad-field`), else the field React already auto-focused, else Base UI's default.
 * 2. `handlePadFieldKey` (one document-level listener, components/common/PadFieldKeys.tsx): a digit / "." /
 *    Backspace typed while the focus is NOT in a field of the topmost dialog (a button inside it, the page behind,
 *    the POS scan box in the moment before the dialog took the focus) goes into that dialog's pad field and moves the
 *    focus there. Fields of the dialog keep their own keys; the dialogs with their own pads (NumpadPopup, PinPad)
 *    have no pad field and handle the keys themselves.
 *
 * The listener runs in the document capture phase, i.e. after the POS scanner detector (window capture), and
 * registers the field it typed into with the detector, so a scan never leaves its digits there.
 */
import { readPadKey, type PadKeyEvent } from './pad-keys';
import { editableField, setFieldValue, subscribeBurstAware } from '../pos/scan-burst';

/** Marks the main number field of a dialog (the one keyboard digits go to). */
export const PAD_FIELD_ATTR = 'data-pad-field';
/** Spread on the input: `<Input {...padField} ... />`. */
export const padField = { [PAD_FIELD_ATTR]: '' } as const;
/** A part of a dialog whose number keys mean something else (e.g. "1-3 = choose the bank account"). */
export const OWN_DIGITS_ATTR = 'data-own-digits';

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

const isOpenDialog = (el: Element) => !el.hasAttribute('data-closed') && !el.hasAttribute('data-ending-style') && (el as HTMLElement).isConnected;

/** The dialog the user sees on top (the last open one in document order: portals are appended as they open). */
export function topmostDialog(doc: Document = document): HTMLElement | null {
  const all = Array.from(doc.querySelectorAll<HTMLElement>(DIALOG_SELECTOR)).filter(isOpenDialog);
  return all.length ? all[all.length - 1] : null;
}

/** The dialog's pad field (enabled, not read-only), or null. */
export function padFieldOf(dialog: ParentNode | null | undefined): HTMLInputElement | HTMLTextAreaElement | null {
  if (!dialog) return null;
  const el = dialog.querySelector<HTMLInputElement>(`[${PAD_FIELD_ATTR}]`);
  if (!el || el.disabled || el.readOnly) return null;
  return editableField(el);
}

/**
 * Initial focus of a dialog (Base UI `initialFocus` function form, `popup` = the dialog element): its pad field,
 * else an editable field inside it that already has the focus (React `autoFocus` ran on mount), else `true`
 * (Base UI's default: the first tabbable element).
 */
export function dialogInitialFocus(popup: HTMLElement | null): HTMLElement | true {
  if (!popup) return true;
  const pad = padFieldOf(popup);
  if (pad) return pad;
  const active = popup.ownerDocument.activeElement as HTMLElement | null;
  if (active && popup.contains(active) && (editableField(active) || active.tagName === 'SELECT')) return active;
  const marked = popup.querySelector<HTMLElement>('[data-autofocus]');
  return marked || true;
}

const isTypingTarget = (el: Element | null) =>
  !!el && (!!editableField(el) || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);

/** The field a redirected key last typed into and its value before that key (for the scanner detector). */
let redirected: { el: HTMLInputElement | HTMLTextAreaElement; value: string } | null = null;
let burstAwareInstalled = false;
function ensureBurstAware() {
  if (burstAwareInstalled) return;
  burstAwareInstalled = true;
  subscribeBurstAware({
    snapshot: () => {
      if (redirected?.el.isConnected) redirected = { el: redirected.el, value: redirected.el.value };
    },
    restore: () => {
      if (redirected?.el.isConnected) setFieldValue(redirected.el, redirected.value);
    },
  });
}

export interface PadFieldKeyEvent extends PadKeyEvent {
  defaultPrevented?: boolean;
  preventDefault: () => void;
}

/**
 * One keydown: sends a digit / "." / Backspace to the topmost dialog's pad field when the focus is not in a field of
 * that dialog. Returns true when it took the key. The first digit replaces the field's value (like the on-screen
 * numpads: the shown amount is a suggestion), Backspace removes the last character.
 */
export function handlePadFieldKey(e: PadFieldKeyEvent, doc: Document = document): boolean {
  if (e.defaultPrevented) return false;
  const k = readPadKey(e);
  if (!k || (k.kind !== 'digit' && k.kind !== 'dot' && k.kind !== 'back')) return false;
  const top = topmostDialog(doc);
  const field = padFieldOf(top);
  if (!top || !field) return false;
  const active = doc.activeElement;
  if (active === field) return false;
  if (active && top.contains(active)) {
    // the dialog's own fields keep their keys; so does a part that uses number keys itself
    if (isTypingTarget(active)) return false;
    if ((active as HTMLElement).closest?.(`[${OWN_DIGITS_ATTR}]`)) return false;
  }
  ensureBurstAware();
  const before = field.value;
  redirected = { el: field, value: before };
  if (k.kind === 'dot') {
    // a number input cannot hold "0." as a value: let the browser type the dot into the focused field
    field.focus({ preventScroll: true });
    return true;
  }
  e.preventDefault();
  const next = k.kind === 'digit' ? k.digit : before.slice(0, -1);
  setFieldValue(field, next);
  field.focus({ preventScroll: true });
  return true;
}
