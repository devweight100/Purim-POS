'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/store/auth-store';
import { hasPermission } from '@/lib/permissions';
import { playChime, useOnlineCounts } from '@/lib/online-orders';

/**
 * Keeps the online-order badge fresh (realtime "onlineOrder" events relayed by ClientDbSync, plus a slow poll)
 * and announces new orders / LINE link requests with a toast and a chime. Mounted in the back office and the POS.
 */
export function OnlineOrderWatcher() {
  const user = useAuthStore((s) => s.user);
  const allowed = !!user && hasPermission(user, 'POS_SELL');
  const router = useRouter();
  const last = useRef<{ new: number; links: number } | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const c = await useOnlineCounts.getState().refresh();
      if (!c) return;
      const prev = last.current;
      last.current = { new: c.new, links: c.linkRequests };
      if (!prev) return;
      if (c.new > prev.new) {
        playChime();
        toast.info(`มีออเดอร์ออนไลน์ใหม่ (${c.new} รายการรอรับ)`, { id: 'online-order-new', duration: 10_000, action: { label: 'เปิดดู', onClick: () => router.push('/online-orders') } });
      } else if (c.linkRequests > prev.links) {
        toast.info('มีลูกค้าขอผูกบัญชี LINE กับสมาชิก', { id: 'online-link-new', duration: 8000, action: { label: 'เปิดดู', onClick: () => router.push('/online-orders?tab=links') } });
      }
    };
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void check(), 400);
    };
    const onEvent = (e: Event) => {
      if ((e as CustomEvent<{ entity?: string }>).detail?.entity === 'onlineOrder') soon();
    };
    soon();
    const poll = setInterval(() => void check(), 60_000);
    window.addEventListener('purim:realtime', onEvent);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener('purim:realtime', onEvent);
    };
  }, [allowed, router]);
  return null;
}
