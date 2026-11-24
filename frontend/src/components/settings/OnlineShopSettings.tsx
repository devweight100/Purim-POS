'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Globe, ExternalLink } from 'lucide-react';
import { LineStaffGroupCard } from './LineStaffGroupCard';
import { apiFetch } from '@/lib/api';
import { PRICE_LEVELS, type PriceLevel } from '@shared/online-shop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { askConfirm } from '@/lib/ask-dialog';

interface AdminConfig {
  enabled: boolean;
  liffId: string | null;
  loginChannelId: string | null;
  publicBaseUrl: string | null;
  allowPickup: boolean;
  allowDelivery: boolean;
  notice: string | null;
  levelNames: Record<PriceLevel, string>;
  hasMessagingToken: boolean;
  messagingTokenHint: string | null;
  gatewayPort: number | null;
  publicHost: string | null;
  hasChannelSecret: boolean;
  staffGroupId: string | null;
  backOfficeUrl: string | null;
}

/**
 * ตั้งค่า > ร้านออนไลน์ (LINE): switches, LIFF ID + LINE Login channel ID (ID-token check), Messaging API channel
 * access token (write-only: typed here, stored on the server, never shown again), public address for links.
 */
export function OnlineShopSettings() {
  const [c, setC] = useState<AdminConfig | null>(null);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<AdminConfig>('/online-shop/config').then(setC, (e) => toast.error(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ'));
  }, []);
  if (!c) return <p className="text-sm text-slate-500" role="tabpanel">กำลังโหลด…</p>;

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled: c.enabled, liffId: c.liffId || '', loginChannelId: c.loginChannelId || '', publicBaseUrl: c.publicBaseUrl || '',
        allowPickup: c.allowPickup, allowDelivery: c.allowDelivery, notice: c.notice || '', levelNames: c.levelNames, ...extra,
      };
      if (token.trim()) body.messagingToken = token.trim();
      setC(await apiFetch<AdminConfig>('/online-shop/config', { method: 'PUT', body: JSON.stringify(body) }));
      setToken('');
      toast.success('บันทึกการตั้งค่าร้านออนไลน์แล้ว');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    const r: { ok: boolean; name?: string; error?: string } = await apiFetch<{ ok: boolean; name?: string; error?: string }>('/online-shop/config/test-line', { method: 'POST' }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (r.ok) toast.success(`เชื่อมต่อ LINE OA ได้: ${r.name || ''}`);
    else toast.error(r.error || 'เชื่อมต่อไม่ได้');
  };

  const loginReady = !!(c.liffId && c.loginChannelId);
  const shopUrl = c.publicBaseUrl ? `${c.publicBaseUrl}/shop` : null;
  return (
    <div className="max-w-5xl space-y-5" role="tabpanel">
      <Card className="bg-white border-slate-200 shadow-2xs">
        <CardHeader className="pb-3 border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-lg text-slate-900 font-bold">
            <Globe className="w-5 h-5 text-emerald-700" /> ร้านออนไลน์ใน LINE
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4 text-sm">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
            <p>
              สถานะ: {c.enabled ? <b className="text-emerald-700">เปิดรับออเดอร์</b> : <b className="text-slate-600">ปิดอยู่</b>} ·
              {' '}LINE Login: {loginReady ? <b className="text-emerald-700">ตั้งค่าแล้ว</b> : <b className="text-amber-700">ยังไม่ตั้งค่า (ใช้โหมดทดสอบได้เฉพาะในร้าน)</b>} ·
              {' '}ส่งข้อความ LINE: {c.hasMessagingToken ? <b className="text-emerald-700">ตั้งค่าแล้ว ({c.messagingTokenHint})</b> : <b className="text-amber-700">ยังไม่ตั้งค่า (ไม่ส่งข้อความ)</b>}
            </p>
            <p className="text-slate-600">
              ทดลองในร้าน: <a href="/shop" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">เปิดหน้าร้าน /shop <ExternalLink className="w-3 h-3" /></a>
              {shopUrl && <> · ลูกค้าเปิดจาก: <span className="tabular-nums">{shopUrl}</span></>}
            </p>
            <p className="text-slate-600">
              Cloudflare Tunnel ต้องชี้มาที่ <span className="tabular-nums">http://127.0.0.1:{c.gatewayPort || 3080}</span> เท่านั้น (เปิดได้เฉพาะหน้าร้านออนไลน์) — วิธีตั้งค่าดูคู่มือ “ร้านออนไลน์ LINE” ในโฟลเดอร์ติดตั้งเครื่องแม่
            </p>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} /> เปิดรับออเดอร์ออนไลน์</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={c.allowPickup} onChange={(e) => setC({ ...c, allowPickup: e.target.checked })} /> ให้รับเองที่ร้าน</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={c.allowDelivery} onChange={(e) => setC({ ...c, allowDelivery: e.target.checked })} /> มีบริการส่งของ</label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="font-semibold">LIFF ID</span>
              <Input value={c.liffId || ''} onChange={(e) => setC({ ...c, liffId: e.target.value })} placeholder="1234567890-AbCdEfGh" />
              <span className="text-xs text-slate-500">LINE Developers › LINE Login channel › LIFF</span>
            </label>
            <label className="space-y-1">
              <span className="font-semibold">Channel ID ของ LINE Login</span>
              <Input value={c.loginChannelId || ''} onChange={(e) => setC({ ...c, loginChannelId: e.target.value })} placeholder="1650000000" inputMode="numeric" />
              <span className="text-xs text-slate-500">ใช้ตรวจว่าลูกค้าเข้าจาก LINE จริง</span>
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="font-semibold">Channel access token (Messaging API)</span>
              <Input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" placeholder={c.hasMessagingToken ? `บันทึกไว้แล้ว (${c.messagingTokenHint}) — ใส่ใหม่เพื่อเปลี่ยน` : 'วาง token ยาว ๆ จาก LINE Developers'} />
              <span className="text-xs text-slate-500">เก็บที่เครื่องแม่เท่านั้น ไม่แสดงกลับมาอีก ใช้ส่งข้อความแจ้งลูกค้า (รับออเดอร์ / ยืนยันพร้อม QR / ยกเลิก / กำลังส่ง / เสร็จ)</span>
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="font-semibold">ที่อยู่เว็บร้าน (https)</span>
              <Input value={c.publicBaseUrl || ''} onChange={(e) => setC({ ...c, publicBaseUrl: e.target.value })} placeholder="https://shop.ชื่อร้าน.com" />
              <span className="text-xs text-slate-500">ใช้ทำลิงก์ในข้อความ LINE และรูป QR พร้อมเพย์</span>
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="font-semibold">ประกาศหน้าร้าน (ไม่บังคับ)</span>
              <Input value={c.notice || ''} onChange={(e) => setC({ ...c, notice: e.target.value })} placeholder="เช่น สั่งก่อน 15:00 ส่งภายในวัน" maxLength={300} />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="font-semibold">ชื่อราคาที่ลูกค้าเห็น (ลูกค้าทั่วไปเห็นราคาระดับ 1 สมาชิกที่ผูก LINE เห็นราคาระดับของตัวเอง)</legend>
            <div className="grid gap-2 sm:grid-cols-5">
              {PRICE_LEVELS.map((l) => (
                <label key={l} className="space-y-1">
                  <span className="text-xs text-slate-600">ระดับ {l}</span>
                  <Input value={c.levelNames[l]} onChange={(e) => setC({ ...c, levelNames: { ...c.levelNames, [l]: e.target.value } })} />
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-btn pt-2">
            <Button disabled={saving} onClick={() => void save()}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</Button>
            <Button variant="outline" disabled={!c.hasMessagingToken} onClick={() => void test()}>ทดสอบการเชื่อมต่อ LINE</Button>
            {c.hasMessagingToken && (
              <Button variant="outline" className="text-rose-700 border-rose-300" disabled={saving} onClick={async () => { if (await askConfirm({ title: 'ลบ token ส่งข้อความ LINE?', confirmLabel: 'ลบ token', danger: true })) void save({ messagingToken: '' }); }}>
                ลบ token
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <LineStaffGroupCard hasMessagingToken={c.hasMessagingToken} />
    </div>
  );
}
