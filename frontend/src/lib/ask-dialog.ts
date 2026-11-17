'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

/**
 * Promise-based in-page replacements for window.prompt() / window.confirm() (rendered by
 * components/common/AskDialogHost.tsx, mounted once in Providers):
 *
 *   const reason = await askReason({ title: 'เหตุผลที่ยกเลิก' });   // string, or null when cancelled
 *   if (!(await askConfirm({ title: 'ลบรายการนี้?' }))) return;
 *
 * The browser's own dialogs are not used in the back office / POS (eslint forbids them): Electron throws on
 * prompt(), and after a native confirm() / alert() the desktop window passes no more keystrokes to the page until it
 * is re-focused (owner 2026-11-17: the cancel reason of an online order could not be typed).
 */
export interface AskReasonOptions {
  title: ReactNode;
  label?: ReactNode;
  description?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  /** default true: blank text cannot be confirmed */
  required?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  inputId?: string;
}

export interface AskConfirmOptions {
  title: ReactNode;
  /** longer text; new lines are kept */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export type AskRequest =
  | { id: number; kind: 'reason'; options: AskReasonOptions; resolve: (v: string | null) => void }
  | { id: number; kind: 'confirm'; options: AskConfirmOptions; resolve: (v: boolean) => void };

let queue: AskRequest[] = [];
let nextId = 1;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(req: AskRequest) {
  queue = [...queue, req];
  emit();
}

/** Called by the host when the user answers (or closes) a request. */
export function settleAsk(id: number, value: string | boolean | null) {
  const req = queue.find((r) => r.id === id);
  if (!req) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  if (req.kind === 'reason') req.resolve(typeof value === 'string' ? value : null);
  else req.resolve(value === true);
}

/** Text the user typed (trimmed), or null when the dialog was cancelled / closed. */
export function askReason(options: AskReasonOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (hosts === 0) {
      // no host on this page (should not happen: Providers mounts it); plain browser fallback
      const r = typeof window !== 'undefined' ? window.prompt(String(options.title), options.defaultValue ?? '') : null; // eslint-disable-line no-restricted-properties
      resolve(r === null ? null : r.trim());
      return;
    }
    push({ id: nextId++, kind: 'reason', options, resolve });
  });
}

/** true when the user confirmed. */
export function askConfirm(options: AskConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (hosts === 0) {
      resolve(typeof window !== 'undefined' && window.confirm(String(options.title))); // eslint-disable-line no-restricted-properties
      return;
    }
    push({ id: nextId++, kind: 'confirm', options, resolve });
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => queue;
const serverSnapshot = (): AskRequest[] => [];

/** For the host: pending requests, oldest first (one is shown at a time). */
export function useAskQueue() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** The host registers itself so askReason / askConfirm know a dialog can be shown. */
export function registerAskHost() {
  hosts++;
  return () => {
    hosts--;
    // a host that goes away (logout, layout change) cancels what it was showing
    if (hosts === 0) for (const r of [...queue]) settleAsk(r.id, null);
  };
}
