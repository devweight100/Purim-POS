import { apiFetch, getAuthToken } from './api';
import { ApiError, isRetryableError } from './api-error';
import { getPendingOfflineOrders, saveOfflineOrder, removeOfflineOrder, OfflineOrder } from './offline-db';
import { useShiftStore } from './store/shift-store';
import { useConnectionStatus } from './connection-status';
import { toast } from 'sonner';

export function newOperationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
function ownerId(): string | undefined {
  try { return JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.user?.id; }
  catch { return undefined; }
}
let sequence: Promise<unknown> = Promise.resolve();
function exclusively<T>(work: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => typeof navigator !== 'undefined' && navigator.locks
    ? await navigator.locks.request('purim-order-outbox', work) : await work();
  const next = sequence.then(run, run);
  sequence = next.catch(() => undefined);
  return next;
}
export async function refreshOutboxStatus() {
  const rows = await getPendingOfflineOrders();
  const pending = rows.filter(o => o.syncStatus !== 'confirmed');
  useConnectionStatus.setState({ pending: pending.length, failed: pending.filter(o => o.syncStatus === 'failed').length });
  return rows;
}
function payload(order: OfflineOrder) {
  const { syncStatus, retryCount, lastError, serverOrder, ownerId: owner, orderNumber, ...data } = order;
  return { ...data, orderNumber: orderNumber && !/^(ORD-OFFLINE|OFFLINE)/.test(orderNumber) ? orderNumber : undefined };
}
async function confirm(order: OfflineOrder, response: any) {
  if (!response?.id || !response?.orderNumber) throw new ApiError('เซิร์ฟเวอร์ยังไม่ยืนยันเลขบิล', 502);
  // Once the server acknowledges a committed sale, local cleanup is best effort.
  try {
    await saveOfflineOrder({ ...order, syncStatus: 'confirmed', serverOrder: response });
    useShiftStore.getState().updateOrderAfterSync(order.clientOrderId, response.orderNumber, response.id);
    await removeOfflineOrder(order.clientOrderId);
  } catch {
    useConnectionStatus.setState({ error: 'ฐานข้อมูลบันทึกบิลแล้ว แต่ปรับสถานะในเครื่องไม่สำเร็จ ระบบจะตรวจซ้ำด้วยรหัสเดิม' });
  }
  return response;
}
export async function submitOrder(data: any) {
  return exclusively(async () => {
    const userId = ownerId();
    if (!userId || !getAuthToken()) throw new ApiError('กรุณาเข้าสู่ระบบก่อนบันทึกการขาย', 401);
    if (!data.shiftId) throw new ApiError('กรุณาเปิดกะบนฐานข้อมูลก่อนขาย หากเปิดกะไม่ได้ให้ลองใหม่เมื่อเชื่อมต่อได้', 400);
    if (!data.clientOrderId) throw new Error('ไม่พบรหัสธุรกรรม กรุณาเปิดหน้าชำระเงินใหม่');
    const rows = await getPendingOfflineOrders();
    const previous = rows.find(o => o.clientOrderId === data.clientOrderId);
    if (previous?.syncStatus === 'confirmed') return previous.serverOrder;
    if (previous && previous.ownerId !== userId) throw new ApiError('ต้องเข้าสู่ระบบด้วยผู้ขายเจ้าของบิล', 403);
    // Freeze the original request after an uncertain network result.
    const order: OfflineOrder = previous || {
      ...data, ownerId: userId, payloadVersion: 2,
      orderNumber: 'ORD-OFFLINE-' + data.clientOrderId,
      createdAt: data.createdAt || new Date().toISOString(), syncStatus: 'pending', retryCount: 0,
    };
    await saveOfflineOrder(order);
    try {
      const response = await apiFetch('/orders/checkout', { method: 'POST', body: JSON.stringify(payload(order)) });
      return await confirm(order, response);
    } catch (error) {
      const retryable = isRetryableError(error);
      await saveOfflineOrder({ ...order, syncStatus: retryable ? 'pending' : 'failed', retryCount: order.retryCount + 1, lastError: error instanceof Error ? error.message : String(error) });
      if (!retryable) { await removeOfflineOrder(order.clientOrderId); throw error; }
      toast.warning('ยังบันทึกฐานข้อมูลไม่ได้ เก็บบิลในเครื่องแล้ว และจะส่งให้อัตโนมัติเมื่อเชื่อมต่อได้', { duration: 8000 });
      return { ...data, id: order.clientOrderId, orderNumber: order.orderNumber, createdAt: order.createdAt, isOfflineSaved: true, status: 'PENDING_SYNC' };
    } finally { await refreshOutboxStatus().catch(() => useConnectionStatus.setState({ error: 'อ่านสถานะคิวไม่ได้ กรุณาตรวจสอบพื้นที่จัดเก็บ' })); }
  });
}
// Legacy IDs were created AFTER sending, so automatic resubmission could duplicate sales.
async function importLegacyOrders() {
  const known = new Set((await getPendingOfflineOrders()).map(o => o.clientOrderId));
  const orders = JSON.parse(localStorage.getItem('pos_completed_orders') || '[]');
  for (const order of orders) {
    if (order.isSynced !== false || order.outboxVersion === 2 || known.has(order.id)) continue;
    await saveOfflineOrder({ ...order, clientOrderId: order.id, ownerId: order.userId,
      syncStatus: 'failed', retryCount: 0,
      lastError: 'บิลจากระบบเดิม ต้องตรวจว่าฐานข้อมูลมีบิลนี้แล้วหรือไม่ก่อนส่งซ้ำ',
    });
  }
}
export async function syncPendingOrders(silent = false): Promise<{ synced: number; failed: number }> {
  if (typeof window === 'undefined') return { synced: 0, failed: 0 };
  return exclusively(async () => {
    let synced = 0;
    let failed = 0;
    useConnectionStatus.setState({ syncing: true, error: null });
    try {
      await importLegacyOrders();
      for (const order of await getPendingOfflineOrders()) {
        if (order.syncStatus === 'confirmed' && order.serverOrder) {
          await confirm(order, order.serverOrder);
          continue;
        }
        if ((order.syncStatus === 'failed' && (silent || order.payloadVersion !== 2)) || !order.ownerId || order.ownerId !== ownerId() || !getAuthToken()) {
          failed++; continue;
        }
        try {
          const response = await apiFetch('/orders/checkout', { method: 'POST', body: JSON.stringify(payload(order)) });
          await confirm(order, response);
          synced++;
        } catch (error) {
          const retryable = isRetryableError(error);
          await saveOfflineOrder({ ...order, syncStatus: retryable ? 'pending' : 'failed', retryCount: order.retryCount + 1,
            lastError: error instanceof Error ? error.message : String(error) });
          failed++;
          if (retryable || (error instanceof ApiError && error.status === 401)) break;
        }
      }
      await refreshOutboxStatus();
      if (synced) {
        toast.success('บันทึกบิลค้างลงฐานข้อมูลแล้ว ' + synced + ' บิล');
        window.dispatchEvent(new Event('pos-data-synced'));
      }
      if (failed && !silent) toast.warning('ยังมีบิลรอส่งหรือบิลที่ต้องตรวจสอบ ดูรายละเอียดในแถบสถานะ');
      return { synced, failed };
    } catch (error) {
      useConnectionStatus.setState({ error: error instanceof Error ? error.message : String(error) });
      return { synced, failed: failed + 1 };
    } finally { useConnectionStatus.setState({ syncing: false }); }
  });
}
