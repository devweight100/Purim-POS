'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BellRing, RefreshCw, Send } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatListDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface GroupsInfo {
  staffGroupId: string | null;
  hasChannelSecret: boolean;
  webhookPath: string;
  webhookUrl: string | null;
  backOfficeUrl: string;
  groups: { groupId: string; name: string | null; joinedAt: string; lastEventAt: string; left: boolean; selected: boolean }[];
}

/**
 * ตั้งค่า > ร้านออนไลน์ > "แจ้งเตือนกลุ่มพนักงานใน LINE" (Round B item 10): channel secret (write-only), the groups the
 * bot was invited to (from the webhook), pick one, "ส่งข้อความทดสอบ", back-office address used in the alert link.
 */
export function LineStaffGroupCard({ hasMessagingToken }: { hasMessagingToken: boolean }) {
  const [info, setInfo] = useState<GroupsInfo | null>(null);
  const [secret, setSecret] = useState('');
  const [backOffice, setBackOffice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<GroupsInfo>('/online-shop/line/groups');
      setInfo(r);
      setBackOffice(r.backOfficeUrl || '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โหลดกลุ่ม LINE ไม่สำเร็จ');
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async (body: Record<string, unknown>, okText: string) => {
    setBusy(true);
    try {
      await apiFetch('/online-shop/config', { method: 'PUT', body: JSON.stringify(body) });
      toast.success(okText);
      setSecret('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };
  const test = async (groupId: string) => {
    setBusy(true);
    try {
      const r = await apiFetch<{ ok: boolean; message: string }>(`/online-shop/line/groups/${encodeURIComponent(groupId)}/test`, { method: 'POST' });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="bg-white border-slate-200 shadow-2xs" data-testid="line-staff-card">
      <CardHeader className="pb-3 border-b border-slate-100">
        <CardTitle className="flex items-center gap-2 text-lg text-slate-900 font-bold">
          <BellRing className="w-5 h-5 text-emerald-700" /> แจ้งเตือนกลุ่มพนักงานใน LINE (ออเดอร์ออนไลน์ใหม่)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4 text-sm">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1 text-slate-700">
          <p>มีออเดอร์ใหม่ ระบบส่งข้อความเข้ากลุ่มทันที ถ้ายังไม่มีคนกด “รับจัดออเดอร์” หรือ “รับออเดอร์” ใน 10 นาที จะเตือนซ้ำทุก 10 นาที (สูงสุด 6 ครั้ง)</p>
          <p>
            วิธีตั้งค่า: 1) ใส่ Channel secret ด้านล่าง 2) ที่ LINE Developers ใส่ Webhook URL
            {' '}<b className="tabular-nums break-all">{info?.webhookUrl || `https://ที่อยู่เว็บร้าน${info?.webhookPath || '/api/public/line/webhook'}`}</b>{' '}
            เปิด “Use webhook” และ “Allow bot to join group chats” 3) เชิญบอทเข้ากลุ่ม LINE ของพนักงาน แล้วพิมพ์อะไรก็ได้ในกลุ่ม 4) กด “รีเฟรช” แล้วเลือกกลุ่ม
          </p>
          {!hasMessagingToken && <p className="font-medium text-warn">ยังไม่ได้ใส่ Channel access token ด้านบน: ระบบยังส่งข้อความไม่ได้</p>}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="font-semibold">Channel secret (Messaging API)</span>
            <Input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              type="password"
              autoComplete="off"
              placeholder={info?.hasChannelSecret ? 'บันทึกไว้แล้ว — ใส่ใหม่เพื่อเปลี่ยน' : 'ตัวอักษร 32 ตัวจาก Basic settings'}
            />
            <span className="text-xs text-slate-500">ใช้ตรวจว่าข้อความที่เข้ามามาจาก LINE จริง เก็บที่เครื่องแม่ ไม่แสดงกลับมาอีก</span>
          </label>
          <label className="space-y-1">
            <span className="font-semibold">ที่อยู่หลังบ้าน (ลิงก์ในข้อความแจ้งเตือน)</span>
            <Input value={backOffice} onChange={(e) => setBackOffice(e.target.value)} placeholder="http://192.168.1.10:3000" />
            <span className="text-xs text-slate-500">เปิดได้เฉพาะโทรศัพท์ / เครื่องที่ต่อ Wi-Fi ร้าน</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-btn">
          <Button disabled={busy || (!secret.trim() && !backOffice.trim())} onClick={() => void save({ ...(secret.trim() ? { channelSecret: secret.trim() } : {}), backOfficeUrl: backOffice.trim() }, 'บันทึกการตั้งค่าแจ้งเตือนแล้ว')}>บันทึก</Button>
          <Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className="w-4 h-4" /> รีเฟรชรายชื่อกลุ่ม</Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th className="text-left">กลุ่ม LINE ที่บอทอยู่</th>
                <th className="text-left whitespace-nowrap">ล่าสุด</th>
                <th className="text-center">ใช้แจ้งเตือน</th>
                <th className="text-center"><span className="sr-only">ทดสอบ</span></th>
              </tr>
            </thead>
            <tbody>
              {!info ? (
                <tr><td colSpan={4} className="tbl-empty">กำลังโหลด...</td></tr>
              ) : info.groups.length === 0 ? (
                <tr><td colSpan={4} className="tbl-empty">ยังไม่พบกลุ่ม: เชิญบอทเข้ากลุ่มแล้วพิมพ์ข้อความในกลุ่ม 1 ครั้ง</td></tr>
              ) : info.groups.map((g) => (
                <tr key={g.groupId} data-testid="line-group-row">
                  <td>
                    <div className="font-medium text-fg">{g.name || 'กลุ่ม (ไม่ทราบชื่อ)'}{g.left && <span className="ml-2 text-sub text-danger">บอทออกจากกลุ่มแล้ว</span>}</div>
                    <div className="text-sub text-muted-foreground break-all">{g.groupId}</div>
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">{formatListDateTime(g.lastEventAt)}</td>
                  <td className="text-center">
                    <input
                      type="radio"
                      name="staff-group"
                      aria-label={`ใช้กลุ่ม ${g.name || g.groupId} แจ้งเตือน`}
                      checked={g.selected}
                      disabled={busy || g.left}
                      onChange={() => void save({ staffGroupId: g.groupId }, `เลือกกลุ่ม "${g.name || g.groupId}" สำหรับแจ้งเตือนแล้ว`)}
                    />
                  </td>
                  <td className="text-center">
                    <Button size="sm" variant="outline" disabled={busy || g.left || !hasMessagingToken} onClick={() => void test(g.groupId)}>
                      <Send className="w-3.5 h-3.5" /> ส่งข้อความทดสอบ
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {info?.staffGroupId && (
          <Button variant="outline" className="text-rose-700 border-rose-300" disabled={busy} onClick={() => void save({ staffGroupId: '' }, 'ปิดการแจ้งเตือนกลุ่มพนักงานแล้ว')}>
            ปิดการแจ้งเตือนกลุ่ม
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
