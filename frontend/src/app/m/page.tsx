'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, MoreHorizontal, Package, ReceiptText, RefreshCw } from 'lucide-react';
import { BillsTab } from '@/components/mobile/BillsTab';
import { MoreTab, SHIFTS_URL } from '@/components/mobile/MoreTab';
import { SalesTab } from '@/components/mobile/SalesTab';
import { StockTab } from '@/components/mobile/StockTab';
import { forgetMobileData, reloadMobileData, useMobileStatus } from '@/components/mobile/use-mobile-data';
import { dashboardQuery, type MobileRange } from '@/lib/mobile';
import { performLogout } from '@/lib/logout';
import { useAuthStore } from '@/lib/store/auth-store';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { cn } from '@/lib/utils';

type Tab = 'sales' | 'stock' | 'bills' | 'more';

const TABS: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
  { key: 'sales', label: 'ยอดขาย', icon: BarChart3 },
  { key: 'stock', label: 'สต็อก/ราคา', icon: Package },
  { key: 'bills', label: 'บิล', icon: ReceiptText },
  { key: 'more', label: 'เพิ่มเติม', icon: MoreHorizontal },
];

function subscribeSettings(onChange: () => void) {
  window.addEventListener('purim:store-settings', onChange);
  return () => window.removeEventListener('purim:store-settings', onChange);
}
const storeNameSnapshot = () => loadStoreSettings().storeName || 'ร้านปุริม';

/**
 * Mobile summary for the owner (phone browser over Tailscale): sales, stock / prices, bills and shift
 * status. Read-only: only GET requests, nothing here sells, voids or edits. Only the active tab loads.
 */
export default function MobileSummaryPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const storeName = useSyncExternalStore(subscribeSettings, storeNameSnapshot, () => '');
  const [tab, setTab] = useState<Tab>('sales');
  const [range, setRange] = useState<MobileRange>('today');
  // "now" of the period chips (yesterday's date); renewed by the refresh button
  const [now, setNow] = useState(() => Date.now());
  const [listUrl, setListUrl] = useState<string | null>(null);
  const { loading, updatedAt } = useMobileStatus();

  const salesUrl = dashboardQuery(range, now);
  const todayUrl = dashboardQuery('today', now);
  const onActiveUrl = useCallback((url: string) => setListUrl(url), []);

  const refresh = () => {
    const t = Date.now();
    setNow(t);
    if (tab === 'sales') reloadMobileData(dashboardQuery(range, t));
    else if (tab === 'more') {
      reloadMobileData(SHIFTS_URL);
      reloadMobileData(dashboardQuery('today', t));
    } else reloadMobileData(listUrl);
  };

  const logout = () => {
    forgetMobileData();
    performLogout();
    router.replace('/login');
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 pr-1 pl-4 backdrop-blur pt-[env(safe-area-inset-top)] box-content">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] leading-tight font-extrabold text-slate-900" data-testid="mobile-store-name">
            {storeName}
          </h1>
          <p className="truncate text-[12px] text-slate-500">
            {TABS.find((t) => t.key === tab)?.label}
            {updatedAt ? ` · อัปเดต ${new Date(updatedAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="รีเฟรช"
          data-testid="mobile-refresh"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
        >
          <RefreshCw className={cn('h-5 w-5', loading && 'animate-spin')} />
        </button>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-3 pb-[calc(84px+env(safe-area-inset-bottom))]">
        {tab === 'sales' && <SalesTab range={range} onRange={setRange} url={salesUrl} />}
        {tab === 'stock' && <StockTab onActiveUrl={onActiveUrl} />}
        {tab === 'bills' && <BillsTab onActiveUrl={onActiveUrl} />}
        {tab === 'more' && (
          <MoreTab
            now={now}
            dashboardUrl={todayUrl}
            userName={user?.fullName || user?.username || '-'}
            updatedAt={updatedAt}
            refreshing={loading}
            onRefresh={refresh}
            onLogout={logout}
          />
        )}
      </main>

      <nav
        aria-label="เมนูมุมมองมือถือ"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(15,23,42,0.06)]"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-4">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => switchTab(key)}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`tab-${key}`}
                  className={cn('flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[13px] font-semibold', active ? 'text-indigo-700' : 'text-slate-500')}
                >
                  <span className={cn('flex h-8 w-14 items-center justify-center rounded-full', active && 'bg-indigo-100')}>
                    <Icon className="h-[22px] w-[22px]" aria-hidden />
                  </span>
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
