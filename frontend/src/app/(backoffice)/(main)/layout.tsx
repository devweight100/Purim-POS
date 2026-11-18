'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { Sidebar } from '@/components/layout/Sidebar';
import { OnlineOrderWatcher } from '@/components/online-orders/OnlineOrderWatcher';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import { cn } from '@/lib/utils';

/** Any 403 from the API is announced (once per message per 10 s) instead of leaving a page silently empty. */
function ForbiddenNotifier() {
  useEffect(() => {
    const lastShown = new Map<string, number>();
    const onForbidden = (e: Event) => {
      const detail = (e as CustomEvent<{ endpoint?: string; message?: unknown }>).detail || {};
      const reason = typeof detail.message === 'string' && detail.message.trim() ? detail.message.trim() : '';
      const key = reason || 'forbidden';
      const now = Date.now();
      if (now - (lastShown.get(key) || 0) < 10_000) return;
      lastShown.set(key, now);
      toast.error('ไม่มีสิทธิ์เข้าถึงข้อมูลบางส่วนของหน้านี้', {
        id: `forbidden-${key}`,
        description: reason || 'บัญชีของคุณไม่มีสิทธิ์ใช้งานข้อมูลนี้ กรุณาติดต่อผู้ดูแลร้าน',
      });
    };
    window.addEventListener('purim:forbidden', onForbidden);
    return () => window.removeEventListener('purim:forbidden', onForbidden);
  }, []);
  return null;
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  // the content area takes the width the collapsed sidebar frees (64 px rail instead of 240 px)
  const collapsed = useSidebarStore((s) => s.collapsed);
  return (
    <div className="flex min-h-dvh max-w-full overflow-x-hidden bg-slate-50">
      <ForbiddenNotifier />
      <OnlineOrderWatcher />
      <Sidebar />
      <main data-sidebar-collapsed={collapsed ? 'true' : 'false'} className={cn('min-h-dvh min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto pt-14 lg:pt-0', collapsed ? 'lg:ml-16' : 'lg:ml-[240px]')}>
        {children}
      </main>
    </div>
  );
}
