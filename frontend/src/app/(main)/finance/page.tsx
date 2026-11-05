'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Wallet, Landmark, Banknote, CreditCard, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight,
  Receipt, PiggyBank, RefreshCw, Scale, Plus, Ban,
} from 'lucide-react';

type AccountType = 'CASH_DRAWER' | 'CASH_SAFE' | 'BANK' | 'CARD_CLEARING';
interface MoneyAccount {
  id: string; name: string; type: AccountType; isActive: boolean; balance: number; hasOpeningBalance: boolean;
  bank: { bankName: string; accountName: string; accountNumber: string } | null;
  openShift: { shiftNumber: string; cashier?: string } | null;
}
interface Summary {
  balances: { cashInDrawers: number; cashInSafe: number; bank: number; cardPending: number; total: number };
  accounts: MoneyAccount[];
  flow: { totalIn: number; totalOut: number; net: number; inByType: Record<string, number>; outByType: Record<string, number>; expenseByCategory: Record<string, number> };
}
interface LedgerRow {
  id: string; direction: 'IN' | 'OUT'; amount: number; type: string; typeLabel: string; note?: string; occurredAt: string;
  transferGroupId?: string; refType?: string; refId?: string; isReversed: boolean; canCancel: boolean;
  account: { id: string; name: string; type: AccountType }; category?: { name: string } | null;
}
interface Category { id: string; name: string; isActive: boolean }
interface ExpenseRow {
  id: string; expenseNumber: string; amount: number | string; paidAt: string; description: string; vendor?: string; status: string;
  category: { name: string }; account: { name: string };
}

