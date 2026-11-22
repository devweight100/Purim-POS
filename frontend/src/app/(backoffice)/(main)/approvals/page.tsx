'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatListDate } from '@/lib/utils';
import { useAuthStore } from '@/lib/store/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';

interface Approval {
  id: string; type: string; status: string; channel: string; amount: number; createdAt: string; decidedAt?: string | null; usedAt?: string | null;
  usedRef?: string | null; decisionNote?: string | null; requestedBy: string; approvedBy: string | null; reasons: { code: string; message: string }[];
}
interface Rules { maxDiscountPercent: Record<string, number>; belowCostNeedsApproval: boolean; belowPriceFloorNeedsApproval: boolean }
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'รออนุมัติ', cls: 'bg-amber-500' }, APPROVED: { label: 'อนุมัติแล้ว (ยังไม่ใช้)', cls: 'bg-sky-600' },
  USED: { label: 'อนุมัติและใช้แล้ว', cls: 'bg-emerald-600' }, REJECTED: { label: 'ปฏิเสธ', cls: 'bg-rose-600' }, EXPIRED: { label: 'หมดเวลา', cls: 'bg-slate-400' },
};
const ROLES: [string, string][] = [['CASHIER', 'แคชเชียร์'], ['WAREHOUSE', 'คลังสินค้า'], ['MANAGER', 'ผู้จัดการ']];

export default function ApprovalsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [rows, setRows] = useState<Approval[]>([]);
  const [rules, setRules] = useState<Rules | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const [list, r] = await Promise.all([apiFetch('/approvals?limit=200'), apiFetch('/approvals/rules/current')]);
      setRows(list.data || []); setRules(r);
    } catch (err) { toast.error((err as Error | undefined)?.message || 'โหลดไม่สำเร็จ'); }
  }, []);
  useEffect(() => {
    // load() only updates state after its requests
    const run = async () => { await load(); };
    void run();
  }, [load]);

  const saveRules = async () => {
    if (!rules) return;
    setSaving(true);
    try { setRules(await apiFetch('/approvals/rules/current', { method: 'PUT', body: JSON.stringify(rules) })); toast.success('บันทึกกฎการอนุมัติแล้ว'); }
    catch (err) { toast.error((err as Error | undefined)?.message || 'บันทึกไม่สำเร็จ'); } finally { setSaving(false); }
  };

  return (
    <div className="page-shell">
      <div>
        <h1 className="page-title"><ShieldCheck /> การอนุมัติโดยผู้จัดการ</h1>
        <p className="page-subtitle">ส่วนลดเกินกำหนด / ขายต่ำกว่าราคาในระบบ / ขายต่ำกว่าทุน — แคชเชียร์ต้องให้ผู้จัดการหรือเจ้าของกด PIN อนุมัติที่เครื่องขาย (ADMIN และผู้จัดการไม่ต้องขออนุมัติ)</p>
      </div>

      {rules && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 text-sm">
          <h2 className="font-bold">กฎการอนุมัติ</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            {ROLES.map(([k, label]) => (
              <label key={k} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2">
                <span>ส่วนลดสูงสุด {label}</span>
                <span className="flex items-center gap-1">
                  <Input type="number" min={0} max={100} className="w-20 h-8 text-right" disabled={role !== 'ADMIN'}
                    value={rules.maxDiscountPercent[k] ?? 0}
                    onChange={(e) => setRules({ ...rules, maxDiscountPercent: { ...rules.maxDiscountPercent, [k]: Number(e.target.value) } })} />%
                </span>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={role !== 'ADMIN'} checked={rules.belowCostNeedsApproval} onChange={(e) => setRules({ ...rules, belowCostNeedsApproval: e.target.checked })} /> ขายต่ำกว่าทุนต้องขออนุมัติ (ทุกคนที่ไม่ใช่ผู้จัดการ/ADMIN แม้มีสิทธิ์ให้ส่วนลด)</label>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={role !== 'ADMIN'} checked={rules.belowPriceFloorNeedsApproval} onChange={(e) => setRules({ ...rules, belowPriceFloorNeedsApproval: e.target.checked })} /> ขายต่ำกว่าราคาในระบบต้องขออนุมัติ (พนักงานที่ไม่มีสิทธิ์ให้ส่วนลด)</label>
          <p className="text-xs text-slate-500">ส่วนลดคิดจากส่วนลดรายการ + ส่วนลดท้ายบิล (ไม่รวมส่วนลดจากแต้มสะสมและส่วนลดเคลม) เทียบกับยอดก่อนลด</p>
          {role === 'ADMIN' && <Button disabled={saving} onClick={() => void saveRules()}>{saving ? 'กำลังบันทึก...' : 'บันทึกกฎ'}</Button>}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="tbl w-full text-sm">
          <thead ><tr>
            <th className="text-left">เวลา</th><th className="text-left">ผู้ขอ</th><th className="text-left">เหตุผล</th>
            <th className="text-right">ยอดบิล</th><th className="text-left">ผู้อนุมัติ</th><th className="text-left">วิธี</th><th className="text-left">สถานะ</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="text-center text-subtle">ยังไม่มีรายการอนุมัติ</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap">{formatListDate(r.createdAt)}</td>
                <td >{r.requestedBy}</td>
                <td >{(r.reasons || []).map((x, i) => <div key={i}>• {x.message}</div>)}{r.decisionNote && <div className="text-sub text-muted-foreground">หมายเหตุ: {r.decisionNote}</div>}</td>
                <td className="text-right tabular-nums whitespace-nowrap">{formatCurrency(r.amount)}</td>
                <td >{r.approvedBy || '-'}</td>
                <td >{r.channel === 'PIN' ? 'PIN ที่เครื่องขาย' : 'ส่งคำขอ'}</td>
                <td ><Badge className={`${STATUS[r.status]?.cls || 'bg-slate-400'} text-white`}>{STATUS[r.status]?.label || r.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
