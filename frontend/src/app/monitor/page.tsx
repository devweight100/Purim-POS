'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { useAuthStore } from '@/lib/store/auth-store';
import { UpdatePanel } from '@/components/monitor/UpdatePanel';
import {
  W,
  drawScene,
  hashSeed,
  layoutSlots,
  type Action,
  type FloatText,
  type SceneTerminal,
  type Status,
} from '@/components/monitor/pixel-engine';

interface LiveCartItem {
  productId: string;
  name: string;
  unitName: string;
  price: number;
  quantity: number;
  total: number;
}

interface LiveState {
  activeAction: Action;
  actionDescription: string;
  actionTimestamp: string;
  customerName?: string;
  itemCount: number;
  totalAmount: number;
  discountAmount: number;
  cartItems: LiveCartItem[];
  alertLevel?: 'NORMAL' | 'WARNING' | 'ALERT';
}

interface Terminal {
  terminalId: string;
  terminalName: string;
  ipAddress: string;
  userName: string;
  status: Status;
  lastPingAt: string;
  latencyMs: number;
  todaySales: number;
  todayBills: number;
  lastOrderTime?: string;
  liveState?: LiveState;
  shift?: { userName: string; openedAt: string } | null;
}

interface Activity {
  id: string;
  timestamp: string;
  terminalName: string;
  type: string;
  description: string;
  amount?: number;
  terminalId?: string;
  userName?: string;
}

interface Telemetry {
  serverTime: string;
  uptimeSec: number;
  serverIp: string;
  database: { status: string; latencyMs: number };
  system: { memoryUsagePercent: number; usedMemMB: number; totalMemMB: number; cpuCores: number };
  todaySummary: { totalRevenue: number; totalBills: number; averageBill: number; cashRevenue: number; qrRevenue: number; creditRevenue: number };
  terminals: Terminal[];
  openShifts?: number;
  pendingApprovals?: number;
  recentActivity: Activity[];
}

interface LogLine {
  id: string;
  at: number;
  who: string;
  text: string;
  tone: 'info' | 'good' | 'warn' | 'bad' | 'gold';
}

const POLL_MS = 2000;
const MAX_LOG = 60;

