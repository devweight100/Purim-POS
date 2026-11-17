'use client';

/**
 * Staff actions on an online order (docs/online-shop.md "Claim lock"). The claim lock covers the picking phase
 * only: claim / release / take over, print the picking slip, "จัดของเสร็จ". Opening as a POS bill (one terminal at
 * a time) and taking the payment are open to every cashier.
 */
import { askConfirm } from './ask-dialog';
import { apiFetch } from './api';
import { ApiError } from './api-error';
import { getTerminalId } from './terminal-id';
import { loadStoreSettings } from './store-settings-storage';
import { onlineToPickingSlip, type OnlinePickingPayload } from './picking-slip';
import type { PosPayload } from './online-order-cart';

/** Who is preparing an order (list / detail rows). */
export interface OnlineClaim {
  userId: string;
  name: string;
  at: string | null;
}

/** "กำลังจัดโดย สมชาย · 10:05" */
export function claimLabel(c: OnlineClaim | null | undefined): string {
  if (!c) return '';
  const t = c.at ? new Date(c.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }) : '';
  return `กำลังจัดโดย ${c.name}${t ? ` · ${t} น.` : ''}`;
}

/** Who picked an order ("จัดของเสร็จ"). */
export interface OnlinePicked {
  userId: string | null;
  name: string;
  at: string;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });

/** "จัดโดย สมชาย · 10:20 น." */
export function pickedLabel(p: OnlinePicked | null | undefined): string {
  if (!p) return '';
  return `จัดโดย ${p.name} · ${hhmm(p.at)} น.`;
}

/** 409 of an order someone else holds (ApiError.data.code ONLINE_ORDER_CLAIMED). */
export function isClaimConflict(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409 && e.data?.code === 'ONLINE_ORDER_CLAIMED';
}

export const claimOrder = <T>(id: string, takeover = false) =>
  apiFetch<T>(`/online-shop/orders/${id}/claim`, { method: 'POST', body: JSON.stringify(takeover ? { takeover: true } : {}) });

export const releaseOrder = <T>(id: string) => apiFetch<T>(`/online-shop/orders/${id}/release`, { method: 'POST', body: '{}' });

/** "จัดของเสร็จ": claims the order when nobody holds it, records the picker, ends the claim (status READY). */
export const markPicked = <T>(id: string) => apiFetch<T>(`/online-shop/orders/${id}/picked`, { method: 'POST', body: '{}' });

/**
 * Cart lines of the order for this terminal (any cashier, picked or not; the claim is not touched). When it is
 * open as a bill on another terminal the cashier is asked whether to move it here (the other terminal can then
 * not take payment). Returns null when the cashier said no.
 */
export async function fetchPosPayload(
  id: string,
  confirmMove: (message: string) => boolean | Promise<boolean> = (m) => askConfirm({ title: 'ย้ายบิลมาที่เครื่องนี้?', description: m, confirmLabel: 'ย้ายมาที่เครื่องนี้' }),
): Promise<PosPayload | null> {
  const terminalId = getTerminalId();
  try {
    return await apiFetch<PosPayload>(`/online-shop/orders/${id}/pos`, { method: 'POST', body: JSON.stringify({ terminalId }) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.data?.code === 'ONLINE_ORDER_OPEN_ELSEWHERE') {
      if (!(await confirmMove(e.message))) return null;
      return apiFetch<PosPayload>(`/online-shop/orders/${id}/pos`, { method: 'POST', body: JSON.stringify({ terminalId, force: true }) });
    }
    throw e;
  }
}

/** Claims the order (server), then prints its picking slip on the slip printer / browser print preview. */
export async function printOnlinePickingSlip(id: string): Promise<OnlinePickingPayload> {
  const p = await apiFetch<OnlinePickingPayload>(`/online-shop/orders/${id}/picking-slip`, { method: 'POST', body: '{}' });
  const { printPickingSlip } = await import('@/components/pos/PickingSlipView');
  await printPickingSlip(onlineToPickingSlip(p), loadStoreSettings());
  return p;
}
