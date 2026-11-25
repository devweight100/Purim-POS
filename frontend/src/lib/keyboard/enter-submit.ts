'use client';

import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * "Enter = the dialog's primary action" for the POS dialogs (docs/pos-keyboard-scan.md).
 *
 * - not while an IME is composing (Thai / other input methods confirm their text with Enter);
 * - not on a held-down Enter (auto-repeat) and never twice while the action is still running;
 * - a multi-line text field (textarea) needs Ctrl+Enter (plain Enter = new line);
 * - buttons, links, list options and comboboxes keep their own Enter (it presses / picks that element), as does
 *   anything inside an element marked data-own-enter;
 * - an Enter a field already handled (defaultPrevented) is left alone;
 * - a barcode scanner's Enter never gets here: the POS page's scanner detector stops it first.
 */
export interface EnterKeyInfo {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
  /** tag name of the focused element (upper case) */
  targetTag: string;
  /** its role attribute */
  targetRole?: string | null;
  /** type attribute of an <input> */
  targetType?: string | null;
  /** inside [data-own-enter] */
  ownEnter?: boolean;
}

const OWN_ENTER_ROLES = new Set(['button', 'link', 'option', 'menuitem', 'combobox', 'listbox', 'tab', 'checkbox', 'radio', 'switch']);

export function shouldSubmitOnEnter(e: EnterKeyInfo): boolean {
  if (e.key !== 'Enter') return false;
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.defaultPrevented || e.repeat || e.altKey || e.shiftKey) return false;
  if (e.ownEnter) return false;
  const tag = (e.targetTag || '').toUpperCase();
  if (tag === 'TEXTAREA') return !!(e.ctrlKey || e.metaKey);
  if (e.ctrlKey || e.metaKey) return false;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return false;
  if (tag === 'INPUT') {
    const t = (e.targetType || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'image', 'file', 'checkbox', 'radio'].includes(t)) return false;
    return true;
  }
  if (e.targetRole && OWN_ENTER_ROLES.has(e.targetRole)) return false;
  return true;
}

/** EnterKeyInfo of a React / DOM keyboard event. */
export function enterKeyInfo(e: ReactKeyboardEvent | KeyboardEvent): EnterKeyInfo {
  const native = 'nativeEvent' in e ? e.nativeEvent : e;
  const t = e.target as HTMLElement | null;
  return {
    key: e.key,
    isComposing: native.isComposing,
    keyCode: native.keyCode,
    repeat: e.repeat,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    defaultPrevented: e.defaultPrevented,
    targetTag: t?.tagName || '',
    targetRole: t?.getAttribute?.('role') ?? null,
    targetType: t?.tagName === 'INPUT' ? (t as HTMLInputElement).type : null,
    ownEnter: !!t?.closest?.('[data-own-enter]'),
  };
}

/**
 * onKeyDown for a dialog's content (or a form section): Enter runs `submit` (see the rules above).
 * `disabled`: the primary button is disabled (invalid form) - Enter does nothing then.
 * A submit returning a promise blocks further Enters until it settles (no double submit).
 */
export function useEnterSubmit(submit: () => unknown, opts: { disabled?: boolean } = {}) {
  const running = useRef(false);
  return (e: ReactKeyboardEvent) => {
    // only keys from this dialog's own DOM (a nested dialog rendered through a portal bubbles here in React)
    if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
    if (!shouldSubmitOnEnter(enterKeyInfo(e))) return;
    e.preventDefault();
    if (opts.disabled || running.current) return;
    const r = submit();
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      running.current = true;
      void (r as Promise<unknown>).finally(() => {
        running.current = false;
      });
    }
  };
}

/** Same rule without a hook (hand-made overlays that render conditionally): onKeyDown running `submit` on Enter. */
export function enterSubmitHandler(submit: () => unknown, disabled = false) {
  return (e: ReactKeyboardEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
    if (!shouldSubmitOnEnter(enterKeyInfo(e))) return;
    e.preventDefault();
    if (!disabled) submit();
  };
}
