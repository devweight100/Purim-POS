/**
 * POS F5 "รีเฟรชข้อมูล" (docs/pos-keys-refresh.md): the whole catalogue, the customer list and the store settings
 * again from the server, without touching the cart, the held bills or the offline outbox (pending sales are sent
 * first, never dropped). Offline: nothing is replaced, the offline copy stays in use.
 */
import { toast } from 'sonner';
import { useProductStore } from '../store/product-store';
import { useShiftStore } from '../store/shift-store';
import { fetchCustomers } from '../customer-service';
import { loadStoreSettingsFromBackend } from '../store-settings-storage';
import { syncPendingOrders } from '../order-sync-service';
import { syncClock, useSyncStatus } from '../sync-status';

/** Does the server answer (GET /api/version within 2.5 s)? */
async function serverReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 2500);
  try {
    const r = await fetch('/api/version', { cache: 'no-store', signal: ac.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

let running: Promise<boolean> | null = null;

/** Run the refresh (one at a time); true = everything came from the server. Shows its own toasts. */
export function refreshPosData(): Promise<boolean> {
  if (running) return running;
  running = (async () => {
    useSyncStatus.setState({ refreshing: true });
    const id = toast.loading('กำลังรีเฟรชข้อมูล…');
    try {
      if (!(await serverReachable())) {
        const last = useSyncStatus.getState().lastSyncAt;
        toast.warning(`ออฟไลน์อยู่: ใช้ข้อมูลเดิมในเครื่องต่อ (ซิงค์ล่าสุด ${syncClock(last)})`, { id });
        return false;
      }
      // pending offline sales go to the server first (never dropped); a failure here does not stop the refresh
      await syncPendingOrders(true).catch(() => undefined);
      const results = await Promise.allSettled([
        useProductStore.getState().fetchProducts({ full: true, offlineCache: true }),
        fetchCustomers({ full: true }),
        loadStoreSettingsFromBackend(),
        useShiftStore.getState().fetchCurrentShift(),
      ]);
      const catalogueError = useProductStore.getState().error;
      const failed = results.some((r) => r.status === 'rejected') || !!catalogueError || useProductStore.getState().fromOfflineCache;
      if (failed) {
        toast.error(`รีเฟรชข้อมูลไม่ครบ ลองอีกครั้ง (ซิงค์ล่าสุด ${syncClock(useSyncStatus.getState().lastSyncAt)})`, { id });
        return false;
      }
      toast.success(`รีเฟรชข้อมูลแล้ว ${syncClock(Date.now())} (สินค้า ลูกค้า การตั้งค่า)`, { id });
      return true;
    } finally {
      useSyncStatus.setState({ refreshing: false });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
