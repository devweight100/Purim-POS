'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { parseDeliveryFee } from '@shared/online-shop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Customer form: ค่าส่ง of the online shop (per member, empty = the shop tells each time) and the LINE accounts
 * linked to this member (approved link requests; unlink = back to retail prices).
 */
export function CustomerOnlineFields({ customerId, value, onChange }: { customerId?: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [linked, setLinked] = useState<{ lineUserId: string; displayName: string | null; linkedAt: string | null }[]>([]);
  const parsed = parseDeliveryFee(text);

  useEffect(() => {
    if (!customerId) return;
    apiFetch<typeof linked>(`/online-shop/customers/${customerId}/line`).then(setLinked, () => setLinked([]));
  }, [customerId]);

  const unlink = async (lineUserId: string) => {
    if (!window.confirm('ยกเลิกการผูกบัญชี LINE นี้? ลูกค้าจะเห็นราคาปลีกในร้านออนไลน์')) return;
    try {
      await apiFetch(`/online-shop/line/${encodeURIComponent(lineUserId)}`, { method: 'DELETE' });
      setLinked((l) => l.filter((x) => x.lineUserId !== lineUserId));
      toast.success('ยกเลิกการผูกแล้ว');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ');
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
      <label className="block font-bold text-slate-700" htmlFor="customer-delivery-fee">
        ค่าส่ง (ร้านออนไลน์ LINE)
      </label>
      <div className="flex flex-wrap items-center gap-btn">
        <Input
          id="customer-delivery-fee"
          type="number"
          min={0}
          step={1}
          className="w-32"
          placeholder="ร้านแจ้ง"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const p = parseDeliveryFee(e.target.value);
            if (p.ok) onChange(p.value);
          }}
        />
        <span className="text-xs text-slate-500">บาท ต่อครั้งเมื่อให้ร้านไปส่ง (เช่น 50-120) · เว้นว่าง = ร้านแจ้งค่าส่งเองทุกครั้ง</span>
      </div>
      {!parsed.ok && <p className="text-xs text-rose-700">{parsed.error}</p>}
      {customerId && (
        <div className="text-xs text-slate-600">
          บัญชี LINE ที่ผูกไว้: {linked.length === 0 ? 'ยังไม่มี (ลูกค้าขอผูกได้จากหน้าร้านออนไลน์)' : null}
          <ul className="mt-1 flex flex-wrap gap-btn">
            {linked.map((l) => (
              <li key={l.lineUserId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1">
                <span>{l.displayName || l.lineUserId}</span>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-rose-700" onClick={() => void unlink(l.lineUserId)}>
                  ยกเลิกการผูก
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
