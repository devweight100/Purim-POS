import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** LINE platform base URL (tests point it at a local mock). */
const lineBase = () => (process.env.LINE_API_BASE || 'https://api.line.me').replace(/\/+$/, '');

export interface ShopConfigRow {
  enabled: boolean;
  liffId: string | null;
  loginChannelId: string | null;
  messagingToken: string | null;
  publicBaseUrl: string | null;
  allowPickup: boolean;
  allowDelivery: boolean;
  notice: string | null;
  levelNames: unknown;
}

export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; originalContentUrl: string; previewImageUrl: string };

/**
 * LINE Login ID-token verification and Messaging API pushes. The channel access token stays on the server.
 * Never throws to callers: failures come back as a result the staff screen shows.
 */
@Injectable()
export class LineService {
  private readonly log = new Logger('LineService');
  constructor(private readonly prisma: PrismaService) {}

  async config(): Promise<ShopConfigRow> {
    const row = await this.prisma.onlineShopConfig.findUnique({ where: { id: 1 } });
    return {
      enabled: row?.enabled ?? false,
      liffId: row?.liffId || null,
      loginChannelId: row?.loginChannelId || null,
      messagingToken: row?.messagingToken || null,
      publicBaseUrl: row?.publicBaseUrl || null,
      allowPickup: row?.allowPickup ?? true,
      allowDelivery: row?.allowDelivery ?? true,
      notice: row?.notice || null,
      levelNames: row?.levelNames ?? null,
    };
  }

  /** LIFF login is configured: LINE ID tokens can be verified. */
  static loginReady(c: ShopConfigRow) {
    return !!(c.liffId && c.loginChannelId);
  }

  /** Verify a LIFF ID token with LINE (POST /oauth2/v2.1/verify). */
  async verifyIdToken(idToken: string, channelId: string): Promise<{ ok: true; sub: string; name?: string; picture?: string } | { ok: false; error: string }> {
    try {
      const res = await fetch(`${lineBase()}/oauth2/v2.1/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
        signal: AbortSignal.timeout(8000),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || typeof body?.sub !== 'string' || !body.sub) return { ok: false, error: 'LINE ไม่ยืนยันตัวตน กรุณาเปิดจาก LINE ใหม่' };
      if (body.aud && String(body.aud) !== String(channelId)) return { ok: false, error: 'LINE token ไม่ใช่ของร้านนี้' };
      return { ok: true, sub: body.sub, name: typeof body.name === 'string' ? body.name : undefined, picture: typeof body.picture === 'string' ? body.picture : undefined };
    } catch {
      return { ok: false, error: 'ติดต่อ LINE ไม่ได้ กรุณาลองใหม่' };
    }
  }

  /** Push messages to one LINE user. Returns the note staff see on the order. */
  async push(to: string, messages: LineMessage[]): Promise<string> {
    if (to.startsWith('dev-')) return 'ไม่ได้ส่ง LINE (โปรไฟล์ทดสอบ)';
    const c = await this.config();
    if (!c.messagingToken) return 'ไม่ได้ส่ง LINE (ยังไม่ได้ตั้งค่า Messaging API)';
    try {
      const res = await fetch(`${lineBase()}/v2/bot/message/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${c.messagingToken}` },
        body: JSON.stringify({ to, messages: messages.slice(0, 5) }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return 'ส่ง LINE แล้ว';
      const body: any = await res.json().catch(() => ({}));
      this.log.warn(`LINE push failed ${res.status}: ${String(body?.message || '').slice(0, 200)}`);
      return `ส่ง LINE ไม่สำเร็จ (${res.status}${body?.message ? ': ' + String(body.message).slice(0, 80) : ''})`;
    } catch (e: any) {
      return `ส่ง LINE ไม่สำเร็จ (${String(e?.message || e).slice(0, 80)})`;
    }
  }

  /** Check a channel access token (GET /v2/bot/info). */
  async botInfo(token: string): Promise<{ ok: boolean; name?: string; error?: string }> {
    try {
      const res = await fetch(`${lineBase()}/v2/bot/info`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: `LINE ตอบ ${res.status}${body?.message ? ': ' + body.message : ''}` };
      return { ok: true, name: body?.displayName };
    } catch (e: any) {
      return { ok: false, error: `ติดต่อ LINE ไม่ได้ (${String(e?.message || e).slice(0, 80)})` };
    }
  }
}
