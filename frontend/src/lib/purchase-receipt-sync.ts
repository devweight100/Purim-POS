import { create } from 'zustand';
import { apiFetch, getAuthToken } from './api';
import { ApiError, isRetryableError } from './api-error';
import { newOperationId } from './order-sync-service';
import { toast } from 'sonner';

type Receipt = { poId: string; ownerId: string; body: any; failed?: boolean; error?: string };
const prefix = 'purim-pending-po-receipt:';
export const useReceiptSyncStatus = create<{ rows: Receipt[] }>(() => ({ rows: [] }));
function owner() { return JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.user?.id; }
function read(): Receipt[] {
  const rows: Receipt[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) rows.push(JSON.parse(localStorage.getItem(key)!));
  }
  return rows;
}
function refresh() { useReceiptSyncStatus.setState({ rows: read() }); }
let sequence: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => navigator.locks ? await navigator.locks.request('purim-po-receipts', work) : await work();
  const next = sequence.then(run, run); sequence = next.catch(() => undefined); return next;
}
async function send(row: Receipt) {
  const key = prefix + row.poId;
  let result: any;
  try {
    result = await apiFetch('/purchase-orders/' + row.poId + '/receive', { method: 'POST', body: JSON.stringify(row.body) });
    if (!result?.id || !result?.poNumber) throw new ApiError('ยังไม่ได้รับการยืนยันใบรับสินค้า', 502);
  } catch (error) {
    const retryable = isRetryableError(error);
    localStorage.setItem(key, JSON.stringify({ ...row, failed: !retryable, error: error instanceof Error ? error.message : 'รับสินค้าไม่สำเร็จ' }));
    refresh();
    if (!retryable) throw error;
    return null;
  }
  // The DB has committed. A local cleanup failure must not turn this into a failed receipt.
  try { localStorage.removeItem(key); refresh(); } catch { toast.warning('ฐานข้อมูลรับสินค้าแล้ว แต่ล้างรายการรอส่งในเครื่องไม่ได้ ระบบจะตรวจซ้ำด้วยรหัสเดิม'); }
  window.dispatchEvent(new Event('pos-data-synced'));
  return result;
}
export function submitPurchaseReceipt(poId: string, body: any) {
  return exclusive(async () => {
    const ownerId = owner();
    if (!ownerId || !getAuthToken()) throw new ApiError('กรุณาเข้าสู่ระบบก่อนรับสินค้า', 401);
    const key = prefix + poId;
    const saved = localStorage.getItem(key);
    let row: Receipt = saved ? JSON.parse(saved) : { poId, ownerId, body: { ...body, clientReceiptId: newOperationId() } };
    if (row.ownerId !== ownerId) throw new ApiError('มีใบรับสินค้าค้างของผู้ใช้อื่น กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าของรายการ', 403);
    if (row.failed) row = { poId, ownerId, body: { ...body, clientReceiptId: newOperationId() } };
    localStorage.setItem(key, JSON.stringify(row));
    refresh();
    const result = await send(row);
    if (!result) toast.warning('ยังไม่ยืนยันรับสินค้าในฐานข้อมูล เก็บรายการไว้ในเครื่องและจะส่งซ้ำอัตโนมัติเมื่อเชื่อมต่อได้');
    return result;
  });
}
export function syncPurchaseReceipts() {
  return exclusive(async () => {
    refresh();
    for (const row of read()) {
      if (row.failed || row.ownerId !== owner() || !getAuthToken()) continue;
      try {
        if (await send(row)) toast.success('ฐานข้อมูลยืนยันรับสินค้าที่ค้างส่งแล้ว');
      } catch { /* Persistent banner retains the validation error for manual correction. */ }
    }
  });
}
