'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Lock, LogOut, ShoppingCart, Store, WifiOff } from 'lucide-react';
import { useAuthStore } from '@/lib/store/auth-store';
import { performLogout } from '@/lib/logout';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { isSellingDevice, sellingDeviceSetting } from '@/lib/pos-data-policy';
import { NO_BACK_OFFICE_TEXT, NO_POS_TEXT, roleLabel, startChoices, startDecision, type StartChoice } from '@/lib/start-screen';
import { VersionBadge } from '@/components/common/VersionInfo';

/** The server answers within this time, or the device counts as offline (a selling device then opens the POS). */
const PING_TIMEOUT_MS = 1500;

/**
 * Start screen after logging in and when the program opens with a session (docs/round-start-dashboard.md):
 * หน้าขาย (POS) / หลังบ้าน. Rendered from the stored session only (no server call is awaited), so offline
 * selling is never held up here: a selling device that cannot reach the server goes straight to the POS.
 * Keys: 1 = หน้าขาย, 2 = หลังบ้าน, ← / → move between the buttons, Enter opens the focused one.
 * Always shown (owner 2026-11-20), also to a cashier who may only sell: an option the user may not open is a
 * disabled button with the reason ("ไม่มีสิทธิ์เข้าหลังบ้าน"). Granting a right signs the user's sessions out (server
 * rule); after logging in again the button is active (the choices follow the stored profile).
 */
