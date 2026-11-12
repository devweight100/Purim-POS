'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { CalendarClock, Plus } from 'lucide-react';
import { FinAccount, FinCategory, fieldCls, newClientId, thaiDate } from './shared';

interface Recurring {
  id: string; name: string; amount: number; frequency: 'MONTHLY' | 'WEEKLY' | 'YEARLY'; dayOfMonth?: number | null; dayOfWeek?: number | null; monthOfYear?: number | null;
  nextDueDate: string; daysToDue: number; status: 'OVERDUE' | 'DUE_SOON' | 'SCHEDULED' | 'INACTIVE'; isActive: boolean; remindDays: number;
  category: { id: string; name: string }; account?: { id: string; name: string } | null; lastPaidAt?: string | null; note?: string | null;
}
const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const ruleText = (r: Recurring) =>
  r.frequency === 'WEEKLY' ? `ทุกวัน${DOW[r.dayOfWeek ?? 0]}` : r.frequency === 'YEARLY' ? `ทุกปี วันที่ ${r.dayOfMonth} ${MONTHS[(r.monthOfYear ?? 1) - 1]}` : `ทุกเดือน วันที่ ${r.dayOfMonth}`;

export function RecurringPanel({ accounts, categories, onChanged }: { accounts: FinAccount[]; categories: FinCategory[]; onChanged: () => void }) {
  const [rows, setRows] = useState<Recurring[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<Recurring | null>(null);
  const payable = accounts.filter((a) => a.isActive && (a.type === 'CASH_SAFE' || a.type === 'BANK'));

  const load = useCallback(async () => {
    try { setRows(await apiFetch('/finance/recurring')); } catch (err) { toast.error((err as Error | undefined)?.message || 'โหลดไม่สำเร็จ'); }
  }, []);
  useEffect(() => {
    // load() only updates state after its request
    const run = async () => { await load(); };
    void run();
  }, [load]);

  const skip = async (r: Recurring) => {
    const reason = window.prompt(`ข้ามงวด ${thaiDate(r.nextDueDate)} ของ "${r.name}" เพราะ?`);
    if (!reason) return;
    try { await apiFetch(`/finance/recurring/${r.id}/skip`, { method: 'POST', body: JSON.stringify({ reason }) }); toast.success('ข้ามงวดนี้แล้ว'); void load(); }
    catch (err) { toast.error((err as Error | undefined)?.message || 'ไม่สำเร็จ'); }
  };
  const toggle = async (r: Recurring) => {
    try { await apiFetch(`/finance/recurring/${r.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !r.isActive }) }); void load(); }
    catch (err) { toast.error((err as Error | undefined)?.message || 'ไม่สำเร็จ'); }
  };

  const due = rows.filter((r) => r.status === 'OVERDUE' || r.status === 'DUE_SOON');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><CalendarClock className="w-5 h-5 text-indigo-600" /> ค่าใช้จ่ายประจำ</h2>
          <p className="text-sm text-slate-500">ค่าเช่า เงินเดือน ค่าอินเทอร์เน็ต ฯลฯ — ระบบเตือนเมื่อใกล้ครบกำหนด กด &quot;จ่าย&quot; แล้วบันทึกเป็นค่าใช้จ่ายและเลื่อนไปงวดถัดไปให้</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="w-4 h-4" /> เพิ่มรายการประจำ</Button>
      </div>
      {due.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ใกล้ครบ/เกินกำหนด {due.length} รายการ รวม <b>{formatCurrency(due.reduce((s, r) => s + r.amount, 0))}</b>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr>
            <th className="p-2 text-left">รายการ</th><th className="p-2 text-left">รอบ</th><th className="p-2 text-left">ครบกำหนดถัดไป</th>
            <th className="p-2 text-right">จำนวนเงิน</th><th className="p-2 text-left">จ่ายจาก</th><th className="p-2" />
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">ยังไม่มีค่าใช้จ่ายประจำ</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 ${!r.isActive ? 'text-slate-400' : ''}`}>
                <td className="p-2"><div className="font-semibold">{r.name}</div><div className="text-xs text-slate-500">{r.category.name}</div></td>
                <td className="p-2">{ruleText(r)}</td>
                <td className="p-2">
                  {thaiDate(r.nextDueDate)}{' '}
                  {r.status === 'OVERDUE' && <Badge className="bg-rose-600 text-white">เกิน {-r.daysToDue} วัน</Badge>}
                  {r.status === 'DUE_SOON' && <Badge className="bg-amber-500 text-white">{r.daysToDue === 0 ? 'วันนี้' : `อีก ${r.daysToDue} วัน`}</Badge>}
                </td>
                <td className="p-2 text-right font-mono">{formatCurrency(r.amount)}</td>
                <td className="p-2">{r.account?.name || '-'}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  {r.isActive && <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => setPayTarget(r)}>จ่าย</Button>}
                  {r.isActive && <Button size="sm" variant="ghost" onClick={() => void skip(r)}>ข้ามงวด</Button>}
                  <Button size="sm" variant="ghost" onClick={() => void toggle(r)}>{r.isActive ? 'ปิดใช้' : 'เปิดใช้'}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreateDialog open={createOpen} accounts={payable} categories={categories.filter((c) => c.isActive)} onClose={() => setCreateOpen(false)} onDone={() => { void load(); }} />
      <PayDialog target={payTarget} accounts={payable} onClose={() => setPayTarget(null)} onDone={() => { void load(); onChanged(); }} />
    </div>
  );
}

function CreateDialog({ open, accounts, categories, onClose, onDone }: { open: boolean; accounts: FinAccount[]; categories: FinCategory[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<'MONTHLY' | 'WEEKLY' | 'YEARLY'>('MONTHLY');
  const [dayOfMonth, setDayOfMonth] = useState('5');
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [monthOfYear, setMonthOfYear] = useState('1');
  const [remindDays, setRemindDays] = useState('3');
  const [saving, setSaving] = useState(false);
  // fresh form when the dialog opens (or its accounts change), adjusted while rendering
  const [seen, setSeen] = useState({ open, accounts });
  if (seen.open !== open || seen.accounts !== accounts) {
    setSeen({ open, accounts });
    if (open) { setName(''); setAmount(''); setCategoryId(''); setAccountId(accounts[0]?.id || ''); }
  }
  const submit = async () => {
    if (!name.trim() || !categoryId || !(Number(amount) > 0)) return toast.error('กรุณากรอกชื่อ หมวด และจำนวนเงิน');
    setSaving(true);
    try {
      await apiFetch('/finance/recurring', { method: 'POST', body: JSON.stringify({ name, categoryId, accountId: accountId || undefined, amount: Number(amount), frequency, dayOfMonth: Number(dayOfMonth), dayOfWeek: Number(dayOfWeek), monthOfYear: Number(monthOfYear), remindDays: Number(remindDays) }) });
      toast.success('เพิ่มค่าใช้จ่ายประจำแล้ว');
      onClose(); onDone();
    } catch (err) { toast.error((err as Error | undefined)?.message || 'บันทึกไม่สำเร็จ'); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>เพิ่มค่าใช้จ่ายประจำ</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ เช่น ค่าเช่าร้าน, เงินเดือนพนักงาน" />
          <select className={fieldCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— เลือกหมวดค่าใช้จ่าย —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="จำนวนเงินต่องวด" />
            <select className={fieldCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>จ่ายจาก: {a.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['MONTHLY', 'WEEKLY', 'YEARLY'] as const).map((f) => (
              <Button key={f} type="button" variant={frequency === f ? 'default' : 'outline'} onClick={() => setFrequency(f)}>{f === 'MONTHLY' ? 'รายเดือน' : f === 'WEEKLY' ? 'รายสัปดาห์' : 'รายปี'}</Button>
            ))}
          </div>
          {frequency === 'WEEKLY' ? (
            <select className={fieldCls} value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
              {DOW.map((d, i) => <option key={d} value={i}>ทุกวัน{d}</option>)}
            </select>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <select className={fieldCls} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)}>
                {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>วันที่ {i + 1}</option>)}
              </select>
              {frequency === 'YEARLY' && (
                <select className={fieldCls} value={monthOfYear} onChange={(e) => setMonthOfYear(e.target.value)}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              )}
            </div>
          )}
          <label className="flex items-center gap-2">เตือนล่วงหน้า <Input className="w-20" type="number" min={0} value={remindDays} onChange={(e) => setRemindDays(e.target.value)} /> วัน</label>
          <p className="text-xs text-slate-500">ถ้าเดือนไหนไม่มีวันที่เลือก (เช่น 31) ระบบใช้วันสุดท้ายของเดือนแทน</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button disabled={saving} onClick={() => void submit()}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ target, accounts, onClose, onDone }: { target: Recurring | null; accounts: FinAccount[]; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [clientId, setClientId] = useState(newClientId());
  const [saving, setSaving] = useState(false);
  // fresh form for each bill to pay (or when its accounts change), adjusted while rendering
  const [seen, setSeen] = useState({ target, accounts });
  if (seen.target !== target || seen.accounts !== accounts) {
    setSeen({ target, accounts });
    if (target) {
      setClientId(newClientId()); setAmount(String(target.amount)); setNote('');
      setAccountId(target.account?.id || accounts[0]?.id || '');
    }
  }
  if (!target) return null;
  const submit = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/finance/recurring/${target.id}/pay`, { method: 'POST', body: JSON.stringify({ clientId, amount: Number(amount), accountId, note }) });
      toast.success(`บันทึกค่าใช้จ่าย ${res.expenseNumber} แล้ว งวดถัดไป ${thaiDate(res.nextDueDate)}`);
      onClose(); onDone();
    } catch (err) { toast.error((err as Error | undefined)?.message || 'บันทึกไม่สำเร็จ'); } finally { setSaving(false); }
  };
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>จ่าย {target.name} (งวด {thaiDate(target.nextDueDate)})</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1"><span className="font-semibold">จำนวนเงินที่จ่ายจริง</span>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block space-y-1"><span className="font-semibold">จ่ายจาก</span>
            <select className={fieldCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} (คงเหลือ {formatCurrency(a.balance)})</option>)}
            </select>
          </label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ) เช่น เลขที่ใบแจ้งหนี้" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button disabled={saving} className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => void submit()}>{saving ? 'กำลังบันทึก...' : 'ยืนยันจ่าย'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
