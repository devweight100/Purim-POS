'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { TrendingUp } from 'lucide-react';
import { thaiDate } from './shared';

interface Forecast {
  days: number; startCash: number; endCash: number; lowest: { date: string; balance: number }; firstNegative: string | null; overdueReceivables: number;
  totals: { in: number; out: number };
  series: { date: string; in: number; out: number; balance: number }[];
  events: { date: string; kind: 'IN' | 'OUT'; source: string; label: string; amount: number }[];
}

export function ForecastPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Forecast | null>(null);
  useEffect(() => {
    apiFetch(`/finance/forecast?days=${days}`).then(setData).catch((err: unknown) => toast.error((err as Error | undefined)?.message || 'โหลดไม่สำเร็จ'));
  }, [days]);
  if (!data) return <div className="p-6 text-slate-400">กำลังคำนวณ...</div>;
  const min = Math.min(0, ...data.series.map((s) => s.balance));
  const max = Math.max(1, ...data.series.map((s) => s.balance));
  const span = max - min || 1;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-indigo-600" /> คาดการณ์เงินสดล่วงหน้า</h2>
          <p className="text-sm text-slate-500">เงินที่มีตอนนี้ + ลูกหนี้ตามวันครบกำหนด − เจ้าหนี้และค่าใช้จ่ายประจำตามวันครบกำหนด (ยังไม่รวมยอดขายในอนาคต)</p>
        </div>
        <div className="flex gap-1">
          {[30, 60, 90].map((d) => <Button key={d} size="sm" variant={days === d ? 'default' : 'outline'} onClick={() => setDays(d)}>{d} วัน</Button>)}
        </div>
      </div>
      {data.firstNegative ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          ⚠️ เงินจะไม่พอจ่ายตั้งแต่วันที่ <b>{thaiDate(data.firstNegative)}</b> — ต่ำสุด <b>{formatCurrency(data.lowest.balance)}</b> ({thaiDate(data.lowest.date)}) ควรเร่งเก็บลูกหนี้หรือเลื่อนการจ่าย
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          เงินพอจ่ายตลอด {data.days} วัน — ยอดต่ำสุด {formatCurrency(data.lowest.balance)} ({thaiDate(data.lowest.date)})
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
        {[
          ['เงินที่มีตอนนี้', data.startCash],
          ['ลูกหนี้ที่จะครบกำหนด', data.totals.in],
          ['ต้องจ่าย (เจ้าหนี้ + ประจำ)', data.totals.out],
          [`คาดว่าเหลือใน ${data.days} วัน`, data.endCash],
          ['ลูกหนี้ที่เกินกำหนดแล้ว (ไม่นับรวม)', data.overdueReceivables],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded-2xl border border-slate-200 bg-white p-3"><div className="text-xs font-bold text-slate-500">{l}</div><div className={`text-xl font-black font-mono ${Number(v) < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{formatCurrency(Number(v))}</div></div>
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="relative h-40 flex items-end gap-px" aria-label="กราฟยอดเงินคาดการณ์รายวัน">
          <div className="absolute left-0 right-0 border-t border-dashed border-slate-300" style={{ bottom: `${((0 - min) / span) * 100}%` }} />
          {data.series.map((s) => (
            <div key={s.date} className="flex-1 h-full relative" title={`${s.date}: ${formatCurrency(s.balance)}`}>
              <div
                className={`absolute left-0 right-0 ${s.balance < 0 ? 'bg-rose-500' : 'bg-indigo-500'} rounded-sm`}
                style={s.balance >= 0
                  ? { bottom: `${((0 - min) / span) * 100}%`, height: `${(s.balance / span) * 100}%` }
                  : { bottom: `${((s.balance - min) / span) * 100}%`, height: `${(-s.balance / span) * 100}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 mt-1"><span>{thaiDate(data.series[0].date)}</span><span>{thaiDate(data.series[data.series.length - 1].date)}</span></div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white max-h-96">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr><th className="p-2 text-left">วันที่</th><th className="p-2 text-left">รายการ</th><th className="p-2 text-right">เข้า</th><th className="p-2 text-right">ออก</th></tr></thead>
          <tbody>
            {data.events.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-400">ไม่มีรายการครบกำหนดในช่วงนี้</td></tr>}
            {data.events.map((e, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="p-2 whitespace-nowrap">{thaiDate(e.date)}</td><td className="p-2">{e.label}</td>
                <td className="p-2 text-right font-mono text-emerald-700">{e.kind === 'IN' ? formatCurrency(e.amount) : ''}</td>
                <td className="p-2 text-right font-mono text-rose-700">{e.kind === 'OUT' ? formatCurrency(e.amount) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
