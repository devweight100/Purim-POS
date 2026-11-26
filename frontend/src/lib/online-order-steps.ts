/**
 * The online-order step flow (owner 2026-11-26, docs/online-orders-flow.md): ONE "next step" per status, a step
 * indicator, a one-line hint, the list's "what to do now" text and the state of the always-visible รับเงิน button.
 * Pure: used by the online orders list, the full-screen detail and the POS held-bills sheet.
 *
 * Server rules are unchanged (shared/src/online-shop.ts nextStatuses + accept / picked / pos): this only picks the
 * normal path. ใหม่ -> รับงาน -> จัดของ -> จัดเสร็จ -> (กำลังส่ง: delivery) -> เสร็จ.
 */
import type { Fulfillment, OnlineOrderStatus } from '@shared/online-shop';

export type StepAction = 'accept' | 'prepare' | 'picked' | 'deliver' | 'done' | 'pay';

export interface StepInput {
  status: OnlineOrderStatus;
  fulfillment: Fulfillment;
  /** a POS bill is linked (ชำระแล้ว) */
  paid: boolean;
}

export interface FlowStep {
  key: 'NEW' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'DELIVERING' | 'DONE';
  label: string;
}

export interface StepInfo {
  steps: FlowStep[];
  /** index of the current step in `steps`; -1 when cancelled */
  current: number;
  /** the one next-step button, or null (closed order) */
  primary: { action: StepAction; label: string } | null;
  /** one line: what to do now */
  hint: string;
  /** short text for the list row ("รอรับงาน") */
  todo: string;
  /** the รับเงิน slot: disabled (with reason) before accepting, available while open + unpaid, paid, or hidden */
  payment: { state: 'disabled'; reason: string } | { state: 'available' } | { state: 'paid' } | { state: 'hidden' };
}

const STEPS_PICKUP: FlowStep[] = [
  { key: 'NEW', label: 'ใหม่' },
  { key: 'ACCEPTED', label: 'รับงาน' },
  { key: 'PREPARING', label: 'จัดของ' },
  { key: 'READY', label: 'จัดเสร็จ' },
  { key: 'DONE', label: 'เสร็จ' },
];
const STEPS_DELIVERY: FlowStep[] = [...STEPS_PICKUP.slice(0, 4), { key: 'DELIVERING', label: 'กำลังส่ง' }, STEPS_PICKUP[4]];

export const PAY_BEFORE_ACCEPT = 'รับงานก่อนจึงรับเงินได้';

export function onlineOrderStep({ status, fulfillment, paid }: StepInput): StepInfo {
  const delivery = fulfillment === 'DELIVERY';
  const steps = delivery ? STEPS_DELIVERY : STEPS_PICKUP;
  const current = status === 'CANCELLED' ? -1 : steps.findIndex((s) => s.key === status);
  const open = status !== 'DONE' && status !== 'CANCELLED';
  const payment: StepInfo['payment'] = paid
    ? { state: 'paid' }
    : status === 'NEW'
      ? { state: 'disabled', reason: PAY_BEFORE_ACCEPT }
      : open
        ? { state: 'available' }
        : { state: 'hidden' };
  const unpaid = !paid ? ' · ยังไม่รับเงิน' : '';
  switch (status) {
    case 'NEW':
      return {
        steps, current, payment,
        primary: { action: 'accept', label: 'รับงาน' },
        hint: delivery ? 'ตรวจรายการ ใส่ค่าส่ง แล้วกดรับงาน' : 'ตรวจรายการ แล้วกดรับงาน',
        todo: 'รอรับงาน',
      };
    case 'ACCEPTED':
      return {
        steps, current, payment,
        primary: { action: 'prepare', label: 'เริ่มจัดของ' },
        hint: 'กดเริ่มจัดของ แล้วไปหยิบของตามรายการ (พิมพ์ใบจัดของได้)',
        todo: 'รอจัดของ',
      };
    case 'PREPARING':
      return {
        steps, current, payment,
        primary: { action: 'picked', label: 'จัดของเสร็จ' },
        hint: 'หยิบของครบทุกรายการแล้ว กดจัดของเสร็จ',
        todo: 'กำลังจัดของ',
      };
    case 'READY':
      if (delivery) {
        return {
          steps, current, payment,
          primary: { action: 'deliver', label: 'ออกไปส่ง' },
          hint: paid ? 'ของพร้อมแล้ว นำของออกไปส่งแล้วกดออกไปส่ง' : 'ของพร้อมแล้ว นำของออกไปส่งแล้วกดออกไปส่ง (รับเงินก่อนหรือเก็บปลายทางก็ได้)',
          todo: 'รอส่ง' + unpaid,
        };
      }
      // pickup: closed by its payment; a paid pickup still READY (rare) is closed by hand
      return paid
        ? { steps, current, payment, primary: { action: 'done', label: 'ส่งมอบแล้ว' }, hint: 'ลูกค้ารับของแล้ว กดส่งมอบแล้ว', todo: 'รอส่งมอบ' }
        : { steps, current, payment, primary: { action: 'pay', label: 'รับเงิน' }, hint: 'ของพร้อมแล้ว รอลูกค้ามารับ: กดรับเงิน (เปิดบิลที่หน้าขาย) ออเดอร์จะเสร็จเอง', todo: 'รอรับเงิน' };
    case 'DELIVERING':
      return {
        steps, current, payment,
        primary: { action: 'done', label: 'ส่งเสร็จ' },
        hint: paid ? 'ส่งของถึงลูกค้าแล้ว กดส่งเสร็จ' : 'ส่งถึงแล้ว: รับเงิน (เปิดบิลที่หน้าขาย) แล้วกดส่งเสร็จ',
        todo: 'กำลังส่ง' + unpaid,
      };
    case 'DONE':
      return { steps, current, payment, primary: null, hint: 'ออเดอร์นี้เสร็จแล้ว', todo: 'เสร็จแล้ว' };
    default:
      return { steps, current, payment, primary: null, hint: 'ออเดอร์นี้ถูกยกเลิก', todo: 'ยกเลิกแล้ว' };
  }
}

/** Picking steps are under the claim lock (another staff member's claim disables them). */
export function isPickingAction(a: StepAction): boolean {
  return a === 'accept' || a === 'prepare' || a === 'picked';
}
