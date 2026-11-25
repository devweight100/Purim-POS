/**
 * One key map for every on-screen number pad (PIN pads and the amount / quantity numpad), docs/pos-keyboard-scan.md.
 *
 * Digits come from the physical key (KeyboardEvent.code): the main-row keys and the numeric keypad both give a
 * digit even when the Thai keyboard layout is active (main row 1 on Kedmanee types "ๅ", not "1").
 */
export type PadKey =
  | { kind: 'digit'; digit: string }
  | { kind: 'dot' }
  | { kind: 'back' }
  | { kind: 'clear' }
  | { kind: 'enter' }
  | { kind: 'escape' };

/** The fields of a KeyboardEvent the pad looks at (DOM and React events both have them). */
export interface PadKeyEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/** The pad key a key press stands for, or null (letters, shortcuts, IME composition...). */
export function readPadKey(e: PadKeyEvent): PadKey | null {
  // an IME is composing (keyCode 229): the key belongs to the IME
  if (e.isComposing || e.keyCode === 229) return null;
  // Ctrl / Alt / Cmd combinations are shortcuts (copy, paste, Alt+1 ...), never pad keys
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const code = e.code || '';
  const key = e.key || '';
  const byCode = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (byCode) return { kind: 'digit', digit: byCode[1] };
  if (/^[0-9]$/.test(key)) return { kind: 'digit', digit: key };
  if (key === 'Enter' || code === 'Enter' || code === 'NumpadEnter') return { kind: 'enter' };
  if (key === 'Escape' || code === 'Escape') return { kind: 'escape' };
  if (key === 'Backspace' || code === 'Backspace') return { kind: 'back' };
  if (key === 'Delete' || code === 'Delete' || code === 'NumpadDelete') return { kind: 'clear' };
  if (key === '.' || code === 'NumpadDecimal' || code === 'Period') return { kind: 'dot' };
  return null;
}

/** Longest PIN the server accepts (4-6 digits). */
export const PIN_MAX_LENGTH = 6;
export const PIN_MIN_LENGTH = 4;

/** The PIN after a pad key (digits / Backspace / Delete; anything else leaves it unchanged). */
export function applyPinKey(pin: string, k: PadKey | null, max = PIN_MAX_LENGTH): string {
  if (!k) return pin;
  if (k.kind === 'digit') return pin.length < max ? pin + k.digit : pin;
  if (k.kind === 'back') return pin.slice(0, -1);
  if (k.kind === 'clear') return '';
  return pin;
}

/** Only the digits of a typed / pasted PIN, at most `max`. */
export const cleanPin = (raw: string, max = PIN_MAX_LENGTH) => raw.replace(/\D/g, '').slice(0, max);

export const isCompletePin = (pin: string) => new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