export default function StartPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const choices = useMemo(() => startChoices(user), [user]);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [ctx] = useState(() => ({
    sellingDevice: isSellingDevice(),
    sellingSetting: sellingDeviceSetting(),
    go: typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('go') : null,
  }));
  const decision = useMemo(() => startDecision(choices, { ...ctx, offline }), [choices, ctx, offline]);
  const [storeName] = useState(() => loadStoreSettings().storeName || 'ร้านปุริม POS');
  const posRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const leaving = useRef(false);

  const open = useCallback(
    (to: string) => {
      if (leaving.current) return;
      leaving.current = true;
      router.replace(to);
    },
    [router],
  );
  const choose = useCallback(
    (c: StartChoice) => {
      if (c === 'pos' && choices.pos) open('/pos');
      else if (c === 'backoffice' && choices.backOffice) open(choices.backOffice);
    },
    [choices, open],
  );

  // offline selling device, ?go=: no chooser
  useEffect(() => {
    if (decision.kind === 'go') open(decision.to);
  }, [decision, open]);

  // Can the server be reached? (never awaited before showing the buttons)
  useEffect(() => {
    if (offline) return;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PING_TIMEOUT_MS);
    fetch('/api/version', { cache: 'no-store', signal: ac.signal })
      .then((r) => { if (!r.ok) setOffline(true); })
      .catch(() => setOffline(true))
      .finally(() => clearTimeout(timer));
    const goneOffline = () => setOffline(true);
    window.addEventListener('offline', goneOffline);
    return () => { ac.abort(); clearTimeout(timer); window.removeEventListener('offline', goneOffline); };
  }, [offline]);

  // focus the pre-selected button (หน้าขาย unless this device is set to "ไม่ใช้ขาย")
  const recommended: StartChoice = decision.kind === 'choose' ? decision.recommended : 'pos';
  useEffect(() => {
    if (decision.kind !== 'choose') return;
    (recommended === 'backoffice' ? backRef : posRef).current?.focus();
  }, [decision.kind, recommended, choices]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.querySelector('[role="dialog"]')) return; // version dialog open
      if (e.key === '1') { e.preventDefault(); choose('pos'); }
      else if (e.key === '2') { e.preventDefault(); choose('backoffice'); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); (choices.pos ? posRef : backRef).current?.focus(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); (choices.backOffice ? backRef : posRef).current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, choices]);

  const logout = () => {
    performLogout();
    router.replace('/login');
  };

  if (decision.kind === 'go') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-slate-500">
            {decision.reason === 'offline' ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กำลังเปิดหน้าขาย (ขายแบบออฟไลน์ได้)...' : 'กำลังเปิด...'}
          </span>
        </div>
      </div>
    );
  }

  const userName = user?.fullName || user?.name || user?.username || '';
  const sellingHint = ctx.sellingSetting === false ? 'เครื่องนี้ตั้งค่าไม่ใช้ขาย' : ctx.sellingDevice ? 'เครื่องนี้ใช้ขายหน้าร้าน' : null;

  const btnBase =
    'group relative flex min-h-[200px] sm:min-h-[260px] w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 p-6 text-center shadow-sm transition-all cursor-pointer outline-none focus-visible:ring-4 focus:ring-4';
  const btnDisabled = 'disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:shadow-none disabled:ring-0';
  const posOk = choices.pos;
  const backOk = !!choices.backOffice;

  return (
    <main className="min-h-dvh bg-slate-100 px-4 py-6 sm:py-10 flex flex-col">
      <div className="mx-auto w-full max-w-4xl flex-1 flex flex-col gap-6">
        {/* shop, user, version, logout */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xs">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Store className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black text-slate-900" data-testid="start-store-name">{storeName}</h1>
              <p className="truncate text-sm text-slate-600">
                ผู้ใช้งาน: <span className="font-bold text-slate-800" data-testid="start-user-name">{userName}</span>
                {user?.role ? <span className="text-slate-500"> · {roleLabel(user.role)}</span> : null}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <VersionBadge />
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-bold text-rose-600 hover:bg-rose-50 hover:underline cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              ออกจากระบบ
            </button>
          </div>
        </header>

        {offline && (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            <WifiOff className="h-4 w-4 shrink-0" />
            เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในตอนนี้ หน้าขายยังขายแบบออฟไลน์ได้ ส่วนหลังบ้านต้องรอเชื่อมต่อ
          </div>
        )}

        <h2 className="text-center text-xl font-black text-slate-800 sm:text-2xl">เลือกหน้าที่ต้องการใช้งาน</h2>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2" role="group" aria-label="เลือกหน้าที่ต้องการใช้งาน">
          <button
            ref={posRef}
            type="button"
            data-testid="start-pos"
            disabled={!posOk}
            aria-describedby={posOk ? undefined : 'start-pos-denied'}
            onClick={() => choose('pos')}
            className={`${btnBase} ${btnDisabled} border-sky-300 bg-white hover:border-sky-500 hover:bg-sky-50 focus:border-sky-600 focus:ring-sky-200 ${recommended === 'pos' && posOk ? 'ring-4 ring-sky-200 border-sky-500' : ''}`}
          >
            {recommended === 'pos' && posOk && backOk && sellingHint && (
              <span className="absolute top-4 right-4 rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800">{sellingHint}</span>
            )}
            <span className={`flex h-20 w-20 items-center justify-center rounded-3xl text-white shadow-md transition-transform ${posOk ? 'bg-sky-500 group-hover:scale-105' : 'bg-slate-300'}`}>
              <ShoppingCart className="h-11 w-11" />
            </span>
            <span className={`text-3xl font-black ${posOk ? 'text-slate-900' : 'text-slate-400'}`}>หน้าขาย (POS)</span>
            {posOk ? (
              <span className="text-sm text-slate-600">ยิงบาร์โค้ด คิดเงิน พิมพ์ใบเสร็จ รับชำระหนี้</span>
            ) : (
              <DeniedNote id="start-pos-denied" text={NO_POS_TEXT} />
            )}
            {posOk && <kbd className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1 font-mono text-sm font-bold text-slate-700">กด 1</kbd>}
          </button>

          <button
            ref={backRef}
            type="button"
            data-testid="start-backoffice"
            disabled={!backOk}
            aria-describedby={backOk ? undefined : 'start-backoffice-denied'}
            onClick={() => choose('backoffice')}
            className={`${btnBase} ${btnDisabled} border-indigo-300 bg-white hover:border-indigo-500 hover:bg-indigo-50 focus:border-indigo-600 focus:ring-indigo-200 ${recommended === 'backoffice' && backOk ? 'ring-4 ring-indigo-200 border-indigo-500' : ''}`}
          >
            {recommended === 'backoffice' && posOk && backOk && sellingHint && (
              <span className="absolute top-4 right-4 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800">{sellingHint}</span>
            )}
            <span className={`flex h-20 w-20 items-center justify-center rounded-3xl text-white shadow-md transition-transform ${backOk ? 'bg-indigo-600 group-hover:scale-105' : 'bg-slate-300'}`}>
              <LayoutDashboard className="h-11 w-11" />
            </span>
            <span className={`text-3xl font-black ${backOk ? 'text-slate-900' : 'text-slate-400'}`}>หลังบ้าน</span>
            {backOk ? (
              <span className="text-sm text-slate-600">รายงาน สินค้า สต็อก ลูกหนี้ การเงิน ตั้งค่า</span>
            ) : (
              <DeniedNote id="start-backoffice-denied" text={NO_BACK_OFFICE_TEXT} />
            )}
            {backOk && <kbd className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1 font-mono text-sm font-bold text-slate-700">กด 2</kbd>}
          </button>
        </div>

        <p className="text-center text-xs text-slate-500">
          {posOk && backOk ? 'กด 1 หรือ 2 เพื่อเลือก' : posOk ? 'กด 1 หรือ Enter เพื่อเปิดหน้าขาย' : backOk ? 'กด 2 หรือ Enter เพื่อเปิดหลังบ้าน' : 'บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน กรุณาติดต่อผู้ดูแลร้าน'} · ใช้ปุ่มลูกศร ← → เลื่อนแล้วกด Enter · จากหน้าขายกลับมาหลังบ้านได้ที่ปุ่ม &quot;เมนูหลัก&quot;
        </p>
      </div>
    </main>
  );
}

/** Reason on a disabled start button; the owner grants the right at พนักงาน & สิทธิ์. */
function DeniedNote({ id, text }: { id: string; text: string }) {
  return (
    <span id={id} className="flex flex-col items-center gap-1">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-3 py-1 text-sm font-bold text-slate-700">
        <Lock className="h-4 w-4" />
        {text}
      </span>
      <span className="text-xs text-slate-500">ให้ผู้ดูแลร้านเพิ่มสิทธิ์ที่หน้า &quot;พนักงาน &amp; สิทธิ์&quot;</span>
    </span>
  );
}
