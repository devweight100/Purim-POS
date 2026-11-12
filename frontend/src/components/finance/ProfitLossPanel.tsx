'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { bangkokDate, bangkokDayKey, bangkokParts } from '@shared/bangkok-date';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { FileSpreadsheet, Printer } from 'lucide-react';

interface PL {
  period: { from: string; to: string }; orderCount: number;
  salesInclVat: number; outputVat: number; revenue: number; discounts: number; cogs: number; grossProfit: number; grossMargin: number;
  claims: { replacementCost: number; refundsPaid: number; supplierRecovery: number; net: number };
  stockWriteOff: number; expenses: Record<string, number>; totalExpenses: number; operatingProfit: number;
  otherIncome: number; cashOverShort: number; accountAdjustments: number; netProfit: number; netMargin: number;
}
const iso = (d: Date) => bangkokDayKey(d); // Bangkok calendar day

export function ProfitLossPanel() {
  const now = new Date();
  const bk = bangkokParts(now);
  const [from, setFrom] = useState(iso(new Date(bangkokDate(bk.year, bk.month, 1))));
  const [to, setTo] = useState(iso(now));
  const [data, setData] = useState<PL | null>(null);
  useEffect(() => {
    // date-only = whole Bangkok day on the server (to is inclusive, up to next day 00:00)
    const f = from;
    const t = to;
    apiFetch(`/finance/profit-loss?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`).then(setData).catch((err: any) => toast.error(err?.message || 'โหลดไม่สำเร็จ'));
  }, [from, to]);
  const preset = (kind: 'this' | 'last' | 'year') => {
    const n = new Date();
    const { year, month } = bangkokParts(n);
    const at = (y: number, m: number, d: number) => iso(new Date(bangkokDate(y, m, d)));
    if (kind === 'this') { setFrom(at(year, month, 1)); setTo(iso(n)); }
    if (kind === 'last') { setFrom(at(year, month - 1, 1)); setTo(at(year, month, 0)); }
    if (kind === 'year') { setFrom(at(year, 0, 1)); setTo(iso(n)); }
  };
  const Row = ({ label, value, strong, indent, sign }: { label: string; value: number; strong?: boolean; indent?: boolean; sign?: '-' | '+' }) => (
    <div className={`flex justify-between py-1 ${strong ? 'font-black border-t border-slate-300 mt-1 pt-2' : ''} ${indent ? 'pl-5 text-slate-600' : ''}`}>
      <span>{label}</span>
      <span className={`font-mono ${value < 0 ? 'text-rose-600' : ''}`}>{sign === '-' && value ? `(${formatCurrency(value)})` : formatCurrency(value)}</span>
    </div>
  );
  const exportCsv = () => {
    if (!data) return;
    const lines = [
      ['รายการ', 'จำนวนเงิน'], ['รายได้จากการขาย (ไม่รวม VAT)', data.revenue], ['ต้นทุนขาย', -data.cogs], ['กำไรขั้นต้น', data.grossProfit],
      ['ต้นทุนจากเคลม (สุทธิ)', -data.claims.net], ['สินค้าเสียหาย/ตัดจำหน่าย', -data.stockWriteOff],
      ...Object.entries(data.expenses).map(([k, v]) => [`ค่าใช้จ่าย: ${k}`, -v]),
      ['กำไรจากการดำเนินงาน', data.operatingProfit], ['รายรับอื่น', data.otherIncome], ['เงินขาด/เกินตอนปิดกะ', data.cashOverShort],
      ['ปรับยอดบัญชี (ค่าธรรมเนียม/ดอกเบี้ย)', data.accountAdjustments], ['กำไรสุทธิ', data.netProfit],
    ];
    const csv = '﻿' + lines.map((l) => l.map((x) => `"${x}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `profit-loss_${from}_${to}.csv`;
    a.click();
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2 print:hidden">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-indigo-600" /> งบกำไรขาดทุน</h2>
          <p className="text-sm text-slate-500">ยอดขาย − ต้นทุนขาย − เคลม − สินค้าเสียหาย − ค่าใช้จ่ายร้าน = กำไรสุทธิจริง</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => preset('this')}>เดือนนี้</Button>
          <Button size="sm" variant="outline" onClick={() => preset('last')}>เดือนก่อน</Button>
          <Button size="sm" variant="outline" onClick={() => preset('year')}>ปีนี้</Button>
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button size="sm" variant="outline" className="gap-1" onClick={exportCsv}><FileSpreadsheet className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => window.print()}><Printer className="w-4 h-4" /> พิมพ์</Button>
        </div>
      </div>
      {!data ? <div className="p-6 text-slate-400">กำลังคำนวณ...</div> : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 max-w-2xl text-sm">
          <div className="text-center mb-3">
            <div className="font-black text-base">งบกำไรขาดทุน</div>
            <div className="text-slate-500">{new Date(data.period.from).toLocaleDateString('th-TH')} – {new Date(data.period.to).toLocaleDateString('th-TH')} ({data.orderCount} บิล)</div>
          </div>
          <Row label="ยอดขายรวม VAT" value={data.salesInclVat} indent />
          <Row label="หัก ภาษีขาย (VAT)" value={data.outputVat} indent sign="-" />
          <Row label="รายได้จากการขาย" value={data.revenue} />
          <Row label="หัก ต้นทุนขาย (FIFO)" value={data.cogs} sign="-" />
          <Row label={`กำไรขั้นต้น (${data.grossMargin}%)`} value={data.grossProfit} strong />
          <div className="mt-2 font-semibold">หัก ค่าใช้จ่าย</div>
          <Row label="ต้นทุนของที่เปลี่ยนให้ลูกค้า (เคลม)" value={data.claims.replacementCost} indent sign="-" />
          <Row label="คืนเงินลูกค้า (เคลม)" value={data.claims.refundsPaid} indent sign="-" />
          <Row label="ได้คืนจากบริษัท (ใบลดหนี้ของเสีย)" value={-data.claims.supplierRecovery} indent />
          <Row label="สินค้าเสียหาย / ปรับลดสต็อก" value={data.stockWriteOff} indent sign="-" />
          {Object.entries(data.expenses).map(([k, v]) => <Row key={k} label={k} value={v} indent sign="-" />)}
          {Object.keys(data.expenses).length === 0 && <div className="pl-5 text-slate-400 py-1">ยังไม่มีค่าใช้จ่ายร้านในช่วงนี้</div>}
          <Row label="กำไรจากการดำเนินงาน" value={data.operatingProfit} strong />
          <Row label="บวก รายรับอื่น" value={data.otherIncome} indent />
          <Row label="เงินขาด / เกินตอนปิดกะ" value={data.cashOverShort} indent />
          <Row label="ปรับยอดบัญชี (ค่าธรรมเนียม / ดอกเบี้ย)" value={data.accountAdjustments} indent />
          <div className={`flex justify-between py-2 mt-2 border-t-2 border-double border-slate-400 text-base font-black ${data.netProfit < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            <span>{data.netProfit < 0 ? 'ขาดทุนสุทธิ' : 'กำไรสุทธิ'} ({data.netMargin}%)</span><span className="font-mono">{formatCurrency(data.netProfit)}</span>
          </div>
          <p className="text-xs text-slate-400 mt-3">รายได้คิดจากบิลที่ขายในช่วงนี้ (ขายเชื่อนับเป็นรายได้ตั้งแต่วันขาย) · ไม่รวมเงินทุน/ถอนใช้ของเจ้าของ และการย้ายเงินระหว่างบัญชี</p>
        </div>
      )}
    </div>
  );
}
