'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { Sidebar } from '@/components/layout/Sidebar';

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
  return (
    <div className="flex min-h-dvh max-w-full overflow-x-hidden bg-slate-50">
      <ForbiddenNotifier />
      <Sidebar />
      <main className="min-h-dvh min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto pt-14 lg:ml-[240px] lg:pt-0">
        {children}
      </main>
    </div>
  );
}
