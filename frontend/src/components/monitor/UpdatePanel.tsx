'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/** VERSION.json of the install / the latest GitHub Release (tag vX.Y.Z) */
interface VersionInfo {
  version?: string;
  tag?: string;
  url?: string;
  commit?: string;
  short?: string;
  message?: string;
  committedAt?: string;
  installedAt?: string;
  source?: string;
}

interface UpdateStatus {
  supported: boolean;
  installed: VersionInfo | null;
  tokenConfigured: boolean;
  /** client app version this server hands to cashier machines */
  clientApp?: string | null;
  running: boolean;
  status: { state: 'running' | 'done' | 'failed'; step: string; message: string; at: string } | null;
}

interface CheckResult {
  ok: boolean;
  message?: string;
  needToken?: boolean;
  upToDate?: boolean;
  installed?: VersionInfo | null;
  latest?: VersionInfo;
}

const STEPS: Record<string, string> = {
  start: 'เริ่มอัปเดต',
  check: 'ตรวจสอบเวอร์ชัน',
  download: 'ดาวน์โหลดจาก GitHub Releases',
  replace: 'แทนที่ไฟล์โปรแกรม',
  install: 'สำรองข้อมูล + อัปเดตฐานข้อมูล + build',
  end: 'เสร็จสิ้น',
};
const STEP_ORDER = ['start', 'check', 'download', 'replace', 'install', 'end'];

// releases are compared by tag (v1.5.0); installs made before v1.5 only know their commit
const short = (v?: VersionInfo | null) =>
  v?.tag || (v?.version ? `v${v.version}` : (v?.short || v?.commit?.slice(0, 7) || '-').toUpperCase());
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const pixelBtn = (bg: string, disabled = false): React.CSSProperties => ({
  background: disabled ? '#3f3a4a' : bg,
  border: '2px solid #0f0a16',
  boxShadow: disabled ? 'none' : '3px 3px 0 #0f0a16',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});

