'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
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
import { fetchCustomers, refreshCustomersIfLoaded, releaseCustomers } from '@/lib/customer-service';
import {
  isSellingDevice,
  notePendingOfflineBills,
  posDataDemand,
  posDataPlan,
  usePosDataPolicyVersion,
} from '@/lib/pos-data-policy';
import { api, apiFetch, getAuthToken, ApiError } from '@/lib/api';
import { getTerminalId } from '@/lib/terminal-id';
import { startRealtime, RealtimeEvent } from '@/lib/realtime';
import { clearLegacyLocalData } from '@/lib/local-data-reset';
import { getElectronAPI } from '@/lib/electron-api';

/** What this screen keeps in memory now (see pos-data-policy.ts). */
function currentPlan() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const d = posDataDemand();
  return posDataPlan({ path, sellingDevice: isSellingDevice(), productDemand: d.products, customerDemand: d.customers });
}

/** Rows of the offline outbox only change the status bar when they really changed (no re-render every 3 s). */
function sameRows(a: OfflineOrder[], b: OfflineOrder[]): boolean {
  return a.length === b.length && a.every((o, i) => o.clientOrderId === b[i].clientOrderId && o.syncStatus === b[i].syncStatus && o.lastError === b[i].lastError && o.ownerId === b[i].ownerId);
}

export function ClientDbSync() {
  const status = useConnectionStatus();
  const receipts = useReceiptSyncStatus((s) => s.rows);
  const userId = useAuthStore((s) => s.user?.id);
  const [expanded, setExpanded] = useState(false);
  const [rows, setRowsState] = useState<OfflineOrder[]>([]);
  const pathname = usePathname();
  const policyVersion = usePosDataPolicyVersion();
  const loadedFor = useRef<{ products: boolean; customers: boolean }>({ products: false, customers: false });

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
    const setRows = (next: OfflineOrder[]) => {
      notePendingOfflineBills(next.filter((o) => o.syncStatus !== 'confirmed').length);
      setRowsState((cur) => (sameRows(cur, next) ? cur : next));
    };

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

        // 4. Refresh authenticated user profile (role, permissions, active status) & master data.
        //    The product catalogue (+ offline copy) and the customer list only where they are kept: the POS, a
        //    selling device, a screen that needs the whole list (pos-data-policy.ts). A back-office-only device
        //    does not hold 10k products / 5k customers in memory.
        const plan = currentPlan();
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
          plan.products ? useProductStore.getState().fetchProducts() : undefined,
          useShiftStore.getState().fetchCurrentShift(),
          // the product store reads the categories with the catalogue; without it, once here
          plan.products
            ? undefined
            : fetchCategoriesFromBackend().then((cats) => {
                // category names / filters of the back-office screens (small list; no re-render when unchanged)
                if (!disposed && JSON.stringify(cats) !== JSON.stringify(useProductStore.getState().categories)) {
                  useProductStore.setState({ categories: cats });
                }
              }),
          fetchBankAccountsFromBackend(),
          plan.customers ? fetchCustomers() : undefined,
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

  // The screen changed or a screen started / stopped needing the lists: load what is now needed at once, release
  // what is no longer needed (leaving the POS on a device that does not sell frees the catalogue and the customer
  // list and stops their polling). The release waits a moment so a screen that opens right after can claim them.
  useEffect(() => {
    if (!userId) return;
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    if (path === '/m' || path.startsWith('/m/')) return;
    const plan = currentPlan();
    const before = loadedFor.current;
    loadedFor.current = plan;
    if (plan.products && !before.products && !useProductStore.getState().products.length) void useProductStore.getState().fetchProducts();
    if (plan.customers && !before.customers) void fetchCustomers().catch(() => undefined);
    if (plan.products && plan.customers) return;
    const t = setTimeout(() => {
      const now = currentPlan();
      if (!now.products) useProductStore.getState().release();
      if (!now.customers) releaseCustomers();
    }, 1500);
    return () => clearTimeout(t);
  }, [pathname, policyVersion, userId]);

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
      // apart. (Round 2: the server now announces only committed writes - product ones only when the change log
      // got rows - so a refresh's own read no longer triggers another; the spacing stays as a guard.)
      // "ล้างข้อมูลทั้งหมด" on another terminal: the TRUNCATE is announced too, and the delta sync answers an old
      // cursor with a full catalogue (new change-log epoch), so deleted products disappear here without F5.
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
      // other screens listen too (online-order badge)
      window.dispatchEvent(new CustomEvent('purim:realtime', { detail: e }));
      // only the lists this screen keeps (a back-office-only device has none: nothing to refresh)
      if (e.entity === 'product' || e.entity === 'stock' || e.entity === 'category' || e.entity === 'supplier') {
        soon('products', () => (currentPlan().products ? useProductStore.getState().fetchProducts() : useProductStore.getState().refreshIfLoaded()));
      } else if (e.entity === 'customer' || e.entity === 'debt') {
        soon('customers', () => (currentPlan().customers ? fetchCustomers() : refreshCustomersIfLoaded()));
      } else if (e.entity === 'settings') {
        // VAT, receipt options, price level names ...: at once, not only with the 15 s poll (docs/pos-keys-refresh.md)
        soon('settings', () => loadStoreSettingsFromBackend());
      }
    });
    return () => {
      stop();
      timers.forEach((t) => clearTimeout(t));
    };
  }, [userId]);

  // F5 in the desktop app does what it does in a browser: the POS handles it itself (รีเฟรชข้อมูล, preventDefault);
  // any other page reloads. The app menu has no F5 (desktop/menu-shortcuts.js), so without this nothing happens.
  useEffect(() => {
    if (!getElectronAPI()?.isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F5' || e.defaultPrevented || e.altKey || e.metaKey || e.repeat) return;
      e.preventDefault();
      window.location.reload();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
