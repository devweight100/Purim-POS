/**
 * Global barcode-scanner detection of the POS page (docs/pos-keyboard-scan.md).
 *
 * USB scanners act as keyboards: they type the code very fast and end it with Enter (or Tab). On the POS page a
 * burst like that is recognised wherever the focus is (customer search, quantity, note, a numpad / PIN pad, a
 * button ...): the code goes to the add-to-cart flow, the characters it typed are taken out of the field again and
 * its Enter never reaches the field / dialog (it must not submit anything). Human typing is never that fast for
 * SCAN_MIN_LENGTH keys in a row plus Enter, so it is not affected.
 */

/** Max ms between two characters of a scanner burst (people need ~100 ms or more per key). */
export const SCAN_MAX_KEY_GAP_MS = 35;
/** Shortest code that counts as a scan (shorter fast runs are left alone). */
export const SCAN_MIN_LENGTH = 4;
/** Max ms between the last character and the Enter / Tab that ends the code. */
export const SCAN_TERMINATOR_MAX_GAP_MS = 60;
/**
 * Older rule, kept unchanged for the case "focus on no field and no dialog open" (the page used to accept that
 * since v1.x): characters at most this far apart ...
 */
export const LEGACY_SCAN_MAX_KEY_GAP_MS = 200;
/** ... and at least this many of them. */
export const LEGACY_SCAN_MIN_LENGTH = 2;

/** Keys a scanner may press around the characters without breaking the burst (Shift for capitals). */
const NEUTRAL_KEYS = new Set(['Shift', 'CapsLock', 'NumLock', 'Unidentified', 'Dead']);

export interface BurstKey {
  key: string;
  /** event time in ms (performance.now() / event.timeStamp) */
  time: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

export type BurstStep =
  /** nothing to do */
  | { kind: 'none' }
  /** a printable character; `runStart`: it may be the first character of a scanner burst (snapshot the field now) */
  | { kind: 'char'; runStart: boolean }
  /**
   * Enter / Tab that ends a code. `strict`: a real scanner burst (SCAN_* rules, works in any field);
   * otherwise only the legacy rule matched (fine for "nothing focused", not inside a field or dialog).
   */
  | { kind: 'end'; code: string; strict: boolean };

/** Pure keystroke-timing state machine (tested in lib/__tests__/scan-burst.test.ts). */
export class ScanBurstDetector {
  /** the characters since the last gap > SCAN_MAX_KEY_GAP_MS */
  private run = '';
  /** the characters since the last gap > LEGACY_SCAN_MAX_KEY_GAP_MS */
  private legacy = '';
  private lastAt = Number.NEGATIVE_INFINITY;

  reset() {
    this.run = '';
    this.legacy = '';
    this.lastAt = Number.NEGATIVE_INFINITY;
  }

  step(e: BurstKey): BurstStep {
    if (e.isComposing) {
      this.reset();
      return { kind: 'none' };
    }
    if (NEUTRAL_KEYS.has(e.key)) return { kind: 'none' };
    if (e.ctrlKey || e.altKey || e.metaKey) {
      this.reset();
      return { kind: 'none' };
    }
    const gap = e.time - this.lastAt;
    if (e.key === 'Enter' || e.key === 'Tab') {
      const run = this.run;
      const legacy = this.legacy;
      this.reset();
      if (run.length >= SCAN_MIN_LENGTH && gap <= SCAN_TERMINATOR_MAX_GAP_MS) return { kind: 'end', code: run, strict: true };
      if (legacy.trim().length >= LEGACY_SCAN_MIN_LENGTH && gap <= LEGACY_SCAN_MAX_KEY_GAP_MS) return { kind: 'end', code: legacy, strict: false };
      return { kind: 'none' };
    }
    if (e.key.length !== 1) {
      // arrows, Backspace, F-keys ...: a person is editing
      this.reset();
      return { kind: 'none' };
    }
    this.lastAt = e.time;
    const runStart = !(gap <= SCAN_MAX_KEY_GAP_MS) || this.run === '';
    this.run = runStart ? e.key : this.run + e.key;
    this.legacy = gap <= LEGACY_SCAN_MAX_KEY_GAP_MS && this.legacy !== '' ? this.legacy + e.key : e.key;
    return { kind: 'char', runStart };
  }
}

// ── components that keep typed keys in their own state (numpad, PIN pad) ──

export interface BurstAware {
  /** remember the current value (a burst may be starting) */
  snapshot: () => void;
  /** a burst ended: go back to the remembered value */
  restore: () => void;
}
const aware = new Set<BurstAware>();

/** Register a numpad / PIN pad whose typed digits a scanner burst must not leave behind. */
export function subscribeBurstAware(a: BurstAware): () => void {
  aware.add(a);
  return () => {
    aware.delete(a);
  };
}
export const snapshotBurstAware = () => aware.forEach((a) => a.snapshot());
export const restoreBurstAware = () => aware.forEach((a) => a.restore());

// ── fields ──

/** A field meant for barcodes keeps its own behaviour (the POS scan box, a barcode field of a form). */
export const BARCODE_INPUT_ATTR = 'data-barcode-input';

export function isBarcodeField(el: Element | null): boolean {
  return !!el?.closest?.(`[${BARCODE_INPUT_ATTR}]`);
}

export type EditableField = HTMLInputElement | HTMLTextAreaElement;

export function editableField(el: Element | null): EditableField | null {
  if (!el) return null;
  if (el.tagName === 'TEXTAREA') return el as HTMLTextAreaElement;
  if (el.tagName === 'INPUT') {
    const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'hidden'].includes(t)) return null;
    return el as HTMLInputElement;
  }
  return null;
}

/**
 * Put a value back into a (React-controlled) field: the native setter + an input event, so React's onChange runs
 * with the old value and the component state follows.
 */
export function setFieldValue(el: EditableField, value: string) {
  if (el.value === value) return;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── the scan box ("standby": where the focus goes after a sale) ──

let scanBox: HTMLInputElement | null = null;

/** The POS layout registers its scan box (hidden scanner input); returns the unregister function. */
export function registerScanBox(el: HTMLInputElement | null): () => void {
  scanBox = el;
  return () => {
    if (scanBox === el) scanBox = null;
  };
}
export const currentScanBox = () => (scanBox && scanBox.isConnected ? scanBox : null);

/** Back to standby: focus the scan box (no-op when the POS is not on screen). */
export function focusScanBox(): boolean {
  const el = currentScanBox();
  if (!el) return false;
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}

// ── the payment dialog (scans are not added while it is open) ──

let paymentOpenCount = 0;
/** PaymentModal calls this while it is open (any instance: POS or a payment edit from the sales history). */
export function markPaymentOpen(): () => void {
  paymentOpenCount++;
  return () => {
    paymentOpenCount = Math.max(0, paymentOpenCount - 1);
  };
}
export const isPaymentOpen = () => paymentOpenCount > 0;

export const PAYMENT_OPEN_SCAN_NOTICE = 'ปิดหน้ารับเงินก่อนสแกนสินค้า';

// ── where the scanned code goes (the layout on screen may take it over) ──

let scanHandler: ((code: string) => void) | null = null;
/** The list layout routes scans through its own add flow; returns the unregister function. */
export function registerScanHandler(fn: (code: string) => void): () => void {
  scanHandler = fn;
  return () => {
    if (scanHandler === fn) scanHandler = null;
  };
}
export const currentScanHandler = () => scanHandler;