export function UpdatePanel() {
  const [info, setInfo] = useState<UpdateStatus | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<'check' | 'token' | 'run' | null>(null);
  const [token, setToken] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [offline, setOffline] = useState(false);
  const startedAt = useRef<number>(0);
  const [nowTs, setNowTs] = useState(0);

  const loadStatus = useCallback(async () => {
    try {
      const s = (await apiFetch('/server-control/update/status')) as UpdateStatus;
      setInfo(s);
      setNowTs(Date.now());
      setOffline(false);
      if (s.running) setWatching(true);
      return s;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOffline(true);
      return null;
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadStatus(), 0);
    return () => clearTimeout(t);
  }, [loadStatus]);

  // while an update runs the server restarts: keep polling until it reports done/failed
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(async () => {
      const s = await loadStatus();
      if (s && !s.running && s.status && s.status.state !== 'running' && Date.now() - startedAt.current > 5000) {
        setWatching(false);
        setCheck(null);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [watching, loadStatus]);

  const doCheck = async () => {
    setBusy('check');
    setError(null);
    try {
      const r = (await apiFetch('/server-control/update/check', { method: 'POST' })) as CheckResult;
      setCheck(r);
      if (!r.ok && !r.needToken) setError(r.message || 'ตรวจสอบไม่สำเร็จ');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const saveToken = async () => {
    setBusy('token');
    setError(null);
    try {
      await apiFetch('/server-control/update/token', { method: 'POST', body: JSON.stringify({ token: token.trim() }) });
      setToken('');
      await loadStatus();
      setBusy(null);
      await doCheck();
    } catch (e) {
      setError(errText(e));
      setBusy(null);
    }
  };

  const runUpdate = async () => {
    setBusy('run');
    setError(null);
    try {
      await apiFetch('/server-control/update/run', { method: 'POST' });
      startedAt.current = Date.now();
      setConfirming(false);
      setWatching(true);
      await loadStatus();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  if (info && !info.supported) {
    return (
      <p className="p-3 text-xs text-slate-400">
        อัปเดตจาก GitHub ใช้ได้บนเครื่องแม่ที่ติดตั้งด้วย Purim-POS-Server-Setup.exe เท่านั้น
      </p>
    );
  }

  const st = info?.status;
  const stepIdx = st ? STEP_ORDER.indexOf(st.step) : -1;
  const needToken = check?.needToken || (info && !info.tokenConfigured);

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-300">
        <span>เวอร์ชันที่ติดตั้ง</span>
        <span className="font-mono font-black text-slate-100 text-right">{short(info?.installed)}</span>
        {info?.installed?.installedAt && (
          <>
            <span>ติดตั้งเมื่อ</span>
            <span className="text-right text-slate-100">{info.installed.installedAt}</span>
          </>
        )}
        {info?.clientApp !== undefined && (
          <>
            <span>แอปเครื่องลูก (แจกให้เครื่องขาย)</span>
            <span className="font-mono font-black text-slate-100 text-right">{info.clientApp ? `v${info.clientApp}` : 'ยังไม่มี'}</span>
          </>
        )}
        {check?.latest && (
          <>
            <span>Release ล่าสุดบน GitHub</span>
            <span className="font-mono font-black text-right" style={{ color: check.upToDate ? '#4ade80' : '#fde047' }}>
              {short(check.latest)}
            </span>
          </>
        )}
      </div>
      {check?.latest?.message && (
        <p className="text-slate-400 break-words">
          “{check.latest.message}”{check.latest.committedAt ? ` · ${check.latest.committedAt}` : ''}
        </p>
      )}

      {/* progress of a running / finished update */}
      {(watching || (st && st.state !== 'done' && nowTs - Date.parse(st.at) < 3600_000)) && st && (
        <div className="p-2 bg-[#0f0a16] space-y-1.5">
          <div className="font-bold" style={{ color: st.state === 'failed' ? '#f87171' : st.state === 'done' ? '#4ade80' : '#38bdf8' }}>
            {st.state === 'running' ? '⏳ ' : st.state === 'done' ? '✅ ' : '❌ '}
            {st.message}
          </div>
          {st.state === 'running' && (
            <div className="flex gap-[2px]">
              {STEP_ORDER.slice(0, -1).map((k, i) => (
                <span
                  key={k}
                  title={STEPS[k]}
                  className={`h-2.5 flex-1 ${i === stepIdx ? 'animate-pulse' : ''}`}
                  style={{ background: i < stepIdx ? '#4ade80' : i === stepIdx ? '#38bdf8' : '#2a2236' }}
                />
              ))}
            </div>
          )}
          {watching && offline && <div className="text-[#facc15]">เซิร์ฟเวอร์กำลังรีสตาร์ท — หน้านี้จะกลับมาเอง (เครื่องขายใช้ไม่ได้ชั่วคราว)</div>}
          {st.state === 'done' && (
            <button type="button" onClick={() => window.location.reload()} className="w-full py-1.5 font-black text-[#0f0a16]" style={pixelBtn('#4ade80')}>
              ↻ โหลดหน้าใหม่เพื่อใช้เวอร์ชันล่าสุด
            </button>
          )}
        </div>
      )}

      {needToken && !watching && (
        <div className="space-y-1.5 p-2 bg-[#0f0a16]">
          <div className="font-bold text-[#facc15]">ใส่ GitHub token (อ่านอย่างเดียว) ครั้งแรกครั้งเดียว</div>
          <div className="text-slate-400 leading-relaxed">
            github.com &gt; Settings &gt; Developer settings &gt; Fine-grained tokens &gt; Generate new token · Repository: Purim-POS ·
            Contents: Read-only
          </div>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_..."
            autoComplete="off"
            className="w-full px-2 py-1.5 bg-[#1a1423] text-slate-100 font-mono outline-none"
            style={{ boxShadow: 'inset 0 0 0 2px #3d2f57' }}
          />
          <button
            type="button"
            disabled={busy !== null || token.trim().length < 20}
            onClick={saveToken}
            className="w-full py-1.5 font-black text-[#0f0a16]"
            style={pixelBtn('#facc15', busy !== null || token.trim().length < 20)}
          >
            {busy === 'token' ? 'กำลังตรวจสอบ token...' : '💾 บันทึก token'}
          </button>
        </div>
      )}

      {error && <div className="p-2 font-bold text-white bg-[#7f1d1d]">⚠ {error}</div>}

      {!watching && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={doCheck}
            className="w-full py-2 font-black text-slate-100"
            style={pixelBtn('#3b2f52', busy !== null)}
          >
            {busy === 'check' ? 'กำลังตรวจสอบ...' : '🔍 ตรวจสอบเวอร์ชันใหม่'}
          </button>
          {check?.ok && !check.upToDate && !confirming && (
            <button type="button" onClick={() => setConfirming(true)} className="w-full py-2 font-black text-[#0f0a16]" style={pixelBtn('#fde047')}>
              ⬆ อัปเดตเป็น {short(check.latest)}
            </button>
          )}
          {check?.ok && check.upToDate && <div className="text-center font-bold text-[#4ade80]">✓ เป็นเวอร์ชันล่าสุดแล้ว</div>}
          {confirming && (
            <div className="p-2 bg-[#0f0a16] space-y-2">
              <div className="text-[#fde68a] leading-relaxed">
                ระหว่างอัปเดต (ประมาณ 5-10 นาที) เครื่องขายทุกเครื่องจะใช้งานไม่ได้ ระบบจะสำรองข้อมูลก่อนเสมอ ควรทำตอนร้านปิด
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="py-1.5 font-black text-slate-100" style={pixelBtn('#475569')}>
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={runUpdate}
                  className="py-1.5 font-black text-white"
                  style={pixelBtn('#dc2626', busy !== null)}
                >
                  {busy === 'run' ? 'กำลังเริ่ม...' : 'อัปเดตเลย'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
