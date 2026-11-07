'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api';

export interface BuildInfo {
  source: string;
  commit: string | null;
  committedAt?: string | null;
  message?: string;
  branch?: string;
  modified?: boolean;
  label: string;
  builtAt?: string;
  installedAt?: string;
}

interface ServerVersion {
  running: BuildInfo | null;
  source: BuildInfo | null;
  upToDateWithSource: boolean | null;
  startedAt: string;
}

/** Version this web page was built from (stamped by next.config.ts). */
export function webBuildInfo(): BuildInfo {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_BUILD_INFO || '') as BuildInfo;
  } catch {
    return { source: 'unknown', commit: null, label: 'unknown' };
  }
}

type DesktopInfo = { kind: 'browser' } | { kind: 'app'; version: string } | { kind: 'old-app' };

async function desktopInfo(): Promise<DesktopInfo> {
  const api = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: { getAppVersion?: () => Promise<string> } }).electronAPI : undefined;
  if (!api) return { kind: 'browser' };
  if (!api.getAppVersion) return { kind: 'old-app' };
  try {
    return { kind: 'app', version: await api.getAppVersion() };
  } catch {
    return { kind: 'old-app' };
  }
}

const sameBuild = (a?: BuildInfo | null, b?: BuildInfo | null) =>
  Boolean(a?.commit && b?.commit && a.commit === b.commit && Boolean(a.modified) === Boolean(b.modified));

const fmt = (iso?: string | null) =>
  iso && !isNaN(Date.parse(iso))
    ? new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-';

function useVersionState() {
  const [server, setServer] = useState<ServerVersion | null>(null);
  const [desktop, setDesktop] = useState<DesktopInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const web = webBuildInfo();

  const load = useCallback(async () => {
    try {
      setServer((await apiFetch('/version')) as ServerVersion);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    setDesktop(await desktopInfo());
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const issues: { level: 'warn' | 'info'; text: string }[] = [];
  if (server?.upToDateWithSource === false && server.source) {
    issues.push({
      level: 'warn',
      text: `โค้ดในเครื่องแม่เป็นรุ่น ${server.source.label}${server.source.modified ? ' (+แก้ไข)' : ''} แต่ระบบยังรันรุ่น ${server.running?.label ?? '-'} — ต้อง build และเปิดเซิร์ฟเวอร์ใหม่ (Start > Purim POS Server > ติดตั้งหรือซ่อมระบบ)`,
    });
  }
  if (server?.running && web.commit && !sameBuild(web, server.running)) {
    issues.push({
      level: 'warn',
      text: `หน้าจอนี้เป็นรุ่น ${web.label} แต่ระบบหลังบ้านเป็นรุ่น ${server.running.label} — กด Ctrl+R เพื่อโหลดใหม่ ถ้ายังไม่หายให้ build หน้าเว็บใหม่`,
    });
  }
  if (desktop?.kind === 'old-app') {
    issues.push({ level: 'warn', text: 'แอป Purim POS ในเครื่องนี้เป็นรุ่นเก่า — ติดตั้ง Purim-POS-Client-Setup.exe ตัวล่าสุด' });
  }
  if (server?.source?.modified) {
    issues.push({ level: 'info', text: 'โค้ดในเครื่องแม่มีไฟล์ที่ถูกแก้ไขและยังไม่ได้ commit' });
  }
  const label = server?.running?.label || web.label;
  return { server, desktop, web, failed, issues, label, reload: load };
}

function Row({ name, value, sub }: { name: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs font-bold text-slate-500 shrink-0">{name}</span>
      <span className="text-right">
        <span className="block text-sm font-extrabold text-slate-900 font-mono">{value}</span>
        {sub && <span className="block text-[11px] text-slate-500">{sub}</span>}
      </span>
    </div>
  );
}

export function VersionDetails() {
  const { server, desktop, web, failed, issues, reload } = useVersionState();
  const running = server?.running;
  return (
    <div className="space-y-3">
      {issues.filter((i) => i.level === 'warn').length === 0 && !failed && server && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm font-bold text-emerald-800">
          ✓ ทุกส่วนเป็นรุ่นเดียวกัน
        </div>
      )}
      {issues.map((i, idx) => (
        <div
          key={idx}
          className={`rounded-lg px-3 py-2 text-sm font-bold border ${i.level === 'warn' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
        >
          {i.level === 'warn' ? '⚠ ' : 'ℹ '}
          {i.text}
        </div>
      ))}
      {failed && <div className="rounded-lg px-3 py-2 text-sm font-bold border bg-rose-50 border-rose-200 text-rose-800">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้</div>}

      <div className="rounded-xl border border-slate-200 px-3">
        <Row
          name="ระบบที่กำลังรัน (เครื่องแม่)"
          value={running?.label ?? '-'}
          sub={
            running ? (
              <>
                {running.message ? `“${running.message}”` : ''}
                <br />
                build เมื่อ {fmt(running.builtAt)} · เปิดเซิร์ฟเวอร์เมื่อ {fmt(server?.startedAt)}
              </>
            ) : undefined
          }
        />
        <Row
          name="โค้ดในเครื่องแม่"
          value={server?.source ? `${server.source.label}${server.source.modified ? ' +แก้ไข' : ''}` : '-'}
          sub={
            server?.source
              ? server.source.source === 'git'
                ? `จาก git ${server.source.branch ? `(branch ${server.source.branch})` : ''}`
                : `ติดตั้งจาก ${server.source.source === 'github' ? 'ปุ่มอัปเดต GitHub' : 'ตัวติดตั้ง'}${server.source.installedAt ? ` เมื่อ ${server.source.installedAt}` : ''}`
              : undefined
          }
        />
        <Row name="หน้าจอนี้ (เว็บ)" value={web.label} sub={`build เมื่อ ${fmt(web.builtAt)}`} />
        <Row
          name="แอปในเครื่องนี้"
          value={desktop?.kind === 'app' ? `v${desktop.version}` : desktop?.kind === 'old-app' ? 'รุ่นเก่า' : 'เปิดผ่านเบราว์เซอร์'}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <Link href="/monitor" className="font-bold text-indigo-600 hover:underline">
          มีรุ่นใหม่กว่าไหม? ตรวจที่ มอนิเตอร์ร้าน &gt; อัปเดตระบบ
        </Link>
        <button type="button" onClick={() => void reload()} className="font-bold text-slate-500 hover:text-slate-800 cursor-pointer">
          ↻ ตรวจอีกครั้ง
        </button>
      </div>
    </div>
  );
}

/** Small "version" line (sidebar footer) that opens the details. */
export function VersionBadge({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { label, issues } = useVersionState();
  const warn = issues.some((i) => i.level === 'warn');
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 text-[11px] font-mono font-bold cursor-pointer hover:underline ${warn ? 'text-amber-600' : 'text-slate-400 hover:text-slate-600'} ${className}`}
        title="ดูข้อมูลเวอร์ชัน"
      >
        {warn && <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
        <span>เวอร์ชัน {label}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ข้อมูลเวอร์ชันระบบ</DialogTitle>
            <DialogDescription>รุ่นของโปรแกรมที่กำลังใช้งาน (รุ่น = วันที่ · รหัส commit)</DialogDescription>
          </DialogHeader>
          {open && <VersionDetails />}
        </DialogContent>
      </Dialog>
    </>
  );
}
