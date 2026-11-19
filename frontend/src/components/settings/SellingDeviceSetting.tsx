'use client';
import { useSyncExternalStore } from 'react';
import { Store } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  automaticSellingDevice,
  isSellingDevice,
  sellingDeviceSetting,
  setSellingDeviceSetting,
  usePosDataPolicyVersion,
} from '@/lib/pos-data-policy';

type Choice = 'auto' | 'on' | 'off';
const noopSubscribe = () => () => {};

/**
 * Per-device switch (this browser / desktop app only, localStorage): does this machine sell? A selling device keeps
 * the POS catalogue, customer list and offline copy loaded on every screen; a back-office machine only on the POS.
 */
export function SellingDeviceSetting() {
  usePosDataPolicyVersion();
  // the answer lives in this browser's storage: drawn in the browser only (no hydration mismatch)
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const explicit = sellingDeviceSetting();
  const choice: Choice = explicit === null ? 'auto' : explicit ? 'on' : 'off';
  const auto = automaticSellingDevice();
  const active = isSellingDevice();

  const pick = (c: Choice) => {
    setSellingDeviceSetting(c === 'auto' ? null : c === 'on');
    toast.success(
      isSellingDevice()
        ? 'เครื่องนี้ใช้ขายหน้าร้าน: เก็บข้อมูลสินค้า/ลูกค้าไว้ในเครื่องตลอด (ใช้ตอนออฟไลน์ได้)'
        : 'เครื่องนี้ใช้งานหลังร้าน: โหลดข้อมูลสินค้า/ลูกค้าทั้งหมดเฉพาะตอนเปิดหน้าขาย',
    );
  };

  if (!mounted) return null;

  const options: { id: Choice; label: string; hint: string }[] = [
    {
      id: 'auto',
      label: `อัตโนมัติ (ตอนนี้: ${auto ? 'ใช้ขาย' : 'ไม่ใช้ขาย'})`,
      hint: 'ใช้ขาย เมื่อเป็นโปรแกรมร้านปุริมที่เปิดหน้าขายแล้ว หรือเครื่องนี้เคยปิดบิลขาย / มีบิลรอส่ง',
    },
    { id: 'on', label: 'ใช้ขายหน้าร้าน', hint: 'เก็บข้อมูลสินค้าและลูกค้าไว้ทุกหน้าจอ เข้าหน้าขายได้ทันที ขายได้ตอนออฟไลน์' },
    { id: 'off', label: 'ไม่ใช้ขาย (งานหลังร้านเท่านั้น)', hint: 'ประหยัดหน่วยความจำ: โหลดสินค้า/ลูกค้าทั้งหมดเฉพาะตอนเปิดหน้าขาย' },
  ];

  return (
    <Card className="bg-white border-slate-200 shadow-2xs mt-4" data-testid="selling-device-card">
      <CardHeader className="pb-3 border-b border-slate-100">
        <CardTitle className="flex items-center text-lg text-slate-900 font-bold">
          <Store className="w-5 h-5 mr-2.5 text-indigo-500" />
          เครื่องนี้ใช้ขายหน้าร้าน (เก็บข้อมูลไว้ใช้ตอนออฟไลน์)
        </CardTitle>
        <CardDescription className="text-slate-500 text-xs">
          ตั้งค่าเฉพาะเครื่องนี้ — สถานะตอนนี้: <strong className="text-slate-800">{active ? 'ใช้ขายหน้าร้าน' : 'งานหลังร้าน'}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <fieldset className="space-y-2">
          <legend className="sr-only">เครื่องนี้ใช้ขายหน้าร้าน</legend>
          {options.map((o) => (
            <label
              key={o.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${choice === o.id ? 'border-indigo-400 bg-indigo-50/60' : 'border-slate-200'}`}
            >
              <input
                type="radio"
                name="selling-device"
                value={o.id}
                checked={choice === o.id}
                onChange={() => pick(o.id)}
                className="mt-1 h-4 w-4 accent-indigo-600"
              />
              <span>
                <span className="block font-bold text-slate-900">{o.label}</span>
                <span className="block text-xs text-slate-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </CardContent>
    </Card>
  );
}
