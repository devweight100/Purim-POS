'use client';
import { useEffect, useState } from 'react';
import { useConnectionStatus, reportConnection } from '@/lib/connection-status';
import { syncPendingOrders } from '@/lib/order-sync-service';
import { getPendingOfflineOrders, OfflineOrder } from '@/lib/offline-db';
import { useProductStore } from '@/lib/store/product-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { syncPurchaseReceipts, useReceiptSyncStatus, refreshReceiptSyncStatus } from '@/lib/purchase-receipt-sync';
import { fetchCategoriesFromBackend } from '@/lib/category-storage';
import { fetchBankAccountsFromBackend } from '@/lib/bank-account-storage';
import { loadStoreSettingsFromBackend } from '@/lib/store-settings-storage';
import { fetchCustomers } from '@/lib/customer-service';
import { api, apiFetch, getAuthToken, ApiError } from '@/lib/api';
import { getTerminalId } from '@/lib/terminal-id';
import { startRealtime, RealtimeEvent } from '@/lib/realtime';
import { clearLegacyLocalData } from '@/lib/local-data-reset';

export function ClientDbSync() {
  const status = useConnectionStatus();
  const receipts = useReceiptSyncStatus((s) => s.rows);
  const userId = useAuthStore((s) => s.user?.id);
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<OfflineOrder[]>([]);

  useEffect(() => {
    clearLegacyLocalData();
    refreshReceiptSyncStatus();
  }, []);

  useEffect(() => {
    let disposed = false;
    let outboxTimer: ReturnType<typeof setTimeout>;
    let delay = 3000;
    let outboxRunning = false;
    let masterSyncRunning = false;

    const runOutboxSync = async () => {
      if (outboxRunning || disposed) return;
      clearTimeout(outboxTimer);
      outboxRunning = true;
      try {
        // Only sales are replayed in the background (offline outbox). Goods receipts whose
        // result is unknown are re-sent by the user (status bar button / receive again).
        const result = await syncPendingOrders(true);
        if (!disposed) setRows(await getPendingOfflineOrders());
        delay = result.failed ? Math.min(delay * 2, 30000) : 3000;
      } catch {
        /* sync service exposes storage failures */
      } finally {
        outboxRunning = false;
        if (!disposed) outboxTimer = setTimeout(runOutboxSync, delay);
      }
    };

    const runMultiTerminalSync = async () => {
      if (masterSyncRunning || disposed) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      masterSyncRunning = true;
      try {
        // 1. Always sync store settings (accessible before and after login)
        void loadStoreSettingsFromBackend().catch(() => undefined);

        const token = getAuthToken();
        const authState = useAuthStore.getState();

        // Mobile summary (/m, a phone over Tailscale): read-only, not a sales terminal. No terminal
        // heartbeat and no POS master data (the whole product catalogue every 15 s); only the profile.
        const path = typeof window !== 'undefined' ? window.location.pathname : '';
        if (path === '/m' || path.startsWith('/m/')) {
          if (token && authState.isAuthenticated) {
            await api.auth
              .getProfile()
              .then((profile) => {
                if (!profile || disposed) return;
                if (profile.isActive === false) useAuthStore.getState().logout();
                else useAuthStore.setState({ user: { ...profile, name: profile.fullName || profile.name } });
              })
              .catch((err: unknown) => {
                if (err instanceof ApiError && err.status === 401 && !disposed) useAuthStore.getState().logout();
              });
          }
          return;
        }

        // 2. Send terminal heartbeat ping so Master Control sees all online terminals in real time
        try {
          const terminalId = getTerminalId();
          const hostname =
            typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
          const isLocalMaster = hostname === 'localhost' || hostname === '127.0.0.1';
          const terminalName = isLocalMaster
            ? 'เครื่องแม่ (Main Terminal)'
            : `จุดขายลูกข่าย #${terminalId.slice(0, 6).toUpperCase()}`;
          const userName =
            authState.user?.fullName ||
            authState.user?.name ||
            authState.user?.username ||
            'แคชเชียร์';

          const pingStart = Date.now();
          await apiFetch('/server-control/ping', {
            method: 'POST',
            body: JSON.stringify({
              terminalId,
              terminalName,
              userName,
              latencyMs: Math.max(1, Date.now() - pingStart),
            }),
          }).catch(() => undefined);
        } catch {
          /* Ignore ping failures */
        }

        if (!token || !authState.isAuthenticated) {
          return;
        }

        // 3. Flush any pending offline orders first
        try {
          await syncPendingOrders(true);
          if (!disposed) setRows(await getPendingOfflineOrders());
        } catch {}

        // 4. Refresh authenticated user profile (role, permissions, active status) & master data
        await Promise.allSettled([
          api.auth
            .getProfile()
            .then((profile) => {
              if (profile && !disposed) {
                if (profile.isActive === false) {
                  useAuthStore.getState().logout();
                } else {
                  useAuthStore.setState({
                    user: {
                      ...profile,
                      name: profile.fullName || profile.name,
                    },
                  });
                }
              }
            })
            .catch((err: unknown) => {
              if (err instanceof ApiError && err.status === 401 && !disposed) {
                useAuthStore.getState().logout();
              }
            }),
          useProductStore.getState().fetchProducts(),
          useShiftStore.getState().fetchCurrentShift(),
          fetchCategoriesFromBackend(),
          fetchBankAccountsFromBackend(),
          fetchCustomers(),
        ]);

        if (!disposed && typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('purim:data-synced', {
              detail: { timestamp: Date.now() },
            }),
          );
        }
      } catch {
        /* Never throw unhandled rejections in background sync */
      } finally {
        masterSyncRunning = false;
      }
    };

    const wake = () => {
      delay = 3000;
      void runOutboxSync();
      void runMultiTerminalSync();
    };
    const offline = () => reportConnection(true);
    const refresh = () => {
      void runMultiTerminalSync();
    };
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        wake();
      }
    };

    void runOutboxSync();
    void runMultiTerminalSync();

    const intervalId = setInterval(() => {
      void runMultiTerminalSync();
    }, 15000);

    window.addEventListener('online', wake);
    window.addEventListener('offline', offline);
    window.addEventListener('focus', wake);
    window.addEventListener('pos-data-synced', refresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    return () => {
      disposed = true;
      clearTimeout(outboxTimer);
      clearInterval(intervalId);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', offline);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pos-data-synced', refresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId]);

  // Changes made on any screen / terminal reach this one at once (server-sent events), not only by the 15 s poll:
  // stock adjusted in the back office shows on the POS card right away (BUG-02 v1.5.3).
  useEffect(() => {
    const token = getAuthToken();
    if (!token || !userId) return;
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    if (path === '/m' || path.startsWith('/m/')) return;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const lastRun = new Map<string, number>();
    const soon = (key: string, run: () => unknown) => {
      // A burst of events (import, receiving a PO) becomes one refresh, and refreshes of one kind are at least 2 s
      // apart: the server re-sends recent changes on every COMMIT for a few seconds, including the commit of the
      // refresh's own read, which would otherwise keep refreshing in a loop.
      if (timers.has(key)) return;
      const wait = Math.max(300, (lastRun.get(key) ?? 0) + 2000 - Date.now());
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        lastRun.set(key, Date.now());
        void Promise.resolve(run()).catch(() => undefined);
      }, wait));
    };
    // (no refresh on 'shift' events: reading the current shift itself emits one -> endless loop)
    const stop = startRealtime(token, (e: RealtimeEvent) => {
      if (e.entity === 'product' || e.entity === 'stock' || e.entity === 'category' || e.entity === 'supplier') {
        soon('products', () => useProductStore.getState().fetchProducts());
      } else if (e.entity === 'customer' || e.entity === 'debt') {
        soon('customers', () => fetchCustomers());
      }
    });
    return () => {
      stop();
      timers.forEach((t) => clearTimeout(t));
    };
  }, [userId]);

  if (!status.unavailable && !status.pending && !status.error && !receipts.length) return null;
  return (
    <aside
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[60] w-full border-b border-amber-400 bg-amber-100 px-3 py-2 text-sm text-amber-950"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>
          {status.unavailable ? 'ติดต่อฐานข้อมูลไม่ได้' : 'มีข้อมูลรอการยืนยัน'} — รอส่ง{' '}
          {status.pending} บิล
        </strong>
        <span>
          {status.failed > 0
            ? 'ต้องตรวจสอบ ' + status.failed + ' บิล'
            : 'จะส่งอัตโนมัติเมื่อเชื่อมต่อได้'}
        </span>
        <button
          className="rounded border border-amber-600 px-3 py-2"
          disabled={status.syncing}
          onClick={() => {
            void syncPendingOrders();
            void syncPurchaseReceipts();
          }}
        >
          {status.syncing ? 'กำลังส่ง…' : 'ลองส่งอีกครั้ง'}
        </button>
        <button
          className="rounded border border-amber-600 px-3 py-2"
          onClick={() => setExpanded(!expanded)}
        >
          รายละเอียด
        </button>
      </div>
      {receipts.map((row) => (
        <p role="alert" key={row.poId}>
          ใบรับสินค้ารอฐานข้อมูล: {row.poId} —{' '}
          {row.ownerId !== userId
            ? 'กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าของรายการ'
            : row.failed
            ? 'ต้องเปิดใบสั่งซื้อเพื่อตรวจสอบและแก้ไข'
            : 'ยังไม่ทราบผล กดลองส่งอีกครั้ง (ใช้รหัสเดิม ไม่รับซ้ำ)'}{' '}
          {row.error}
        </p>
      ))}
      {status.error && <p role="alert">{status.error}</p>}
      {expanded && (
        <ul className="max-h-48 overflow-y-auto">
          {rows
            .filter((o) => o.syncStatus !== 'confirmed')
            .map((o) => (
              <li key={o.clientOrderId} className="border-t border-amber-300 py-2 break-words">
                {o.orderNumber} · {o.createdAt} · {o.lastError || 'รอส่งฐานข้อมูล'}
                {o.ownerId !== userId && ' — กรุณาเข้าสู่ระบบด้วยผู้ขายเจ้าของบิล'}
              </li>
            ))}
        </ul>
      )}
    </aside>
  );
}
