'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ExternalLink, Search, Users } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { errorText } from '@/lib/api-error';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { focusRowNav, ROW_NAV_CLASS, useRowNav } from '@/lib/use-row-nav';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** GET /debts/credit-summary (same rule as the debts page "ยังชำระไม่ครบ" / "เกินกำหนดชำระ"). */
export interface CreditSummary {
  customerCount: number;
  billCount: number;
  totalOutstanding: number;
  overdueCustomerCount: number;
  overdueBillCount: number;
  overdueAmount: number;
}

interface OwingCustomer {
  customerId: string;
  name: string;
  phone: string;
  owed: number;
  bills: number;
  oldestBillAt: string | null;
  overdueAmount: number;
  overdueBills: number;
  oldestOverdueDue: string | null;
}

/** The customer's debts on the receivables page (unpaid bills of that customer). */
export function customerDebtsHref(c: { customerId: string; name: string }) {
  return `/debts?customerId=${encodeURIComponent(c.customerId)}&customerName=${encodeURIComponent(c.name)}&status=unpaid`;
}

/**
 * Customers who still owe (dashboard credit card): amount owed, bills, oldest unpaid bill, overdue, phone.
 * ↑/↓ move, Enter opens the customer's debts; search box ↓ goes into the list.
 */
export function CreditCustomersDialog({ open, onOpenChange, summary }: { open: boolean; onOpenChange: (v: boolean) => void; summary: CreditSummary | null }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [rows, setRows] = useState<OwingCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useDebouncedValue(search.trim(), 300);
  const listRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const params = new URLSearchParams({ limit: '100' });
    if (q) params.set('search', q);
    if (overdueOnly) params.set('overdue', '1');
    const run = async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{ data: OwingCustomer[]; meta: { total: number } }>(`/debts/owing-customers?${params}`);
        if (!alive) return;
        setRows(res.data || []);
        setTotal(Number(res.meta?.total) || 0);
        setError(null);
      } catch (err) {
        if (alive) setError(errorText(err) || 'โหลดรายชื่อลูกค้าเงินเชื่อไม่สำเร็จ');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => { alive = false; };
  }, [open, q, overdueOnly]);

  const openCustomer = (c: OwingCustomer) => {
    onOpenChange(false);
    router.push(customerDebtsHref(c));
  };
  const nav = useRowNav(rows.length, (i) => openCustomer(rows[i]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[90vh] flex flex-col gap-3 bg-white p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-black text-slate-900">
            <Users className="h-5 w-5 text-amber-600" />
            ลูกค้าเงินเชื่อ (ลูกหนี้ค้างชำระ)
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {summary
              ? `${summary.customerCount.toLocaleString()} ราย · ${summary.billCount.toLocaleString()} บิล · ค้างรวม ${formatCurrency(summary.totalOutstanding)}` +
                (summary.overdueBillCount > 0 ? ` · เกินกำหนด ${summary.overdueCustomerCount.toLocaleString()} ราย ${formatCurrency(summary.overdueAmount)}` : '')
              : 'ยอดค้างชำระตามหน้าลูกหนี้'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); focusRowNav(listRef.current); } }}
              placeholder="ค้นหาชื่อ / เบอร์โทร / รหัสลูกค้า"
              aria-label="ค้นหาลูกค้าเงินเชื่อ"
              className="h-9 pl-9 text-sm"
            />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="h-4 w-4 accent-rose-600" />
            เฉพาะที่เกินกำหนดชำระ
          </label>
          <Link
            href="/debts?status=unpaid"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 text-sm font-bold text-amber-800 hover:bg-amber-100"
          >
            <ExternalLink className="h-4 w-4" />
            เปิดหน้าลูกหนี้ (ยังชำระไม่ครบ)
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-bold">ลูกค้า</th>
                <th className="px-3 py-2 text-left font-bold whitespace-nowrap">เบอร์โทร</th>
                <th className="px-3 py-2 text-right font-bold whitespace-nowrap">ยอดค้าง</th>
                <th className="px-3 py-2 text-right font-bold">บิล</th>
                <th className="px-3 py-2 text-left font-bold whitespace-nowrap">บิลเก่าสุด</th>
                <th className="px-3 py-2 text-left font-bold whitespace-nowrap">เกินกำหนด</th>
                <th className="px-3 py-2"><span className="sr-only">เปิด</span></th>
              </tr>
            </thead>
            <tbody ref={listRef} data-row-nav-root>
              {rows.map((c, i) => (
                <tr key={c.customerId} {...nav.rowProps(i)} data-testid="credit-row" className={`border-t border-slate-100 hover:bg-slate-50 ${ROW_NAV_CLASS}`}>
                  <td className="px-3 py-2 font-bold text-slate-900">{c.name}</td>
                  <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{c.phone || '-'}</td>
                  <td className="px-3 py-2 text-right font-mono font-black text-rose-600 whitespace-nowrap">{formatCurrency(c.owed)}</td>
                  <td className="px-3 py-2 text-right font-mono">{c.bills}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatDate(c.oldestBillAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {c.overdueBills > 0 ? (
                      <span className="inline-flex items-center gap-1 font-bold text-rose-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {formatCurrency(c.overdueAmount)} ({c.overdueBills} บิล) · ครบ {formatDate(c.oldestOverdueDue)}
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={customerDebtsHref(c)}
                      onClick={() => onOpenChange(false)}
                      className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 whitespace-nowrap"
                    >
                      ดูหนี้
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-400">{error || 'ไม่มีลูกค้าที่ค้างชำระ'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          {loading ? 'กำลังโหลด...' : `แสดง ${rows.length.toLocaleString()} จาก ${total.toLocaleString()} ราย (เรียงยอดค้างมากไปน้อย)`} · ↑/↓ เลือก · Enter เปิดหนี้ของลูกค้า
        </p>
      </DialogContent>
    </Dialog>
  );
}