const money = (n: number) =>
  '฿' + (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const ACTION_LABEL: Record<Action, string> = {
  IDLE: 'ว่าง รอลูกค้า',
  SCANNING: 'กำลังยิงสินค้า',
  PAYMENT: 'กำลังรับชำระเงิน',
  VOID: 'ลบสินค้าออกจากตะกร้า',
  DRAWER: 'เปิดลิ้นชักเงิน',
  CLAIM: 'ทำรายการเคลม/เปลี่ยนสินค้า',
};

const STATUS_LABEL: Record<Status, string> = {
  ACTIVE: 'ออนไลน์',
  ONLINE: 'ออนไลน์ (เงียบ)',
  IDLE: 'ไม่ตอบสนอง',
  OFFLINE: 'ออฟไลน์',
};

const TONE_COLOR: Record<LogLine['tone'], string> = {
  info: '#93c5fd',
  good: '#4ade80',
  warn: '#facc15',
  bad: '#f87171',
  gold: '#fde047',
};

/** Pixel-style panel: hard 2px border + stepped inner highlight. */
function Panel({ title, children, className = '', right }: { title?: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <section
      className={`relative bg-[#241b33] text-slate-100 ${className}`}
      style={{
        border: '3px solid #0f0a16',
        boxShadow: 'inset 2px 2px 0 #3d2f57, inset -2px -2px 0 #160f20, 4px 4px 0 #0f0a16',
      }}
    >
      {title && (
        <header className="flex items-center justify-between px-3 py-1.5 bg-[#3b2f52] border-b-[3px] border-[#0f0a16]">
          <h2 className="font-mono text-[11px] font-black tracking-widest text-[#fde68a] uppercase">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const cells = 10;
  const filled = Math.max(0, Math.min(cells, Math.round((value / Math.max(1, max)) * cells)));
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] font-bold text-slate-300 w-10 shrink-0">{label}</span>
      <div className="flex gap-[2px] p-[2px] bg-[#0f0a16]">
        {Array.from({ length: cells }).map((_, i) => (
          <span key={i} className="block w-2 h-3" style={{ background: i < filled ? color : '#2a2236' }} />
        ))}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, color }: { icon: string; label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1423]" style={{ boxShadow: 'inset 0 0 0 2px #0f0a16' }}>
      <span className="text-xl leading-none" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-mono text-[9px] font-bold tracking-widest text-slate-400 uppercase">{label}</div>
        <div className="font-mono text-base font-black leading-tight truncate" style={{ color }}>
          {value}
        </div>
      </div>
    </div>
  );
}

export default function MonitorPage() {
  const router = useRouter();
  const isAdmin = useAuthStore((st) => st.user?.role === 'ADMIN');
  const [data, setData] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevRef = useRef<Map<string, Terminal> | null>(null);
  const floatsRef = useRef<FloatText[]>([]);
  const sceneRef = useRef<{ terms: SceneTerminal[]; dbOnline: boolean; selectedId: string | null }>({
    terms: [],
    dbOnline: true,
    selectedId: null,
  });

  const terminals = useMemo(() => data?.terminals ?? [], [data]);
  const layout = useMemo(() => layoutSlots(terminals.length), [terminals.length]);
  const slots = layout.slots;
  const sceneH = layout.height;

  const pushLog = useCallback((lines: LogLine[]) => {
    if (!lines.length) return;
    setLog((prev) => [...lines.reverse(), ...prev].slice(0, MAX_LOG));
  }, []);

  // ------------------------------------------------------------ polling + event detection
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = (await apiFetch('/server-control/telemetry')) as Telemetry;
        if (!alive || !res) return;
        setError(null);
        const t = performance.now();
        const lines: LogLine[] = [];
        const prev = prevRef.current;
        const slotList = layoutSlots(res.terminals.length).slots;

        if (!prev) {
          // first load: seed the log with today's latest bills
          for (const a of [...res.recentActivity].slice(0, 8).reverse()) {
            lines.push({
              id: 'a-' + a.id,
              at: new Date(a.timestamp).getTime(),
              who: a.userName || a.terminalName,
              text: a.description,
              tone: a.type === 'CLAIM' ? 'info' : 'gold',
            });
          }
          lines.push({ id: 'boot-' + Date.now(), at: Date.now(), who: 'SERVER', text: `เริ่มมอนิเตอร์ — ออนไลน์ ${res.terminals.filter((x) => x.status === 'ACTIVE' || x.status === 'ONLINE').length} เครื่อง`, tone: 'info' });
        } else {
          res.terminals.forEach((term, i) => {
            const before = prev.get(term.terminalId);
            const who = term.userName || term.terminalName;
            const slot = slotList[i];
            const id = `${term.terminalId}-${Date.now()}`;
            const online = term.status === 'ACTIVE' || term.status === 'ONLINE';
            if (!before) {
              lines.push({ id: id + 'n', at: Date.now(), who, text: `${term.terminalName} เชื่อมต่อเข้ามา`, tone: 'good' });
              return;
            }
            const wasOnline = before.status === 'ACTIVE' || before.status === 'ONLINE';
            if (online && !wasOnline) lines.push({ id: id + 'on', at: Date.now(), who, text: `${term.terminalName} กลับมาออนไลน์`, tone: 'good' });
            if (!online && wasOnline) lines.push({ id: id + 'off', at: Date.now(), who, text: `${term.terminalName} ขาดการเชื่อมต่อ`, tone: 'bad' });
            if (before.userName !== term.userName && term.userName) lines.push({ id: id + 'u', at: Date.now(), who, text: `เปลี่ยนผู้ใช้เป็น ${term.userName}`, tone: 'info' });

            const a0 = before.liveState?.activeAction ?? 'IDLE';
            const a1 = term.liveState?.activeAction ?? 'IDLE';
            if (a0 !== a1 && a1 !== 'IDLE') {
              const tone: LogLine['tone'] = a1 === 'VOID' ? 'warn' : a1 === 'DRAWER' ? 'warn' : 'info';
              lines.push({ id: id + 'a', at: Date.now(), who, text: term.liveState?.actionDescription || ACTION_LABEL[a1], tone });
            }
            if (!before.shift && term.shift) lines.push({ id: id + 'so', at: Date.now(), who, text: 'เปิดกะ', tone: 'good' });
            if (before.shift && !term.shift) lines.push({ id: id + 'sc', at: Date.now(), who, text: 'ปิดกะ', tone: 'info' });

            const bills = term.todayBills - before.todayBills;
            const sales = term.todaySales - before.todaySales;
            if (bills > 0) {
              lines.push({ id: id + 'b', at: Date.now(), who, text: `ปิดบิล ${bills} ใบ ${sales >= 0 ? '+' : ''}${money(sales)}`, tone: 'gold' });
              if (slot) floatsRef.current.push({ x: slot.x + slot.w / 2, y: slot.y - 26, text: `+฿${Math.round(sales)}`, color: '#fde047', born: t });
            } else if (bills < 0 || sales < -0.01) {
              lines.push({ id: id + 'v', at: Date.now(), who, text: `ยอดลดลง ${money(sales)} (ยกเลิก/คืนสินค้า)`, tone: 'bad' });
              if (slot) floatsRef.current.push({ x: slot.x + slot.w / 2, y: slot.y - 26, text: `-฿${Math.round(Math.abs(sales))}`, color: '#f87171', born: t });
            }
          });
          prev.forEach((term, id) => {
            if (!res.terminals.some((x) => x.terminalId === id)) {
              lines.push({ id: id + '-gone-' + Date.now(), at: Date.now(), who: term.userName || term.terminalName, text: `${term.terminalName} หายไปจากเครือข่าย`, tone: 'bad' });
            }
          });
        }
        floatsRef.current = floatsRef.current.filter((f) => t - f.born < 2600);
        prevRef.current = new Map(res.terminals.map((x) => [x.terminalId, x]));
        setData(res);
        pushLog(lines);
      } catch (err) {
        if (!alive) return;
        const status = err instanceof ApiError ? err.status : 0;
        setError(
          status === 403
            ? 'บัญชีนี้ไม่มีสิทธิ์ดูรายงาน (ต้องมีสิทธิ์ VIEW_REPORTS)'
            : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — กำลังลองใหม่...',
        );
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [pushLog]);

  // ------------------------------------------------------------ scene state for the render loop
  useEffect(() => {
    sceneRef.current = {
      terms: terminals.map((term) => ({
        id: term.terminalId,
        status: term.status,
        action: term.status === 'OFFLINE' ? 'IDLE' : (term.liveState?.activeAction ?? 'IDLE'),
        alert: term.liveState?.alertLevel === 'ALERT' || term.liveState?.alertLevel === 'WARNING',
        hasShift: Boolean(term.shift),
        itemCount: term.liveState?.itemCount ?? 0,
        seed: hashSeed(term.userName + term.terminalId),
      })),
      dbOnline: (data?.database.status ?? 'ONLINE') === 'ONLINE',
      selectedId,
    };
  }, [terminals, data, selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 1000 / 30) return; // 30 fps is plenty for pixel art
      last = t;
      const s = sceneRef.current;
      const lay = layoutSlots(s.terms.length);
      if (canvas.height !== lay.height) canvas.height = lay.height;
      drawScene(ctx, t, s.terms, lay.slots, floatsRef.current, {
        dbOnline: s.dbOnline,
        selectedId: s.selectedId,
        height: lay.height,
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const selected = terminals.find((x) => x.terminalId === selectedId) || null;
  const onlineCount = terminals.filter((x) => x.status === 'ACTIVE' || x.status === 'ONLINE').length;
  const busyCount = terminals.filter((x) => x.status !== 'OFFLINE' && x.liveState && x.liveState.activeAction !== 'IDLE').length;
  const uptime = data ? `${Math.floor(data.uptimeSec / 3600)}h ${Math.floor((data.uptimeSec % 3600) / 60)}m` : '-';
  const dbLatency = data?.database.latencyMs ?? 0;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  return (
    <div className="min-h-dvh bg-[#150f1f] text-slate-100 p-3 sm:p-4" style={{ fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, "Noto Sans Thai", monospace' }}>
      {/* ---------------- top HUD */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/pos')}
            className="px-3 py-2 font-mono text-xs font-black bg-[#3b2f52] hover:bg-[#4a3b66] text-[#fde68a] cursor-pointer"
            style={{ boxShadow: '3px 3px 0 #0f0a16', border: '2px solid #0f0a16' }}
          >
            ◀ กลับ
          </button>
          <div>
            <h1 className="font-mono text-lg sm:text-xl font-black tracking-widest text-[#fde68a]" style={{ textShadow: '2px 2px 0 #0f0a16' }}>
              PURIM POS · STORE MONITOR
            </h1>
            <p className="text-[11px] text-slate-400">
              มอนิเตอร์เครื่องลูกข่ายแบบเรียลไทม์ · อัปเดตทุก {POLL_MS / 1000} วินาที · เซิร์ฟเวอร์ {data?.serverIp ?? '-'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-2xl font-black text-[#93c5fd]" style={{ textShadow: '2px 2px 0 #0f0a16' }}>
            {new Date(now).toLocaleTimeString('th-TH', { hour12: false })}
          </span>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="px-3 py-2 font-mono text-xs font-black bg-[#3b2f52] hover:bg-[#4a3b66] text-slate-100 cursor-pointer"
            style={{ boxShadow: '3px 3px 0 #0f0a16', border: '2px solid #0f0a16' }}
          >
            ⛶ เต็มจอ
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 font-mono text-sm font-bold bg-[#7f1d1d] text-white" style={{ border: '3px solid #0f0a16' }}>
          ⚠ {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 mb-3">
        <Stat icon="🖥️" label="Online" value={`${onlineCount} / ${terminals.length}`} color="#4ade80" />
        <Stat icon="⚔️" label="กำลังทำรายการ" value={busyCount} color="#38bdf8" />
        <Stat icon="🪙" label="ยอดขายวันนี้" value={money(data?.todaySummary.totalRevenue ?? 0)} color="#fde047" />
        <Stat icon="📜" label="บิลวันนี้" value={data?.todaySummary.totalBills ?? 0} color="#f8fafc" />
        <Stat icon="🗝️" label="กะที่เปิดอยู่" value={data?.openShifts ?? 0} color="#c084fc" />
        <Stat
          icon="🔔"
          label="รออนุมัติ"
          value={data?.pendingApprovals ?? 0}
          color={(data?.pendingApprovals ?? 0) > 0 ? '#f87171' : '#94a3b8'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-3">
        {/* ---------------- the pixel store */}
        <div className="space-y-3 min-w-0">
          <Panel
            title="Shop Floor"
            right={<span className="font-mono text-[10px] text-slate-300">คลิกที่เคาน์เตอร์เพื่อดูรายละเอียด</span>}
          >
            <div className="relative w-full" style={{ aspectRatio: `${W} / ${sceneH}` }}>
              <canvas
                ref={canvasRef}
                width={W}
                height={sceneH}
                className="absolute inset-0 w-full h-full"
                style={{ imageRendering: 'pixelated' }}
              />
              {terminals.map((term, i) => {
                const s = slots[i];
                if (!s) return null;
                const offline = term.status === 'OFFLINE';
                return (
                  <button
                    key={term.terminalId}
                    type="button"
                    onClick={() => setSelectedId((cur) => (cur === term.terminalId ? null : term.terminalId))}
                    className="absolute cursor-pointer group"
                    style={{
                      left: `${((s.x + s.w / 2 - layout.gap / 2 + 2) / W) * 100}%`,
                      top: `${((s.y - 28) / sceneH) * 100}%`,
                      width: `${((layout.gap - 4) / W) * 100}%`,
                      height: `${((s.h + 50) / sceneH) * 100}%`,
                    }}
                    aria-label={`${term.terminalName} ${term.userName}`}
                  >
                    <span
                      className="absolute left-1/2 -translate-x-1/2 bottom-0 max-w-full truncate whitespace-nowrap px-1.5 py-0.5 text-[10px] sm:text-xs font-bold leading-tight"
                      style={{
                        background: offline ? '#334155' : '#0f0a16',
                        color: offline ? '#94a3b8' : '#f8fafc',
                        boxShadow: `0 0 0 2px ${offline ? '#475569' : term.liveState?.alertLevel && term.liveState.alertLevel !== 'NORMAL' ? '#ef4444' : '#4ade80'}`,
                      }}
                    >
                      {term.terminalName.replace(/\s*\(.*\)$/, '')}
                    </span>
                  </button>
                );
              })}
              {data && terminals.length === 0 && (
                <div className="absolute inset-x-0 bottom-[18%] text-center">
                  <span className="inline-block px-3 py-1.5 font-bold text-sm bg-[#0f0a16]/90 text-slate-200" style={{ boxShadow: '0 0 0 2px #475569' }}>
                    ยังไม่มีเครื่องลูกเชื่อมต่อ — เปิดแอป Purim POS ที่เครื่องขายแล้วเข้าสู่ระบบ
                  </span>
                </div>
              )}
              {!data && !error && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="font-mono text-sm font-black text-[#fde68a] animate-pulse">LOADING...</span>
                </div>
              )}
            </div>
          </Panel>

          {/* ---------------- party list (one card per terminal) */}
          <Panel title={`Party · เครื่องในเครือข่าย (${terminals.length})`}>
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2 p-2">
              {terminals.length === 0 && <p className="text-sm text-slate-400 p-2">ยังไม่มีเครื่องลูกเชื่อมต่อ</p>}
              {terminals.map((term) => {
                const offline = term.status === 'OFFLINE';
                const action = offline ? null : (term.liveState?.activeAction ?? 'IDLE');
                const isSel = term.terminalId === selectedId;
                const statusColor =
                  term.status === 'ACTIVE' ? '#4ade80' : term.status === 'ONLINE' ? '#a3e635' : term.status === 'IDLE' ? '#facc15' : '#64748b';
                return (
                  <button
                    key={term.terminalId}
                    type="button"
                    onClick={() => setSelectedId(isSel ? null : term.terminalId)}
                    className="text-left p-2.5 bg-[#1a1423] hover:bg-[#2a2038] cursor-pointer"
                    style={{ boxShadow: `inset 0 0 0 2px ${isSel ? '#fde047' : '#0f0a16'}` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm truncate">{term.terminalName}</span>
                      <span className="flex items-center gap-1 font-mono text-[10px] font-black shrink-0" style={{ color: statusColor }}>
                        <span className="inline-block w-2 h-2" style={{ background: statusColor }} />
                        {STATUS_LABEL[term.status]}
                      </span>
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5 truncate">
                      👤 {term.userName}
                      {term.shift ? ` · กะของ ${term.shift.userName}` : ' · ไม่มีกะเปิด'}
                    </div>
                    <div className="text-xs mt-1 truncate" style={{ color: action === 'VOID' ? '#f87171' : action && action !== 'IDLE' ? '#38bdf8' : '#94a3b8' }}>
                      {offline ? (term.shift ? '⚠ กะยังเปิดอยู่ แต่เครื่องไม่ได้เชื่อมต่อ' : 'ไม่ได้ใช้งาน') : term.liveState?.actionDescription || ACTION_LABEL.IDLE}
                    </div>
                    <div className="flex items-center justify-between mt-1.5 font-mono text-[11px]">
                      <span className="text-[#fde047] font-black">🪙 {money(term.todaySales)}</span>
                      <span className="text-slate-400">{term.todayBills} บิล · {term.ipAddress}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* ---------------- right column */}
        <div className="space-y-3 min-w-0">
          {selected && (
            <Panel
              title="Inspect"
              right={
                <button type="button" onClick={() => setSelectedId(null)} className="font-mono text-xs text-slate-300 hover:text-white cursor-pointer">
                  ✕
                </button>
              }
            >
              <div className="p-3 space-y-2 text-sm">
                <div className="font-bold text-base">{selected.terminalName}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-300">
                  <span>ผู้ใช้</span>
                  <span className="text-slate-100 font-bold truncate">{selected.userName}</span>
                  <span>กะ</span>
                  <span className="text-slate-100 truncate">
                    {selected.shift ? `${selected.shift.userName} (เปิด ${new Date(selected.shift.openedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })})` : '-'}
                  </span>
                  <span>IP</span>
                  <span className="text-slate-100 font-mono">{selected.ipAddress}</span>
                  <span>สัญญาณล่าสุด</span>
                  <span className="text-slate-100">{Math.max(0, Math.round((now - new Date(selected.lastPingAt).getTime()) / 1000))} วินาทีที่แล้ว</span>
                  <span>ยอดวันนี้</span>
                  <span className="text-[#fde047] font-bold">
                    {money(selected.todaySales)} ({selected.todayBills} บิล)
                  </span>
                </div>
                <div className="pt-2 border-t-2 border-[#0f0a16]">
                  <div className="text-xs font-bold text-[#38bdf8] mb-1">
                    {selected.status === 'OFFLINE' ? 'ออฟไลน์' : selected.liveState?.actionDescription || ACTION_LABEL.IDLE}
                  </div>
                  {selected.status !== 'OFFLINE' && selected.liveState && selected.liveState.cartItems.length > 0 ? (
                    <div className="bg-[#0f0a16] p-2 max-h-56 overflow-y-auto">
                      {selected.liveState.customerName && <div className="text-xs text-slate-300 mb-1">ลูกค้า: {selected.liveState.customerName}</div>}
                      <table className="w-full text-xs">
                        <tbody>
                          {selected.liveState.cartItems.map((it, idx) => (
                            <tr key={`${it.productId}-${idx}`} className="align-top">
                              <td className="py-0.5 pr-2">{it.name}</td>
                              <td className="py-0.5 pr-2 text-right whitespace-nowrap text-slate-400">
                                {it.quantity} {it.unitName}
                              </td>
                              <td className="py-0.5 text-right whitespace-nowrap font-mono">{money(it.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex justify-between mt-1.5 pt-1.5 border-t border-slate-700 font-bold">
                        <span>รวม {selected.liveState.itemCount} ชิ้น</span>
                        <span className="text-[#fde047] font-mono">{money(selected.liveState.totalAmount)}</span>
                      </div>
                      {selected.liveState.discountAmount > 0 && (
                        <div className="text-right text-xs text-[#f87171]">ส่วนลด {money(selected.liveState.discountAmount)}</div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">ตะกร้าว่าง</p>
                  )}
                </div>
              </div>
            </Panel>
          )}

          {isAdmin && (
            <Panel title="อัปเดตระบบ (GitHub)">
              <UpdatePanel />
            </Panel>
          )}

          <Panel title="Server Status">
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">ฐานข้อมูล</span>
                <span className="font-mono font-black" style={{ color: data?.database.status === 'ONLINE' ? '#4ade80' : '#f87171' }}>
                  {data?.database.status ?? '-'} · {dbLatency}ms
                </span>
              </div>
              <Bar label="DB" value={Math.max(0, 200 - Math.min(200, dbLatency))} max={200} color={dbLatency < 50 ? '#4ade80' : dbLatency < 150 ? '#facc15' : '#f87171'} />
              <Bar
                label="RAM"
                value={data?.system.memoryUsagePercent ?? 0}
                max={100}
                color={(data?.system.memoryUsagePercent ?? 0) < 75 ? '#38bdf8' : (data?.system.memoryUsagePercent ?? 0) < 90 ? '#facc15' : '#f87171'}
              />
              <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-300 pt-1">
                <span>Uptime</span>
                <span className="text-right font-mono text-slate-100">{uptime}</span>
                <span>เงินสด / โอน</span>
                <span className="text-right font-mono text-slate-100">
                  {money(data?.todaySummary.cashRevenue ?? 0)} / {money(data?.todaySummary.qrRevenue ?? 0)}
                </span>
                <span>ขายเชื่อ</span>
                <span className="text-right font-mono text-slate-100">{money(data?.todaySummary.creditRevenue ?? 0)}</span>
                <span>เฉลี่ยต่อบิล</span>
                <span className="text-right font-mono text-slate-100">{money(data?.todaySummary.averageBill ?? 0)}</span>
              </div>
            </div>
          </Panel>

          <Panel title="Event Log">
            <ol className="p-2 space-y-1 max-h-[420px] overflow-y-auto text-xs">
              {log.length === 0 && <li className="text-slate-400 p-1">รอเหตุการณ์...</li>}
              {log.map((l) => (
                <li key={l.id} className="px-2 py-1 bg-[#1a1423]" style={{ borderLeft: `3px solid ${TONE_COLOR[l.tone]}` }}>
                  <span className="font-mono text-[10px] text-slate-500 mr-1.5">{timeOf(l.at)}</span>
                  <span className="font-bold mr-1" style={{ color: TONE_COLOR[l.tone] }}>
                    [{l.who}]
                  </span>
                  <span className="text-slate-200">{l.text}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Legend">
            <ul className="p-3 grid grid-cols-2 gap-1.5 text-[11px] text-slate-300">
              <li><span className="inline-block w-2.5 h-2.5 mr-1.5 bg-[#4ade80]" />จอเขียว = ว่าง</li>
              <li><span className="inline-block w-2.5 h-2.5 mr-1.5 bg-[#38bdf8]" />จอฟ้า = ยิงสินค้า</li>
              <li><span className="inline-block w-2.5 h-2.5 mr-1.5 bg-[#facc15]" />จอเหลือง = รับเงิน</li>
              <li><span className="inline-block w-2.5 h-2.5 mr-1.5 bg-[#fb923c]" />จอส้ม = เปิดลิ้นชัก</li>
              <li><span className="inline-block w-2.5 h-2.5 mr-1.5 bg-[#c084fc]" />จอม่วง = เคลม</li>
              <li><span className="inline-block w-2.5 h-2.5 mr-1.5 bg-[#ef4444]" />! แดง = ลบสินค้า/เตือน</li>
              <li><span className="inline-block w-2.5 h-2.5 mr-1.5 bg-[#64748b]" />Z = ออฟไลน์</li>
              <li><span className="inline-block w-2.5 h-2.5 mr-1.5 bg-[#fb923c]" />Z ส้ม = กะค้าง</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
