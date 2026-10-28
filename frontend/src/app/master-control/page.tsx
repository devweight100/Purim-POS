'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Server, Cpu, HardDrive, Activity, Terminal, Shield, Zap, RefreshCw, 
  Wifi, Database, Radio, Copy, Check, QrCode, PlayCircle, BarChart3, 
  AlertTriangle, Disc, ArrowUpRight, Clock, MonitorCheck, ShoppingCart, 
  Receipt, Users, ExternalLink, Download, FileText, Eye, EyeOff,
  Camera, ShieldCheck, ShoppingBag, AlertCircle, MonitorPlay
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface LiveCartItem {
  productId: string;
  name: string;
  barcode?: string;
  unitName: string;
  price: number;
  quantity: number;
  total: number;
}

interface TerminalLiveState {
  activeAction: 'IDLE' | 'SCANNING' | 'PAYMENT' | 'VOID' | 'DRAWER' | 'CLAIM';
  actionDescription: string;
  actionTimestamp: string;
  customerName?: string;
  itemCount: number;
  totalAmount: number;
  discountAmount: number;
  cartItems: LiveCartItem[];
  alertLevel?: 'NORMAL' | 'WARNING' | 'ALERT';
  screenSnapshot?: string;
}

interface TerminalItem {
  terminalId: string;
  terminalName: string;
  ipAddress: string;
  userName: string;
  status: 'ONLINE' | 'ACTIVE' | 'IDLE' | 'OFFLINE';
  lastPingAt: string;
  latencyMs: number;
  todaySales: number;
  todayBills: number;
  lastOrderTime?: string;
  liveState?: TerminalLiveState;
}

interface ActivityItem {
  id: string;
  timestamp: string;
  terminalName: string;
  type: string;
  description: string;
  amount?: number;
  badgeColor?: string;
}

interface TelemetryData {
  serverTime: string;
  uptimeSec: number;
  serverIp: string;
  serverPort: number | string;
  frontendPort: number | string;
  database: {
    status: string;
    latencyMs: number;
    engine: string;
    databaseName: string;
    storageDrive: string;
  };
  system: {
    platform: string;
    cpuModel: string;
    cpuCores: number;
    memoryUsagePercent: number;
    usedMemMB: number;
    totalMemMB: number;
    processRssMB: number;
  };
  todaySummary: {
    totalRevenue: number;
    totalBills: number;
    averageBill: number;
    cashRevenue: number;
    qrRevenue: number;
    creditRevenue: number;
  };
  terminals: TerminalItem[];
  recentActivity: ActivityItem[];
}

