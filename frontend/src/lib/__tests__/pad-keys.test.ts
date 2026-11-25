import { describe, expect, it } from 'vitest';
import { applyPinKey, cleanPin, isCompletePin, readPadKey } from '../keyboard/pad-keys';
import { shouldSubmitOnEnter, type EnterKeyInfo } from '../keyboard/enter-submit';

describe('PIN pad / numpad keyboard map', () => {
  it('digits from the main row and the numeric keypad', () => {
    for (let n = 0; n <= 9; n++) {
      expect(readPadKey({ key: String(n), code: `Digit${n}` })).toEqual({ kind: 'digit', digit: String(n) });
      expect(readPadKey({ key: String(n), code: `Numpad${n}` })).toEqual({ kind: 'digit', digit: String(n) });
    }
  });

  it('main row in the Thai layout (key "ๅ", "/", "-" ...) still gives the digit by physical key', () => {
    expect(readPadKey({ key: 'ๅ', code: 'Digit1' })).toEqual({ kind: 'digit', digit: '1' });
    expect(readPadKey({ key: '/', code: 'Digit2' })).toEqual({ kind: 'digit', digit: '2' });
    expect(readPadKey({ key: 'จ', code: 'Digit0' })).toEqual({ kind: 'digit', digit: '0' });
  });

  it('Backspace, Delete, Enter (both), Escape, decimal point', () => {
    expect(readPadKey({ key: 'Backspace', code: 'Backspace' })).toEqual({ kind: 'back' });
    expect(readPadKey({ key: 'Delete', code: 'Delete' })).toEqual({ kind: 'clear' });
    expect(readPadKey({ key: 'Enter', code: 'Enter' })).toEqual({ kind: 'enter' });
    expect(readPadKey({ key: 'Enter', code: 'NumpadEnter' })).toEqual({ kind: 'enter' });
    expect(readPadKey({ key: 'Escape', code: 'Escape' })).toEqual({ kind: 'escape' });
    expect(readPadKey({ key: '.', code: 'NumpadDecimal' })).toEqual({ kind: 'dot' });
  });

  it('letters, shortcuts and IME composition are not pad keys', () => {
    expect(readPadKey({ key: 'a', code: 'KeyA' })).toBeNull();
    expect(readPadKey({ key: '1', code: 'Digit1', altKey: true })).toBeNull(); // Alt+1 = start-of-bill level
    expect(readPadKey({ key: 'v', code: 'KeyV', ctrlKey: true })).toBeNull();
    expect(readPadKey({ key: '1', code: 'Digit1', ctrlKey: true })).toBeNull();
    expect(readPadKey({ key: 'Enter', code: 'Enter', isComposing: true })).toBeNull();
    expect(readPadKey({ key: 'Process', code: 'Digit1', keyCode: 229 })).toBeNull();
  });

  it('PIN editing: up to 6 digits, Backspace, Delete clears', () => {
    let pin = '';
    for (const d of '7391') pin = applyPinKey(pin, readPadKey({ key: d, code: `Numpad${d}` }));
    expect(pin).toBe('7391');
    pin = applyPinKey(pin, { kind: 'back' });
    expect(pin).toBe('739');
    for (const d of '12345') pin = applyPinKey(pin, { kind: 'digit', digit: d });
    expect(pin).toBe('739123');
    expect(applyPinKey(pin, { kind: 'clear' })).toBe('');
    expect(applyPinKey(pin, { kind: 'enter' })).toBe(pin);
    expect(applyPinKey(pin, null)).toBe(pin);
  });

  it('pasted PIN keeps digits only; 4-6 digits complete', () => {
    expect(cleanPin(' 73-91x2 ')).toBe('73912');
    expect(cleanPin('12345678')).toBe('123456');
    expect(isCompletePin('123')).toBe(false);
    expect(isCompletePin('1234')).toBe(true);
    expect(isCompletePin('123456')).toBe(true);
    expect(isCompletePin('1234567')).toBe(false);
  });
});

describe('Enter = primary action of a dialog', () => {
  const base: EnterKeyInfo = { key: 'Enter', targetTag: 'INPUT', targetType: 'text' };
  it('Enter in a text / number field or on the dialog itself submits', () => {
    expect(shouldSubmitOnEnter(base)).toBe(true);
    expect(shouldSubmitOnEnter({ ...base, targetType: 'number' })).toBe(true);
    expect(shouldSubmitOnEnter({ ...base, targetTag: 'DIV' })).toBe(true);
    expect(shouldSubmitOnEnter({ ...base, targetTag: 'SELECT' })).toBe(true);
  });
  it('not during IME composition, not on auto-repeat, not when already handled', () => {
    expect(shouldSubmitOnEnter({ ...base, isComposing: true })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, keyCode: 229 })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, repeat: true })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, defaultPrevented: true })).toBe(false);
  });
  it('textarea: Ctrl+Enter submits, plain Enter is a new line', () => {
    expect(shouldSubmitOnEnter({ ...base, targetTag: 'TEXTAREA' })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, targetTag: 'TEXTAREA', ctrlKey: true })).toBe(true);
    expect(shouldSubmitOnEnter({ ...base, ctrlKey: true })).toBe(false);
  });
  it('buttons, links, options and data-own-enter keep their own Enter; other keys do nothing', () => {
    expect(shouldSubmitOnEnter({ ...base, targetTag: 'BUTTON' })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, targetTag: 'A' })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, targetTag: 'DIV', targetRole: 'option' })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, targetType: 'checkbox' })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, ownEnter: true })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, shiftKey: true })).toBe(false);
    expect(shouldSubmitOnEnter({ ...base, key: 'a' })).toBe(false);
  });
});
