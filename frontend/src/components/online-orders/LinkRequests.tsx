'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { askReason } from '@/lib/ask-dialog';
import { DEFAULT_LEVEL_NAMES, PRICE_LEVELS } from '@shared/online-shop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Req {
  id: string;
  lineUserId: string;
  displayName: string | null;
  phone: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  matches: { id: string; name: string; phone: string }[];
  customer: { id: string; name: string; phone: string | null } | null;
}

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * LINE accounts asking to be linked to a member (the member's price level and delivery fee then apply in the
 * shop). Never automatic: staff check the person (phone call / at the counter) and pick the member.
 */
export function LinkRequests({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [rows, setRows] = useState<Req[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newMember, setNewMember] = useState<Record<string, { name: string; level: number; fee: string }>>({});

  const load = useCallback(async () => {
    try {
      setRows(await apiFetch<Req[]>(`/online-shop/link-requests?status=${status}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    }
  }, [status]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const decide = async (r: Req, body: Record<string, unknown>, ok: string) => {
    setBusy(r.id);
    try {
      await apiFetch(`/online-shop/link-requests/${r.id}/decide`, { method: 'POST', body: JSON.stringify(body) });
      toast.success(ok);
      onChanged();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-btn">
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'default' : 'outline'} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === 'PENDING' ? 'รอตรวจสอบ' : s === 'APPROVED' ? 'ผูกแล้ว' : 'ไม่อนุมัติ'}
          </Button>
        ))}
      </div>
      <p className="text-sm text-slate-600">ลูกค้ากรอกเบอร์โทรในหน้าร้านออนไลน์ — ตรวจให้แน่ใจว่าเป็นเจ้าของเบอร์จริง (โทรกลับหรือถามที่ร้าน) ก่อนผูก เพราะลูกค้าจะได้ราคาสมาชิกและค่าส่งของสมาชิกคนนั้น</p>
      {rows?.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">ไม่มีคำขอ</p>}
      <ul className="space-y-3">
        {rows?.map((r) => {
          const nm = newMember[r.id] || { name: r.displayName || '', level: 1, fee: '' };
          return (
            <li key={r.id} data-testid="link-request" className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  LINE: {r.displayName || '-'} · เบอร์ที่กรอก <span className="font-mono">{r.phone}</span>
                </p>
                <span className="text-xs text-slate-500">{when(r.createdAt)}</span>
              </div>
              {r.status !== 'PENDING' ? (
                <p className="text-sm">
                  {r.status === 'APPROVED' ? `ผูกกับ ${r.customer?.name || '-'}` : `ไม่อนุมัติ${r.note ? `: ${r.note}` : ''}`}
                  {r.decidedAt ? ` · ${when(r.decidedAt)}` : ''}
                </p>
              ) : (
                <>
                  {r.matches.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-btn">
                      <span className="text-sm text-slate-600">สมาชิกที่เบอร์ตรงกัน:</span>
                      {r.matches.map((m) => (
                        <Button key={m.id} size="sm" disabled={busy === r.id} className="bg-emerald-700 hover:bg-emerald-800 text-white" onClick={() => void decide(r, { approve: true, customerId: m.id }, `ผูก LINE กับ ${m.name} แล้ว`)}>
                          ผูกกับ {m.name} ({m.phone})
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-amber-800">ไม่พบสมาชิกที่ใช้เบอร์นี้ — สร้างสมาชิกใหม่ หรือแก้เบอร์ของสมาชิกในหน้า “ลูกค้าสมาชิก” แล้วกลับมาที่นี่</p>
                  )}
                  <div className="flex flex-wrap items-end gap-btn rounded-xl bg-slate-50 p-3">
                    <label className="text-xs font-semibold">
                      ชื่อสมาชิกใหม่
                      <Input className="h-9 w-48" value={nm.name} onChange={(e) => setNewMember({ ...newMember, [r.id]: { ...nm, name: e.target.value } })} />
                    </label>
                    <label className="text-xs font-semibold">
                      ระดับราคา
                      <select className="block h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={nm.level} onChange={(e) => setNewMember({ ...newMember, [r.id]: { ...nm, level: Number(e.target.value) } })}>
                        {PRICE_LEVELS.map((l) => (
                          <option key={l} value={l}>{l} — {DEFAULT_LEVEL_NAMES[l]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold">
                      ค่าส่ง (บาท)
                      <Input className="h-9 w-24" type="number" min={0} value={nm.fee} placeholder="ร้านแจ้ง" onChange={(e) => setNewMember({ ...newMember, [r.id]: { ...nm, fee: e.target.value } })} />
                    </label>
                    <Button size="sm" variant="outline" disabled={busy === r.id || !nm.name.trim()} onClick={() => void decide(r, { approve: true, createCustomer: { name: nm.name, priceLevel: nm.level, deliveryFee: nm.fee === '' ? null : Number(nm.fee) } }, 'สร้างสมาชิกและผูก LINE แล้ว')}>
                      สร้างสมาชิกใหม่และผูก
                    </Button>
                  </div>
                  <Button size="sm" variant="outline" disabled={busy === r.id} className="text-rose-700 border-rose-300" onClick={async () => {
                    const note = await askReason({
                      title: 'ไม่อนุมัติคำขอผูกบัญชี LINE',
                      label: 'เหตุผลที่ไม่อนุมัติ (ลูกค้าจะเห็น)',
                      defaultValue: 'ตรวจสอบเบอร์ไม่ได้ กรุณาติดต่อร้าน',
                      required: false,
                      confirmLabel: 'ไม่อนุมัติ',
                      inputId: 'link-reject-note',
                    });
                    if (note !== null) void decide(r, { approve: false, note }, 'ไม่อนุมัติคำขอแล้ว');
                  }}>
                    ไม่อนุมัติ
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
