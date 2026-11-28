'use client';

import { useSyncExternalStore } from 'react';
import { ApiError, getApiBaseUrl, getAuthToken } from './api';

/**
 * Every data export needs a manager / owner PIN, every time (owner, Round B). The server enforces it
 * (backend/src/exports): POST /exports/approve -> single-use approval bound to this user, kind and filters ->
 * POST /exports/<kind> with header x-export-approval. This file shows the PIN dialog (components/common/
 * ExportPinHost.tsx, mounted once in Providers) and runs both requests.
 *
 *   const res = await approvedExport<{ data: Row[] }>({ kind: 'products', filters, path: '/exports/products', body: { filters }, what: 'สินค้า 120 รายการ' });
 *   if (!res) return; // cancelled
 */
export type ExportKind = 'products' | 'product-suppliers' | 'report' | 'profit-loss';

export interface ExportPinRequest {
  id: number;
  kind: ExportKind;
  filters: unknown;
  /** what is being exported, shown in the dialog */
  what: string;
  resolve: (approvalId: string | null) => void;
}

let current: ExportPinRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useExportPinRequest(): ExportPinRequest | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => current,
    () => null,
  );
}

/** Called by the host: approval id, or null when cancelled. */
export function settleExportPin(id: number, approvalId: string | null) {
  if (!current || current.id !== id) return;
  const req = current;
  current = null;
  emit();
  req.resolve(approvalId);
}

/** Opens the PIN dialog; resolves with the approval id (null = cancelled). */
export function askExportPin(kind: ExportKind, filters: unknown, what: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (current) current.resolve(null);
    current = { id: nextId++, kind, filters, what, resolve };
    emit();
  });
}

/** POST with the user's token, a long timeout (big exports), no global 401 / 403 side effects. */
export async function exportPost<T>(path: string, body: unknown, approvalId?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (approvalId) headers['x-export-approval'] = approvalId;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    let res: Response;
    try {
      res = await fetch(`${getApiBaseUrl()}${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}), signal: controller.signal });
    } catch {
      throw new ApiError('ติดต่อเซิร์ฟเวอร์ไม่ได้หรือหมดเวลารอ กรุณาลองใหม่');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
      throw new ApiError(msg || `HTTP ${res.status}`, res.status, data);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

/** PIN dialog, then the export request. null = cancelled. Errors of the export request are thrown. */
export async function approvedExport<T>(opts: { kind: ExportKind; filters: unknown; path: string; body: unknown; what: string }): Promise<T | null> {
  const approvalId = await askExportPin(opts.kind, opts.filters, opts.what);
  if (!approvalId) return null;
  return exportPost<T>(opts.path, opts.body, approvalId);
}