export default function MasterControlPage() {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [audioBeep, setAudioBeep] = useState(false);
  const [selectedMonitorTerminalId, setSelectedMonitorTerminalId] = useState<string | null>(null);

  const monitoredTerminal = data?.terminals?.find(t => t.terminalId === selectedMonitorTerminalId) || null;

  const prevBillsCount = useRef<number>(0);

  const fetchTelemetry = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = (await apiFetch('/server-control/telemetry')) as TelemetryData;
      if (res) {
        setData(res);
        // Play subtle telemetry sound or notification if a new bill completed
        if (prevBillsCount.current > 0 && res.todaySummary.totalBills > prevBillsCount.current) {
          toast.success(`⚡ [NEW SALE] มีการชำระเงินใหม่เข้ามาในระบบ! รวม ${res.todaySummary.totalBills} บิลแล้ว`);
        }
        prevBillsCount.current = res.todaySummary.totalBills;
      }
    } catch (err) {
      console.warn('Failed to fetch telemetry:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    // Auto-refresh telemetry every 4 seconds (Real-time Radar Poll)
    const interval = setInterval(() => {
      fetchTelemetry(true);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hrs = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${days > 0 ? `${days}d ` : ''}${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const copyServerUrl = () => {
    if (!data?.serverIp) return;
    const url = `http://${data.serverIp}:${data.frontendPort || 3000}`;
    navigator.clipboard.writeText(url);
    setCopiedIp(true);
    toast.success(`คัดลอก Server URL: ${url} แล้ว`);
    setTimeout(() => setCopiedIp(false), 2000);
  };

  const handleInstantBackup = async () => {
    setIsBackingUp(true);
    try {
      // Create local timestamped JSON backup snapshot
      const backupPayload = {
        exportedAt: new Date().toISOString(),
        serverIp: data?.serverIp,
        metrics: data?.todaySummary,
        terminals: data?.terminals,
      };
      const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `purim_pos_backup_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('💾 ส่งออกไฟล์สำรองข้อมูล (Backup Snapshot) สำเร็จ!');
    } catch {
      toast.error('ไม่สามารถสร้างไฟล์สำรองข้อมูลได้');
    } finally {
      setIsBackingUp(false);
    }
  };

  const clientUrl = data ? `http://${data.serverIp}:${data.frontendPort || 3000}` : 'http://localhost:3000';

  return (
    <div className="min-h-screen bg-[#060913] text-slate-100 font-sans p-4 sm:p-6 lg:p-8 selection:bg-cyan-500 selection:text-black">
      
      {/* ─── HUD TOP COMMAND BAR ─── */}
      <div className="relative border border-cyan-900/60 bg-[#0b1329]/80 backdrop-blur-md rounded-2xl p-4 sm:p-5 mb-6 shadow-[0_0_30px_rgba(0,240,255,0.08)] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="relative flex items-center justify-center w-12 h-12 rounded-xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-400 shadow-[0_0_15px_rgba(0,240,255,0.3)]">
            <Radio className="w-6 h-6 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black tracking-wider text-white font-mono uppercase">
                PURIM MASTER COMMAND
              </h1>
              <span className="text-[10px] bg-cyan-950 border border-cyan-500/50 text-cyan-300 px-2 py-0.5 rounded-full font-bold tracking-widest animate-pulse">
                LIVE TELEMETRY
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium mt-0.5 flex items-center gap-2">
              <span>ศูนย์ควบคุมเซิร์ฟเวอร์หลัก (เครื่องแม่) & ตรวจสอบสถานะเครื่องลูกข่าย</span>
              <span>•</span>
              <span className="font-mono text-emerald-400 font-bold">NODE: ONLINE</span>
            </p>
          </div>
        </div>

        {/* Server IP Connect Card */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="bg-[#050b18] border border-cyan-800/60 rounded-xl px-3.5 py-2 flex items-center gap-3 shadow-inner">
            <div className="flex flex-col">
              <span className="text-[10px] text-cyan-400 uppercase font-bold tracking-widest font-mono">
                IP เครื่องแม่สำหรับเครื่องลูก
              </span>
              <span className="text-base sm:text-lg font-black font-mono text-[#00f0ff] drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]">
                {clientUrl}
              </span>
            </div>
            <button
              onClick={copyServerUrl}
              className="p-2 hover:bg-cyan-950/80 text-cyan-300 hover:text-white rounded-lg border border-cyan-700/50 transition-all cursor-pointer"
              title="คัดลอก URL เพื่อไปใส่ที่เครื่องลูก"
            >
              {copiedIp ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setShowQrModal(true)}
              className="p-2 hover:bg-cyan-950/80 text-cyan-300 hover:text-white rounded-lg border border-cyan-700/50 transition-all cursor-pointer"
              title="แสดง QR Code สำหรับมือถือ/แท็บเล็ตสแกนเข้าใช้งาน"
            >
              <QrCode className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => fetchTelemetry()}
            disabled={refreshing}
            className="h-11 px-4 bg-cyan-600 hover:bg-cyan-500 text-black font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(0,240,255,0.4)] flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span>รีเฟรช</span>
          </button>
        </div>
      </div>

      {/* ─── ROW 1: PRIMARY METRIC CARDS ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        
        {/* Metric 1: Total Revenue Today */}
        <div className="relative overflow-hidden rounded-2xl bg-[#0b1329]/90 border border-emerald-500/40 p-5 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 font-mono flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" /> ยอดขายรวมวันนี้ (ทุกเครื่อง)
            </span>
            <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
              REAL-TIME
            </span>
          </div>
          <div className="text-3xl lg:text-4xl font-black font-mono text-[#00ff9d] drop-shadow-[0_0_10px_rgba(0,255,157,0.7)]">
            {formatCurrency(data?.todaySummary?.totalRevenue || 0)}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 font-mono border-t border-emerald-950/60 pt-2.5">
            <span>เงินสด: ฿{(data?.todaySummary?.cashRevenue || 0).toLocaleString()}</span>
            <span>โอน/QR: ฿{(data?.todaySummary?.qrRevenue || 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Metric 2: Connected Terminals */}
        <div className="relative overflow-hidden rounded-2xl bg-[#0b1329]/90 border border-cyan-500/40 p-5 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 font-mono flex items-center gap-1.5">
              <MonitorCheck className="w-3.5 h-3.5" /> เครื่องลูกที่เชื่อมต่ออยู่
            </span>
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl lg:text-4xl font-black font-mono text-[#00f0ff] drop-shadow-[0_0_10px_rgba(0,240,255,0.7)]">
              {(data?.terminals || []).filter(t => t.status === 'ACTIVE' || t.status === 'ONLINE').length}
            </span>
            <span className="text-sm font-bold text-slate-400 font-mono">
              / {(data?.terminals || []).length} เครื่องในระบบ
            </span>
          </div>
          <div className="mt-3 text-xs text-slate-400 font-mono border-t border-cyan-950/60 pt-2.5 flex items-center justify-between">
            <span>สถานะระบบเครือข่าย</span>
            <span className="text-cyan-300 font-bold">LAN / Wi-Fi Active</span>
          </div>
        </div>

        {/* Metric 3: Total Transactions / Bills */}
        <div className="relative overflow-hidden rounded-2xl bg-[#0b1329]/90 border border-purple-500/40 p-5 shadow-[0_0_20px_rgba(168,85,247,0.1)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-400 font-mono flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5" /> จำนวนบิลวันนี้
            </span>
            <span className="text-[10px] text-purple-300 font-mono bg-purple-950/80 px-2 py-0.5 rounded border border-purple-500/30">
              TRANSACTIONS
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl lg:text-4xl font-black font-mono text-[#d8b4fe] drop-shadow-[0_0_10px_rgba(216,180,254,0.7)]">
              {data?.todaySummary?.totalBills || 0}
            </span>
            <span className="text-sm font-bold text-slate-400 font-mono">บิลสำเร็จ</span>
          </div>
          <div className="mt-3 text-xs text-slate-400 font-mono border-t border-purple-950/60 pt-2.5 flex items-center justify-between">
            <span>ยอดเฉลี่ยต่อบิล</span>
            <span className="text-purple-300 font-bold">
              {formatCurrency(data?.todaySummary?.averageBill || 0)}
            </span>
          </div>
        </div>

        {/* Metric 4: Database & Server Health */}
        <div className="relative overflow-hidden rounded-2xl bg-[#0b1329]/90 border border-amber-500/40 p-5 shadow-[0_0_20px_rgba(245,158,11,0.1)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 font-mono flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" /> ฐานข้อมูล (PostgreSQL)
            </span>
            <span className="text-[10px] text-amber-300 font-mono bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/30">
              {data?.database?.status || 'ONLINE'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-black font-mono text-amber-300">
              {data?.database?.latencyMs !== undefined ? `${data.database.latencyMs} ms` : '1.2 ms'}
            </span>
            <span className="text-xs text-slate-400 font-mono">Ping Latency</span>
          </div>
          <div className="mt-3 text-xs text-slate-400 font-mono border-t border-amber-950/60 pt-2.5 flex items-center justify-between">
            <span>Uptime:</span>
            <span className="text-amber-200 font-bold font-mono">
              {data ? formatUptime(data.uptimeSec) : '00:00:00'}
            </span>
          </div>
        </div>

      </div>

      {/* ─── ROW 2: TERMINALS MATRIX & LIVE ACTIVITY ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        
        {/* Left: Terminals Matrix Table (8 cols) */}
        <div className="lg:col-span-8 bg-[#0b1329]/80 border border-cyan-900/60 rounded-2xl p-5 shadow-xl flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-cyan-950 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full bg-cyan-400 animate-pulse" />
              <h2 className="text-lg font-bold font-mono text-cyan-300 tracking-wider uppercase">
                CONNECTED POS TERMINALS (เครื่องลูกข่ายหน้าร้าน)
              </h2>
            </div>
            <span className="text-xs font-mono text-slate-400">
              อัปเดตอัตโนมัติทุก 4 วินาที
            </span>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-[#050b18] text-cyan-400/80 uppercase tracking-wider border-b border-cyan-900/60">
                <tr>
                  <th className="py-3 px-3">เครื่อง / รหัส</th>
                  <th className="py-3 px-3">IP Address</th>
                  <th className="py-3 px-3">ผู้ใช้งาน</th>
                  <th className="py-3 px-3">สถานะสด (Digital Twin)</th>
                  <th className="py-3 px-3 text-right">ยอดขายวันนี้</th>
                  <th className="py-3 px-3 text-center">จำนวนบิล</th>
                  <th className="py-3 px-3 text-center">ส่องหน้าจอสด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyan-950/60">
                {(data?.terminals || []).map((term) => {
                  const isOnline = term.status === 'ACTIVE' || term.status === 'ONLINE';
                  return (
                    <tr key={term.terminalId} className="hover:bg-cyan-950/30 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-bold text-white flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-cyan-400' : 'bg-slate-600'}`} />
                          <span>{term.terminalName}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">{term.terminalId}</span>
                      </td>
                      <td className="py-3 px-3 text-cyan-300 font-mono">
                        {term.ipAddress}
                        <span className="block text-[10px] text-slate-500">{term.latencyMs}ms ping</span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {term.userName}
                      </td>
                      <td className="py-3 px-3">
                        {term.liveState?.activeAction === 'SCANNING' ? (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                            <span className="truncate max-w-[170px]" title={term.liveState.actionDescription}>
                              🛒 ยิงสินค้า ({term.liveState.itemCount} ชิ้น - ฿{term.liveState.totalAmount.toLocaleString()})
                            </span>
                          </div>
                        ) : term.liveState?.activeAction === 'PAYMENT' ? (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                            <span className="truncate max-w-[170px]">
                              💳 ชำระเงิน (฿{term.liveState.totalAmount.toLocaleString()})
                            </span>
                          </div>
                        ) : term.liveState?.activeAction === 'VOID' ? (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-500/50 text-rose-300 text-[11px] font-bold animate-pulse">
                            <AlertCircle className="w-3 h-3 text-rose-400" />
                            <span className="truncate max-w-[170px]">
                              ⚠️ มีการลบสินค้าในบิล!
                            </span>
                          </div>
                        ) : term.liveState?.activeAction === 'DRAWER' ? (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-950/70 border border-purple-500/40 text-purple-300 text-[11px] font-bold">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                            <span>💵 เปิดลิ้นชักเก็บเงิน</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/50 border border-slate-800 text-slate-400 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                            <span>💤 ว่าง (พร้อมบริการ)</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-base text-[#00ff9d]">
                        {formatCurrency(term.todaySales)}
                      </td>
                      <td className="py-3 px-3 text-center font-bold text-slate-200">
                        {term.todayBills}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedMonitorTerminalId(term.terminalId)}
                          className="px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:border-cyan-400 transition-all font-bold text-xs flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(0,240,255,0.15)] hover:shadow-[0_0_15px_rgba(0,240,255,0.3)] cursor-pointer mx-auto"
                        >
                          <Eye className="w-3.5 h-3.5 text-cyan-400" />
                          <span>ส่องจอสด</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Live Terminal Event Feed / Console Stream (4 cols) */}
        <div className="lg:col-span-4 bg-[#0b1329]/80 border border-cyan-900/60 rounded-2xl p-5 shadow-xl flex flex-col h-full">
          <div className="flex items-center justify-between pb-4 border-b border-cyan-950 mb-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold font-mono text-emerald-400 tracking-wider uppercase">
                EVENT STREAM (LOGS)
              </h2>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 border border-emerald-500/30 px-2 py-0.5 rounded">
              LIVE
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[360px] pr-1 font-mono text-xs no-scrollbar">
            {(data?.recentActivity || []).length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                ยังไม่มีรายการบันทึกในวันนี้
              </div>
            ) : (
              (data?.recentActivity || []).map((act) => {
                const timeStr = new Date(act.timestamp).toLocaleTimeString('th-TH');
                return (
                  <div key={act.id} className="p-2.5 rounded-xl bg-[#050b18] border border-cyan-950 hover:border-cyan-800 transition-all text-xs flex items-start gap-2">
                    <span className="text-[10px] text-cyan-400/70 shrink-0 mt-0.5">[{timeStr}]</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-white truncate">{act.terminalName}</span>
                        {act.amount !== undefined && act.amount > 0 && (
                          <span className="text-[#00ff9d] font-bold text-xs shrink-0">
                            +{formatCurrency(act.amount)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">{act.description}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* ─── ROW 3: SERVER CONTROLS & SYSTEM HEALTH ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* System Specs (7 cols) */}
        <div className="lg:col-span-7 bg-[#0b1329]/80 border border-cyan-900/60 rounded-2xl p-5 shadow-xl">
          <h3 className="text-sm font-bold font-mono text-cyan-300 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            SERVER HARDWARE & STORAGE TELEMETRY
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-3.5 rounded-xl bg-[#050b18] border border-cyan-950">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-bold block mb-1">CPU Processor</span>
              <span className="text-xs font-bold text-white block truncate">{data?.system?.cpuModel || 'Intel / AMD Processor'}</span>
              <span className="text-[10px] text-cyan-400 font-mono mt-1 block">{data?.system?.cpuCores || 4} Logical Cores</span>
            </div>

            <div className="p-3.5 rounded-xl bg-[#050b18] border border-cyan-950">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] text-slate-400 uppercase font-mono font-bold">Memory RAM</span>
                <span className="text-[10px] font-bold text-emerald-400 font-mono">{data?.system?.memoryUsagePercent || 0}%</span>
              </div>
              <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden mb-1.5 border border-cyan-950">
                <div 
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${data?.system?.memoryUsagePercent || 0}%` }} 
                />
              </div>
              <span className="text-[10px] text-slate-400 font-mono block">
                {data?.system?.usedMemMB?.toLocaleString()} / {data?.system?.totalMemMB?.toLocaleString()} MB
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-[#050b18] border border-cyan-950">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-bold block mb-1">Database Drive</span>
              <span className="text-xs font-bold text-amber-300 block font-mono">{data?.database?.storageDrive || 'D:\\'}</span>
              <span className="text-[10px] text-slate-400 font-mono mt-1 block">
                Engine: {data?.database?.engine || 'PostgreSQL 16'}
              </span>
            </div>
          </div>
        </div>

        {/* Master Action Tools (5 cols) */}
        <div className="lg:col-span-5 bg-[#0b1329]/80 border border-cyan-900/60 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <h3 className="text-sm font-bold font-mono text-cyan-300 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            MASTER CONTROLS & MAINTENANCE
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleInstantBackup}
              disabled={isBackingUp}
              className="p-3.5 rounded-xl bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/40 text-cyan-200 text-xs font-bold font-mono flex flex-col items-center justify-center gap-2 transition-all cursor-pointer shadow-sm hover:shadow-[0_0_15px_rgba(0,240,255,0.2)] disabled:opacity-50"
            >
              <Download className="w-5 h-5 text-cyan-400" />
              <span>{isBackingUp ? 'กำลังสำรอง...' : '1-Click Backup'}</span>
            </button>

            <a
              href="/pos"
              className="p-3.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/40 text-emerald-200 text-xs font-bold font-mono flex flex-col items-center justify-center gap-2 transition-all cursor-pointer shadow-sm hover:shadow-[0_0_15px_rgba(16,185,129,0.2)]"
            >
              <ShoppingCart className="w-5 h-5 text-emerald-400" />
              <span>เปิดหน้าขาย POS</span>
            </a>

            <a
              href="/dashboard"
              className="p-3.5 rounded-xl bg-purple-950/60 hover:bg-purple-900/80 border border-purple-500/40 text-purple-200 text-xs font-bold font-mono flex flex-col items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
            >
              <BarChart3 className="w-5 h-5 text-purple-400" />
              <span>แดชบอร์ดรายงาน</span>
            </a>

            <a
              href="/orders"
              className="p-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold font-mono flex flex-col items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <FileText className="w-5 h-5 text-slate-400" />
              <span>ประวัติการขาย</span>
            </a>
          </div>
        </div>

      </div>

      {/* ─── QR Code Modal for Client Connect ─── */}
      <Dialog open={showQrModal} onOpenChange={setShowQrModal}>
        <DialogContent className="bg-[#0b1329] border border-cyan-800 text-white sm:max-w-md rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold font-mono text-[#00f0ff] flex items-center gap-2">
              <QrCode className="w-6 h-6 text-cyan-400" />
              เชื่อมต่อเครื่องแม่ (Client Connection)
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs mt-1">
              นำมือถือ แท็บเล็ต หรือเครื่องลูกมาพิมพ์ที่อยู่ URL นี้ในเบราว์เซอร์ เพื่อเปิดใช้งานระบบขายหน้าร้านได้ทันที
            </DialogDescription>
          </DialogHeader>

          <div className="py-6 flex flex-col items-center justify-center space-y-4">
            <div className="p-4 bg-white rounded-2xl shadow-lg border-4 border-cyan-500/50">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(clientUrl)}`} 
                alt="QR Code Server URL" 
                className="w-48 h-48"
              />
            </div>

            <div className="text-center font-mono space-y-1">
              <span className="text-xs text-slate-400 uppercase">URL สำหรับเครื่องลูก:</span>
              <div className="text-lg font-bold text-[#00f0ff] bg-[#050b18] px-4 py-2 rounded-xl border border-cyan-900">
                {clientUrl}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Sci-Fi CCTV Digital Twin Surveillance Modal ─── */}
      <Dialog open={Boolean(selectedMonitorTerminalId)} onOpenChange={(open) => { if (!open) setSelectedMonitorTerminalId(null); }}>
        <DialogContent className="bg-[#070e1e] border-2 border-cyan-500 text-white max-w-4xl rounded-3xl p-6 shadow-[0_0_60px_rgba(0,240,255,0.3)]">
          <DialogHeader className="border-b border-cyan-950 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
                </span>
                <div>
                  <DialogTitle className="text-lg font-black font-mono text-[#00f0ff] tracking-wider flex items-center gap-2">
                    <MonitorPlay className="w-5 h-5 text-cyan-400" />
                    LIVE SURVEILLANCE FEED: {monitoredTerminal?.terminalName || 'จุดขาย'}
                  </DialogTitle>
                  <DialogDescription className="text-slate-400 text-xs font-mono mt-0.5">
                    แคชเชียร์: <span className="text-white font-bold">{monitoredTerminal?.userName || '-'}</span> | IP: <span className="text-cyan-300">{monitoredTerminal?.ipAddress}</span> ({monitoredTerminal?.latencyMs}ms)
                  </DialogDescription>
                </div>
              </div>

              {/* Status Action Pill */}
              <div>
                {monitoredTerminal?.liveState?.activeAction === 'SCANNING' ? (
                  <span className="px-3 py-1 rounded-full bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-xs font-bold font-mono flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    🛒 กำลังยิงสินค้า
                  </span>
                ) : monitoredTerminal?.liveState?.activeAction === 'PAYMENT' ? (
                  <span className="px-3 py-1 rounded-full bg-cyan-950 border border-cyan-500/50 text-cyan-300 text-xs font-bold font-mono flex items-center gap-1.5 shadow-[0_0_10px_rgba(0,240,255,0.3)]">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    💳 กำลังชำระเงิน
                  </span>
                ) : monitoredTerminal?.liveState?.activeAction === 'VOID' ? (
                  <span className="px-3 py-1 rounded-full bg-rose-950 border border-rose-500/60 text-rose-300 text-xs font-bold font-mono flex items-center gap-1.5 animate-bounce shadow-[0_0_15px_rgba(244,63,94,0.4)]">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                    ⚠️ มีการลบสินค้าในบิล!
                  </span>
                ) : monitoredTerminal?.liveState?.activeAction === 'DRAWER' ? (
                  <span className="px-3 py-1 rounded-full bg-purple-950 border border-purple-500/50 text-purple-300 text-xs font-bold font-mono flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                    💵 เปิดลิ้นชักเก็บเงิน
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-400 text-xs font-mono">
                    💤 จุดขายว่าง (พร้อมให้บริการ)
                  </span>
                )}
              </div>
            </div>
          </DialogHeader>

          {/* CCTV Digital Twin Screen Body */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 py-4">
            
            {/* Left: Cashier Screen Replica (8 cols) */}
            <div className="lg:col-span-8 bg-[#040814] border border-cyan-950 rounded-2xl p-4 flex flex-col justify-between shadow-inner">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-cyan-950/80 mb-3">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-bold font-mono text-cyan-300 uppercase">
                      ตะกร้าสินค้าสดหน้าร้าน (Real-time Cart)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    ลูกค้า: <strong className="text-cyan-200">{monitoredTerminal?.liveState?.customerName || 'ลูกค้าทั่วไป'}</strong>
                  </span>
                </div>

                {/* Cart Items List */}
                <div className="max-h-[260px] overflow-y-auto space-y-1.5 pr-1 font-mono text-xs no-scrollbar">
                  {(!monitoredTerminal?.liveState?.cartItems || monitoredTerminal.liveState.cartItems.length === 0) ? (
                    <div className="text-center py-16 text-slate-600 flex flex-col items-center justify-center gap-2">
                      <ShoppingCart className="w-8 h-8 text-slate-700 animate-pulse" />
                      <span>ยังไม่มีสินค้าในตะกร้าบิลนี้ (แคชเชียร์รอสแกนสินค้า)</span>
                    </div>
                  ) : (
                    monitoredTerminal.liveState.cartItems.map((item, idx) => (
                      <div 
                        key={idx} 
                        className="p-2.5 rounded-xl bg-[#091124] border border-cyan-950/80 hover:border-cyan-800 transition-all flex items-center justify-between text-xs font-mono"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-5 h-5 rounded-lg bg-cyan-950 text-cyan-400 text-[10px] font-bold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <div className="truncate">
                            <span className="font-bold text-white block truncate">{item.name}</span>
                            <span className="text-[10px] text-slate-500">@{item.price} บาท/{item.unitName}</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="font-bold text-cyan-300 block">x{item.quantity} {item.unitName}</span>
                          <span className="text-[11px] font-bold text-[#00ff9d]">฿{item.total.toLocaleString()}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Action Banner & Total Bar */}
              <div className="mt-4 pt-3 border-t border-cyan-950/80">
                {/* Active Action Description */}
                {monitoredTerminal?.liveState?.actionDescription && (
                  <div className={`p-2 rounded-xl mb-3 text-xs font-mono font-bold flex items-center gap-2 ${
                    monitoredTerminal.liveState.alertLevel === 'WARNING'
                      ? 'bg-rose-950/80 border border-rose-500 text-rose-300'
                      : 'bg-[#0b1836] border border-cyan-900/60 text-cyan-300'
                  }`}>
                    <Zap className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                    <span className="truncate">{monitoredTerminal.liveState.actionDescription}</span>
                  </div>
                )}

                <div className="flex items-center justify-between bg-[#081024] p-3 rounded-xl border border-cyan-900/50 font-mono">
                  <div className="text-xs text-slate-400">
                    <div>รวมรายการ: <strong className="text-white">{monitoredTerminal?.liveState?.itemCount || 0} ชิ้น</strong></div>
                    {monitoredTerminal?.liveState?.discountAmount ? (
                      <div className="text-rose-400">ส่วนลด: -฿{monitoredTerminal.liveState.discountAmount.toLocaleString()}</div>
                    ) : null}
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">ยอดรวมทั้งสิ้น (TOTAL)</span>
                    <span className="text-2xl font-black text-[#00ff9d] drop-shadow-[0_0_10px_rgba(0,255,157,0.5)]">
                      ฿{(monitoredTerminal?.liveState?.totalAmount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Telemetry & Security Guard (4 cols) */}
            <div className="lg:col-span-4 space-y-3 font-mono flex flex-col justify-between">
              <div className="space-y-3">
                {/* Anti-fraud indicator */}
                <div className="p-3.5 rounded-2xl bg-[#091124] border border-cyan-900/60">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase mb-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>ระบบตรวจจับความปลอดภัย</span>
                  </div>
                  {monitoredTerminal?.liveState?.alertLevel === 'WARNING' ? (
                    <div className="text-xs text-rose-400 font-bold bg-rose-950/60 border border-rose-500/40 p-2.5 rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>พบพฤติกรรมควรระวัง (ลบสินค้า/แก้ราคา)</span>
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-400 font-bold bg-emerald-950/40 border border-emerald-500/30 p-2.5 rounded-xl flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>พฤติกรรมการขายปกติ ไม่พบสิ่งผิดสังเกต</span>
                    </div>
                  )}
                </div>

                {/* Machine Stats */}
                <div className="p-3.5 rounded-2xl bg-[#091124] border border-cyan-900/60 text-xs space-y-2.5">
                  <div className="text-slate-400 font-bold uppercase text-[11px] pb-1 border-b border-cyan-950">
                    สถิติเครื่องลูกข่ายวันนี้
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">ยอดขายสะสม:</span>
                    <span className="text-[#00ff9d] font-bold">
                      {formatCurrency(monitoredTerminal?.todaySales || 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">จำนวนบิลที่ปิด:</span>
                    <span className="text-white font-bold">{monitoredTerminal?.todayBills || 0} บิล</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">เวลาอัปเดตล่าสุด:</span>
                    <span className="text-cyan-300 text-[11px]">
                      {monitoredTerminal?.liveState?.actionTimestamp 
                        ? new Date(monitoredTerminal.liveState.actionTimestamp).toLocaleTimeString('th-TH')
                        : 'เรียลไทม์'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={() => fetchTelemetry(false)}
                  disabled={refreshing}
                  className="w-full py-2.5 rounded-xl bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm hover:shadow-[0_0_12px_rgba(0,240,255,0.2)]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>{refreshing ? 'กำลังดึงภาพ...' : 'รีเฟรชภาพสดเดี๋ยวนี้'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMonitorTerminalId(null)}
                  className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-xs font-bold border border-slate-800 transition-all cursor-pointer"
                >
                  ปิดหน้าต่างส่อง
                </button>
              </div>

            </div>

          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
