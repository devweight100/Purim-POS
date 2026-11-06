'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Landmark, Upload } from 'lucide-react';
import { FinAccount, fieldCls, thaiDate } from './shared';

interface Row { id: string; occurredAt: string; direction: 'IN' | 'OUT'; amount: number; type: string; note?: string }
interface State {
  ledgerBalance: number; clearedBalance: number; unreconciled: Row[];
  history: { id: string; statementDate: string; statementBalance: number; difference: number; createdAt: string; note?: string }[];
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Parse a statement CSV: needs a date column and either one signed amount or separate deposit/withdraw columns. */
function parseStatement(text: string): { date: Date; amount: number }[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const out: { date: Date; amount: number }[] = [];
  for (const line of lines) {
    const cells = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').trim());
    const dateCell = cells.find((c) => /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(c));
    if (!dateCell) continue;
    const [a, b, c] = dateCell.split(/[/-]/).map((x) => parseInt(x, 10));
    let y = a > 31 ? a : c; const m = b; const d = a > 31 ? c : a;
    if (y > 2400) y -= 543; if (y < 100) y += 2000;
    const nums = cells.filter((x) => x !== dateCell).map((x) => x.replace(/,/g, '')).filter((x) => /^-?\d+(\.\d+)?$/.test(x)).map(Number);
    if (!nums.length) continue;
    const amount = nums.length >= 3 ? (nums[0] ? -nums[0] : nums[1]) : nums[0]; // withdraw, deposit, balance
    out.push({ date: new Date(y, m - 1, d), amount });
  }
  return out;
}

export function ReconcilePanel({ accounts, onChanged }: { accounts: FinAccount[]; onChanged: () => void }) {
  const banks = accounts.filter((a) => a.isActive && (a.type === 'BANK' || a.type === 'CARD_CLEARING' || a.type === 'CASH_SAFE'));
  const [accountId, setAccountId] = useState('');
  const [statementDate, setStatementDate] = useState(iso(new Date()));
  const [statementBalance, setStatementBalance] = useState('');
  const [state, setState] = useState<State | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [adjustReason, setAdjustReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!accountId && banks[0]) setAccountId(banks[0].id); }, [banks, accountId]);

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const s = await apiFetch(`/finance/reconcile/${accountId}?to=${encodeURIComponent(new Date(`${statementDate}T23:59:59`).toISOString())}`);
      setState(s); setChecked(new Set());
    } catch (err: any) { toast.error(err?.message || 'โหลดไม่สำเร็จ'); }
  }, [accountId, statementDate]);
  useEffect(() => { void load(); }, [load]);

  const signed = (r: Row) => (r.direction === 'IN' ? 1 : -1) * r.amount;
  const cleared = useMemo(() => (state ? state.clearedBalance + state.unreconciled.filter((r) => checked.has(r.id)).reduce((s, r) => s + signed(r), 0) : 0), [state, checked]);
  const diff = statementBalance === '' ? 0 : Math.round((Number(statementBalance) - cleared) * 100) / 100;

  const autoMatch = (file?: File) => {
    if (!file || !state) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = parseStatement(String(reader.result));
      const next = new Set(checked);
      let matched = 0;
      for (const l of lines) {
        const cand = state.unreconciled.find((r) => !next.has(r.id) && Math.abs(signed(r) - l.amount) < 0.005 && Math.abs(new Date(r.occurredAt).getTime() - l.date.getTime()) <= 3 * 86400000);
        if (cand) { next.add(cand.id); matched++; }
      }
      setChecked(next);
      toast.success(`อ่าน statement ${lines.length} บรรทัด จับคู่ได้ ${matched} รายการ (ตรวจและติ๊กเพิ่มเองได้)`);
    };
    reader.readAsText(file);
  };

  const save = async (adjust: boolean) => {
    if (statementBalance === '') return toast.error('กรุณากรอกยอดคงเหลือตาม statement');
    if (adjust && !adjustReason.trim()) return toast.error('กรุณาระบุเหตุผลของส่วนต่าง');
    setSaving(true);
    try {
      const res = await apiFetch(`/finance/reconcile/${accountId}`, {
        method: 'POST',
        body: JSON.stringify({ statementDate: new Date(`${statementDate}T23:59:59`).toISOString(), statementBalance: Number(statementBalance), transactionIds: [...checked], adjustDifference: adjust, adjustReason }),
      });
      toast.success(res.difference === 0 ? `กระทบยอดตรงกันแล้ว (${res.matched} รายการ)` : `บันทึกแล้ว ยังต่างอยู่ ${formatCurrency(res.difference)}`);
      setAdjustReason(''); void load(); onChanged();
    } catch (err: any) { toast.error(err?.message || 'บันทึกไม่สำเร็จ'); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><Landmark className="w-5 h-5 text-indigo-600" /> กระทบยอดกับ statement ธนาคาร</h2>
        <p className="text-sm text-slate-500">ติ๊กรายการที่เห็นใน statement จริง (หรืออัปโหลดไฟล์ CSV ให้ระบบจับคู่ให้) แล้วเทียบยอดคงเหลือ — ส่วนต่างเช่นค่าธรรมเนียม/ดอกเบี้ยบันทึกเป็นรายการปรับยอดได้</p>
      </div>
      <div className="grid sm:grid-cols-4 gap-2 text-sm">
        <select className={fieldCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <Input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} title="วันที่ของยอดคงเหลือใน statement" />
        <Input type="number" step="0.01" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} placeholder="ยอดคงเหลือตาม statement" />
        <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 cursor-pointer text-slate-600 hover:bg-slate-50">
          <Upload className="w-4 h-4" /> CSV จากธนาคาร
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => autoMatch(e.target.files?.[0])} />
        </label>
      </div>
      {state && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500 font-bold">ยอดในระบบ ณ วันที่</div><div className="text-lg font-black font-mono">{formatCurrency(state.ledgerBalance)}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500 font-bold">ยอดที่กระทบแล้ว (รวมที่ติ๊ก)</div><div className="text-lg font-black font-mono">{formatCurrency(cleared)}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500 font-bold">ยอดตาม statement</div><div className="text-lg font-black font-mono">{statementBalance === '' ? '-' : formatCurrency(Number(statementBalance))}</div></div>
            <div className={`rounded-2xl border p-3 ${diff === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}><div className="text-xs font-bold">ส่วนต่าง</div><div className="text-lg font-black font-mono">{formatCurrency(diff)}</div></div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white max-h-96">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr>
                <th className="p-2 w-10"><input type="checkbox" checked={state.unreconciled.length > 0 && checked.size === state.unreconciled.length} onChange={(e) => setChecked(e.target.checked ? new Set(state.unreconciled.map((r) => r.id)) : new Set())} /></th>
                <th className="p-2 text-left">วันที่</th><th className="p-2 text-left">รายละเอียด</th><th className="p-2 text-right">เข้า</th><th className="p-2 text-right">ออก</th>
              </tr></thead>
              <tbody>
                {state.unreconciled.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">ไม่มีรายการรอกระทบยอด</td></tr>}
                {state.unreconciled.map((r) => (
                  <tr key={r.id} className={`border-t border-slate-100 ${checked.has(r.id) ? 'bg-emerald-50' : ''}`}>
                    <td className="p-2"><input type="checkbox" checked={checked.has(r.id)} onChange={(e) => { const n = new Set(checked); if (e.target.checked) n.add(r.id); else n.delete(r.id); setChecked(n); }} /></td>
                    <td className="p-2 whitespace-nowrap">{thaiDate(r.occurredAt)}</td><td className="p-2">{r.note}</td>
                    <td className="p-2 text-right font-mono text-emerald-700">{r.direction === 'IN' ? formatCurrency(r.amount) : ''}</td>
                    <td className="p-2 text-right font-mono text-rose-700">{r.direction === 'OUT' ? formatCurrency(r.amount) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={saving} onClick={() => void save(false)}>บันทึกการกระทบยอด ({checked.size} รายการ)</Button>
            {diff !== 0 && statementBalance !== '' && (
              <>
                <Input className="w-72" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="เหตุผลส่วนต่าง เช่น ค่าธรรมเนียม, ดอกเบี้ยรับ" />
                <Button disabled={saving} variant="outline" onClick={() => void save(true)}>บันทึกและปรับส่วนต่าง {formatCurrency(diff)}</Button>
              </>
            )}
          </div>
          {state.history.length > 0 && (
            <div className="text-xs text-slate-500">
              กระทบยอดล่าสุด: {state.history.slice(0, 5).map((h) => `${thaiDate(h.statementDate)} ยอด ${formatCurrency(h.statementBalance)}${h.difference ? ` (ต่าง ${formatCurrency(h.difference)})` : ' ✓'}`).join(' · ')}
            </div>
          )}
        </>
      )}
    </div>
  );
}