const newId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `fin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const TYPE_META: Record<AccountType, { label: string; icon: typeof Wallet; tone: string }> = {
  CASH_DRAWER: { label: 'ลิ้นชักเงินสด', icon: Banknote, tone: 'bg-amber-50 border-amber-200 text-amber-800' },
  CASH_SAFE: { label: 'เงินสดในเซฟ', icon: PiggyBank, tone: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  BANK: { label: 'บัญชีธนาคาร', icon: Landmark, tone: 'bg-sky-50 border-sky-200 text-sky-800' },
  CARD_CLEARING: { label: 'บัตรรอเงินเข้า', icon: CreditCard, tone: 'bg-violet-50 border-violet-200 text-violet-800' },
};
const isCash = (t: AccountType) => t === 'CASH_DRAWER' || t === 'CASH_SAFE';

type Range = 'today' | '7d' | 'month';
function rangeDates(r: Range) {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (r === '7d') from.setDate(from.getDate() - 6);
  if (r === 'month') from.setDate(1);
  return { from: from.toISOString(), to: now.toISOString() };
}

const fieldCls = 'w-full h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm';

export default function FinancePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [range, setRange] = useState<Range>('today');
  const [tab, setTab] = useState<'ledger' | 'expenses' | 'categories'>('ledger');
  const [accountFilter, setAccountFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // dialogs
  const [transferMode, setTransferMode] = useState<null | 'deposit' | 'withdraw' | 'other'>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [amountDialog, setAmountDialog] = useState<null | { kind: 'opening' | 'adjust'; account: MoneyAccount }>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = rangeDates(range);
    try {
      const [sum, tx, exp, cats] = await Promise.all([
        apiFetch(`/finance/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
        apiFetch(`/finance/transactions?limit=200&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${accountFilter ? `&accountId=${accountFilter}` : ''}`),
        apiFetch(`/finance/expenses?limit=200&includeCancelled=true&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
        apiFetch('/finance/expense-categories'),
      ]);
      setSummary(sum);
      setRows(tx.data || []);
      setExpenses(exp.data || []);
      setCategories(cats || []);
    } catch (err: any) {
      toast.error('โหลดข้อมูลการเงินไม่สำเร็จ: ' + (err?.message || ''));
    } finally {
      setLoading(false);
    }
  }, [range, accountFilter]);

  useEffect(() => { void load(); }, [load]);

  const accounts = useMemo(() => (summary?.accounts || []).filter((a) => a.isActive), [summary]);
  const needsOpening = accounts.filter((a) => a.type !== 'CASH_DRAWER' && !a.hasOpeningBalance);

  const cancelRow = async (row: LedgerRow) => {
    const reason = window.prompt('เหตุผลที่ยกเลิกรายการนี้');
    if (!reason) return;
    try {
      if (row.type === 'EXPENSE' && row.refId) {
        await apiFetch(`/finance/expenses/${row.refId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      } else if (row.transferGroupId) {
        await apiFetch(`/finance/transfers/${row.transferGroupId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      }
      toast.success('ยกเลิกรายการแล้ว (บันทึกเป็นรายการกลับ)');
      void load();
    } catch (err: any) {
      toast.error(err?.message || 'ยกเลิกไม่สำเร็จ');
    }
  };

  const b = summary?.balances;
  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2"><Wallet className="w-6 h-6 text-indigo-600" /> การเงินของร้าน</h1>
          <p className="text-sm text-slate-500">เงินสด / เงินในบัญชีธนาคาร / เงินเข้า-ออก / ค่าใช้จ่าย — ทุกการขาย รับชำระหนี้ และจ่ายเจ้าหนี้ ลงบัญชีให้อัตโนมัติ</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setTransferMode('deposit')} className="bg-sky-600 hover:bg-sky-700 text-white gap-1.5"><ArrowDownToLine className="w-4 h-4" /> ฝากเงินสดเข้าบัญชี</Button>
          <Button onClick={() => setTransferMode('withdraw')} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"><ArrowUpFromLine className="w-4 h-4" /> ถอนเงินจากบัญชีเป็นเงินสด</Button>
          <Button variant="outline" onClick={() => setTransferMode('other')} className="gap-1.5"><ArrowLeftRight className="w-4 h-4" /> ย้าย / แลกเงิน</Button>
          <Button onClick={() => setExpenseOpen(true)} className="bg-rose-600 hover:bg-rose-700 text-white gap-1.5"><Receipt className="w-4 h-4" /> บันทึกค่าใช้จ่าย</Button>
          <Button variant="outline" onClick={() => setOwnerOpen(true)} className="gap-1.5"><PiggyBank className="w-4 h-4" /> เงินทุน / ถอนใช้</Button>
          <Button variant="ghost" onClick={() => void load()} title="รีเฟรช"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></Button>
        </div>
      </div>

      {needsOpening.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ยังไม่ได้ตั้ง <b>ยอดยกมา</b> {needsOpening.length} บัญชี ({needsOpening.map((a) => a.name).join(', ')}) — กรอกยอดเงินจริงวันที่เริ่มใช้ระบบ ยอดคงเหลือจึงจะตรงความจริง
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'เงินทั้งหมดของร้าน', value: b?.total, cls: 'bg-indigo-600 text-white border-indigo-600' },
          { label: 'เงินสดในลิ้นชัก', value: b?.cashInDrawers, cls: 'bg-white' },
          { label: 'เงินสดในเซฟ', value: b?.cashInSafe, cls: 'bg-white' },
          { label: 'เงินในบัญชีธนาคาร', value: b?.bank, cls: 'bg-white' },
          { label: 'บัตรเครดิตรอเงินเข้า', value: b?.cardPending, cls: 'bg-white' },
        ].map((k) => (
          <div key={k.label} className={`rounded-2xl border p-4 ${k.cls}`}>
            <div className="text-xs font-bold opacity-80">{k.label}</div>
            <div className="text-2xl font-black font-mono mt-1">{formatCurrency(k.value ?? 0)}</div>
          </div>
        ))}
      </div>

      {/* Accounts */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map((a) => {
          const meta = TYPE_META[a.type];
          const Icon = meta.icon;
          return (
            <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 truncate">{a.name}</div>
                  {a.bank && <div className="text-xs text-slate-500">{a.bank.accountName}</div>}
                  {a.type === 'CASH_DRAWER' && (
                    <div className="text-xs text-slate-500">{a.openShift ? `กะ ${a.openShift.shiftNumber} (${a.openShift.cashier || ''}) เปิดอยู่` : 'ไม่มีกะเปิดอยู่'}</div>
                  )}
                </div>
                <Badge className={`border ${meta.tone} gap-1 shrink-0`}><Icon className="w-3.5 h-3.5" /> {meta.label}</Badge>
              </div>
              <div className={`text-2xl font-black font-mono ${a.balance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{formatCurrency(a.balance)}</div>
              <div className="flex flex-wrap gap-2">
                {a.type !== 'CASH_DRAWER' && !a.hasOpeningBalance && (
                  <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => setAmountDialog({ kind: 'opening', account: a })}>ตั้งยอดยกมา</Button>
                )}
                {a.type !== 'CASH_DRAWER' && a.hasOpeningBalance && (
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => setAmountDialog({ kind: 'adjust', account: a })}><Scale className="w-3.5 h-3.5" /> ปรับยอดตามจริง</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => { setAccountFilter(a.id); setTab('ledger'); }}>ดูรายการ</Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Flow */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-slate-900">เงินเข้า - ออก</h2>
          <div className="flex gap-1">
            {([['today', 'วันนี้'], ['7d', '7 วัน'], ['month', 'เดือนนี้']] as [Range, string][]).map(([r, l]) => (
              <Button key={r} size="sm" variant={range === r ? 'default' : 'outline'} onClick={() => setRange(r)}>{l}</Button>
            ))}
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div className="space-y-1">
            <div className="flex justify-between font-bold text-emerald-700"><span>เงินเข้า</span><span className="font-mono">{formatCurrency(summary?.flow.totalIn ?? 0)}</span></div>
            {Object.entries(summary?.flow.inByType || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between text-slate-600"><span>{k}</span><span className="font-mono">{formatCurrency(v)}</span></div>
            ))}
          </div>
          <div className="space-y-1">
            <div className="flex justify-between font-bold text-rose-700"><span>เงินออก</span><span className="font-mono">{formatCurrency(summary?.flow.totalOut ?? 0)}</span></div>
            {Object.entries(summary?.flow.outByType || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between text-slate-600"><span>{k}</span><span className="font-mono">{formatCurrency(v)}</span></div>
            ))}
          </div>
          <div className="space-y-1">
            <div className="flex justify-between font-bold text-slate-800"><span>ค่าใช้จ่ายตามหมวด</span></div>
            {Object.keys(summary?.flow.expenseByCategory || {}).length === 0 && <div className="text-slate-400">ยังไม่มีค่าใช้จ่ายในช่วงนี้</div>}
            {Object.entries(summary?.flow.expenseByCategory || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between text-slate-600"><span>{k}</span><span className="font-mono">{formatCurrency(v)}</span></div>
            ))}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-black"><span>สุทธิ (เข้า − ออก)</span><span className={`font-mono ${(summary?.flow.net ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatCurrency(summary?.flow.net ?? 0)}</span></div>
          </div>
        </div>
        <p className="text-xs text-slate-400">การย้ายเงินระหว่างบัญชีของร้าน (ฝาก / ถอน / แลกเงิน / ส่งเงินปิดกะ) ไม่นับเป็นเงินเข้าหรือออก</p>
      </div>

      {/* Tabs */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          {([['ledger', 'รายการเงินเข้า-ออกทั้งหมด'], ['expenses', 'ค่าใช้จ่าย'], ['categories', 'หมวดค่าใช้จ่าย']] as const).map(([k, l]) => (
            <Button key={k} size="sm" variant={tab === k ? 'default' : 'ghost'} onClick={() => setTab(k)}>{l}</Button>
          ))}
          {tab === 'ledger' && (
            <select className="ml-auto h-9 rounded-lg border border-slate-300 px-2 text-sm" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
              <option value="">ทุกบัญชี</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
        {tab === 'ledger' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="p-2 text-left">วันเวลา</th><th className="p-2 text-left">บัญชี</th><th className="p-2 text-left">ประเภท</th>
                <th className="p-2 text-left">รายละเอียด</th><th className="p-2 text-right">เข้า</th><th className="p-2 text-right">ออก</th><th className="p-2" />
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">ไม่มีรายการในช่วงนี้</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} className={`border-t border-slate-100 ${r.isReversed || r.type === 'REVERSAL' ? 'text-slate-400' : ''}`}>
                    <td className="p-2 whitespace-nowrap">{new Date(r.occurredAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="p-2">{r.account.name}</td>
                    <td className="p-2">{r.typeLabel}{r.category ? ` · ${r.category.name}` : ''}{r.isReversed && <Badge className="ml-1 bg-slate-200 text-slate-600">ยกเลิกแล้ว</Badge>}</td>
                    <td className="p-2">{r.note}</td>
                    <td className="p-2 text-right font-mono text-emerald-700">{r.direction === 'IN' ? formatCurrency(r.amount) : ''}</td>
                    <td className="p-2 text-right font-mono text-rose-700">{r.direction === 'OUT' ? formatCurrency(r.amount) : ''}</td>
                    <td className="p-2 text-right">
                      {r.canCancel && (r.type === 'EXPENSE' || r.direction === 'OUT') && (
                        <Button size="sm" variant="ghost" className="text-rose-600 gap-1" onClick={() => void cancelRow(r)}><Ban className="w-3.5 h-3.5" /> ยกเลิก</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'expenses' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="p-2 text-left">เลขที่</th><th className="p-2 text-left">วันที่จ่าย</th><th className="p-2 text-left">หมวด</th>
                <th className="p-2 text-left">รายละเอียด</th><th className="p-2 text-left">จ่ายจาก</th><th className="p-2 text-right">จำนวนเงิน</th><th className="p-2" />
              </tr></thead>
              <tbody>
                {expenses.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">ยังไม่มีค่าใช้จ่ายในช่วงนี้</td></tr>}
                {expenses.map((e) => (
                  <tr key={e.id} className={`border-t border-slate-100 ${e.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                    <td className="p-2 font-mono">{e.expenseNumber}</td>
                    <td className="p-2">{new Date(e.paidAt).toLocaleDateString('th-TH')}</td>
                    <td className="p-2">{e.category.name}</td>
                    <td className="p-2">{e.description}{e.vendor ? ` (${e.vendor})` : ''}</td>
                    <td className="p-2">{e.account.name}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(Number(e.amount))}</td>
                    <td className="p-2 text-right">
                      {e.status !== 'CANCELLED' && (
                        <Button size="sm" variant="ghost" className="text-rose-600" onClick={async () => {
                          const reason = window.prompt('เหตุผลที่ยกเลิกค่าใช้จ่ายนี้');
                          if (!reason) return;
                          try {
                            await apiFetch(`/finance/expenses/${e.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
                            toast.success('ยกเลิกค่าใช้จ่ายแล้ว เงินคืนเข้าบัญชีเดิม');
                            void load();
                          } catch (err: any) { toast.error(err?.message || 'ยกเลิกไม่สำเร็จ'); }
                        }}>ยกเลิก</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'categories' && <CategoryManager categories={categories} onChanged={load} />}
      </div>

      <TransferDialog mode={transferMode} accounts={accounts} onClose={() => setTransferMode(null)} onDone={load} />
      <ExpenseDialog open={expenseOpen} accounts={accounts} categories={categories.filter((c) => c.isActive)} onClose={() => setExpenseOpen(false)} onDone={load} />
      <OwnerDialog open={ownerOpen} accounts={accounts} onClose={() => setOwnerOpen(false)} onDone={load} />
      <AmountDialog state={amountDialog} onClose={() => setAmountDialog(null)} onDone={load} />
    </div>
  );
}

function TransferDialog({ mode, accounts, onClose, onDone }: { mode: null | 'deposit' | 'withdraw' | 'other'; accounts: MoneyAccount[]; onClose: () => void; onDone: () => void }) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [clientId, setClientId] = useState(newId());
  const [saving, setSaving] = useState(false);
  const fromList = accounts.filter((a) => (mode === 'deposit' ? isCash(a.type) : mode === 'withdraw' ? a.type === 'BANK' || a.type === 'CARD_CLEARING' : true));
  const toList = accounts.filter((a) => (mode === 'deposit' ? a.type === 'BANK' : mode === 'withdraw' ? isCash(a.type) : true) && a.id !== fromId);

  useEffect(() => {
    if (!mode) return;
    setClientId(newId());
    setAmount('');
    setNote(mode === 'deposit' ? 'ฝากเงินสดเข้าธนาคาร' : mode === 'withdraw' ? 'ถอนเงินสดจากธนาคาร' : '');
    const f = accounts.find((a) => (mode === 'deposit' ? a.type === 'CASH_SAFE' : mode === 'withdraw' ? a.type === 'BANK' : false));
    const t = accounts.find((a) => (mode === 'deposit' ? a.type === 'BANK' : mode === 'withdraw' ? a.type === 'CASH_SAFE' : false));
    setFromId(f?.id || '');
    setToId(t?.id || '');
  }, [mode, accounts]);

  const from = accounts.find((a) => a.id === fromId);
  const submit = async () => {
    if (!fromId || !toId) return toast.error('กรุณาเลือกบัญชีต้นทางและปลายทาง');
    if (!(Number(amount) > 0)) return toast.error('กรุณาระบุจำนวนเงิน');
    setSaving(true);
    try {
      await apiFetch('/finance/transfers', { method: 'POST', body: JSON.stringify({ clientId, fromAccountId: fromId, toAccountId: toId, amount: Number(amount), note }) });
      toast.success('บันทึกการย้ายเงินแล้ว');
      onClose();
      onDone();
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  };

  const title = mode === 'deposit' ? 'ฝากเงินสดเข้าบัญชีธนาคาร' : mode === 'withdraw' ? 'ถอนเงินจากบัญชีเป็นเงินสด' : 'ย้ายเงิน / แลกเงินระหว่างบัญชี';
  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1"><span className="font-semibold">จาก</span>
            <select className={fieldCls} value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">— เลือกบัญชี —</option>
              {fromList.map((a) => <option key={a.id} value={a.id}>{a.name} (คงเหลือ {formatCurrency(a.balance)})</option>)}
            </select>
          </label>
          <label className="block space-y-1"><span className="font-semibold">ไปที่</span>
            <select className={fieldCls} value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">— เลือกบัญชี —</option>
              {toList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1"><span className="font-semibold">จำนวนเงิน</span>
            <Input type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </label>
          {from && Number(amount) > from.balance && <p className="text-xs text-rose-600">ยอดในบัญชีต้นทางไม่พอ (คงเหลือ {formatCurrency(from.balance)})</p>}
          <label className="block space-y-1"><span className="font-semibold">หมายเหตุ</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น แลกเหรียญทอน, ฝากเงินรายวัน" />
          </label>
          <p className="text-xs text-slate-500">ถ้าเลือกลิ้นชักเงินสด ต้องมีกะเปิดอยู่ ยอดนี้จะรวมในการนับเงินตอนปิดกะด้วย</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button disabled={saving} onClick={() => void submit()}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDialog({ open, accounts, categories, onClose, onDone }: { open: boolean; accounts: MoneyAccount[]; categories: Category[]; onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(today);
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [receipt, setReceipt] = useState<string | undefined>();
  const [clientId, setClientId] = useState(newId());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientId(newId());
    setAmount(''); setDescription(''); setVendor(''); setReceipt(undefined); setPaidAt(new Date().toISOString().slice(0, 10));
    setAccountId(accounts.find((a) => a.type === 'CASH_SAFE')?.id || accounts[0]?.id || '');
    setCategoryId(categories[0]?.id || '');
  }, [open, accounts, categories]);

  const onFile = (file?: File) => {
    if (!file) return setReceipt(undefined);
    if (file.size > 2_000_000) return toast.error('ไฟล์ใหญ่เกิน 2MB');
    const reader = new FileReader();
    reader.onload = () => setReceipt(String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!categoryId || !accountId) return toast.error('กรุณาเลือกหมวดและบัญชีที่จ่าย');
    if (!(Number(amount) > 0)) return toast.error('กรุณาระบุจำนวนเงิน');
    if (!description.trim()) return toast.error('กรุณาระบุรายละเอียด');
    setSaving(true);
    try {
      const paid = paidAt === today ? new Date() : new Date(`${paidAt}T12:00:00`);
      await apiFetch('/finance/expenses', {
        method: 'POST',
        body: JSON.stringify({ clientId, categoryId, accountId, amount: Number(amount), paidAt: paid.toISOString(), description, vendor: vendor || undefined, receiptImage: receipt }),
      });
      toast.success('บันทึกค่าใช้จ่ายแล้ว');
      onClose();
      onDone();
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>บันทึกค่าใช้จ่าย</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1"><span className="font-semibold">หมวดค่าใช้จ่าย</span>
            <select className={fieldCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1"><span className="font-semibold">จ่ายจาก</span>
            <select className={fieldCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} (คงเหลือ {formatCurrency(a.balance)})</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1"><span className="font-semibold">จำนวนเงิน</span>
              <Input type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </label>
            <label className="block space-y-1"><span className="font-semibold">วันที่จ่าย</span>
              <Input type="date" max={today} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </label>
          </div>
          <label className="block space-y-1"><span className="font-semibold">รายละเอียด</span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="เช่น ค่าไฟเดือน พ.ย." />
          </label>
          <label className="block space-y-1"><span className="font-semibold">จ่ายให้ (ไม่บังคับ)</span>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="เช่น การไฟฟ้า" />
          </label>
          <label className="block space-y-1"><span className="font-semibold">รูปใบเสร็จ (ไม่บังคับ)</span>
            <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-xs" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button disabled={saving} className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => void submit()}>{saving ? 'กำลังบันทึก...' : 'บันทึกค่าใช้จ่าย'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OwnerDialog({ open, accounts, onClose, onDone }: { open: boolean; accounts: MoneyAccount[]; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'CAPITAL' | 'DRAW'>('CAPITAL');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [clientId, setClientId] = useState(newId());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setClientId(newId()); setAmount(''); setNote('');
    setAccountId(accounts.find((a) => a.type === 'CASH_SAFE')?.id || accounts[0]?.id || '');
  }, [open, accounts]);
  const submit = async () => {
    if (!(Number(amount) > 0)) return toast.error('กรุณาระบุจำนวนเงิน');
    setSaving(true);
    try {
      await apiFetch('/finance/owner', { method: 'POST', body: JSON.stringify({ clientId, accountId, kind, amount: Number(amount), note }) });
      toast.success('บันทึกแล้ว');
      onClose();
      onDone();
    } catch (err: any) { toast.error(err?.message || 'บันทึกไม่สำเร็จ'); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>เงินทุน / เจ้าของถอนใช้</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={kind === 'CAPITAL' ? 'default' : 'outline'} onClick={() => setKind('CAPITAL')}>นำเงินเข้าร้าน</Button>
            <Button variant={kind === 'DRAW' ? 'default' : 'outline'} onClick={() => setKind('DRAW')}>ถอนใช้ส่วนตัว</Button>
          </div>
          <label className="block space-y-1"><span className="font-semibold">บัญชี</span>
            <select className={fieldCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} (คงเหลือ {formatCurrency(a.balance)})</option>)}
            </select>
          </label>
          <label className="block space-y-1"><span className="font-semibold">จำนวนเงิน</span>
            <Input type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block space-y-1"><span className="font-semibold">หมายเหตุ</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="text-xs text-slate-500">ไม่นับเป็นรายได้หรือค่าใช้จ่ายของร้าน</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button disabled={saving} onClick={() => void submit()}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AmountDialog({ state, onClose, onDone }: { state: null | { kind: 'opening' | 'adjust'; account: MoneyAccount }; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [clientId, setClientId] = useState(newId());
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (state) { setClientId(newId()); setValue(''); setReason(''); } }, [state]);
  if (!state) return null;
  const opening = state.kind === 'opening';
  const submit = async () => {
    if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) return toast.error('กรุณาระบุยอดเงิน');
    if (!opening && !reason.trim()) return toast.error('กรุณาระบุเหตุผล');
    setSaving(true);
    try {
      if (opening) {
        await apiFetch(`/finance/accounts/${state.account.id}/opening`, { method: 'POST', body: JSON.stringify({ clientId, amount: Number(value) }) });
      } else {
        await apiFetch(`/finance/accounts/${state.account.id}/adjust`, { method: 'POST', body: JSON.stringify({ clientId, actualBalance: Number(value), reason }) });
      }
      toast.success('บันทึกแล้ว');
      onClose();
      onDone();
    } catch (err: any) { toast.error(err?.message || 'บันทึกไม่สำเร็จ'); } finally { setSaving(false); }
  };
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{opening ? 'ตั้งยอดยกมา' : 'ปรับยอดให้ตรงความจริง'}: {state.account.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          {!opening && <p className="text-slate-600">ยอดในระบบตอนนี้ <b className="font-mono">{formatCurrency(state.account.balance)}</b> — กรอกยอดจริง (นับเงิน / ดูยอดในแอปธนาคาร) ระบบจะบันทึกส่วนต่างพร้อมเหตุผล</p>}
          {opening && <p className="text-slate-600">กรอกยอดเงินจริงที่มีอยู่ ณ วันที่เริ่มใช้ระบบการเงิน (ตั้งได้ครั้งเดียว)</p>}
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
          {!opening && <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล เช่น ค่าธรรมเนียมธนาคาร, ดอกเบี้ย, นับเงินจริง" />}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button disabled={saving} onClick={() => void submit()}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryManager({ categories, onChanged }: { categories: Category[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const add = async () => {
    if (!name.trim()) return;
    try {
      await apiFetch('/finance/expense-categories', { method: 'POST', body: JSON.stringify({ name }) });
      setName('');
      onChanged();
    } catch (err: any) { toast.error(err?.message || 'เพิ่มหมวดไม่สำเร็จ'); }
  };
  const toggle = async (c: Category) => {
    try {
      await apiFetch(`/finance/expense-categories/${c.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !c.isActive }) });
      onChanged();
    } catch (err: any) { toast.error(err?.message || 'บันทึกไม่สำเร็จ'); }
  };
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-2 max-w-md">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อหมวดใหม่ เช่น ค่าโฆษณา" />
        <Button onClick={() => void add()} className="gap-1"><Plus className="w-4 h-4" /> เพิ่ม</Button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {categories.map((c) => (
          <div key={c.id} className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${c.isActive ? 'border-slate-200' : 'border-slate-100 text-slate-400'}`}>
            <span>{c.name}</span>
            <Button size="sm" variant="ghost" onClick={() => void toggle(c)}>{c.isActive ? 'ปิดใช้' : 'เปิดใช้'}</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
