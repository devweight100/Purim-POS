import { describe, expect, it } from 'vitest';
import { nextStatuses } from '@shared/online-shop';
import { isPickingAction, onlineOrderStep, PAY_BEFORE_ACCEPT } from './online-order-steps';

describe('onlineOrderStep', () => {
  it('NEW: one button รับงาน, payment disabled with the reason, hint asks for the fee on delivery', () => {
    const d = onlineOrderStep({ status: 'NEW', fulfillment: 'DELIVERY', paid: false });
    expect(d.primary).toEqual({ action: 'accept', label: 'รับงาน' });
    expect(d.payment).toEqual({ state: 'disabled', reason: PAY_BEFORE_ACCEPT });
    expect(d.hint).toBe('ตรวจรายการ ใส่ค่าส่ง แล้วกดรับงาน');
    expect(d.todo).toBe('รอรับงาน');
    expect(d.current).toBe(0);
    expect(onlineOrderStep({ status: 'NEW', fulfillment: 'PICKUP', paid: false }).hint).not.toContain('ค่าส่ง');
  });

  it('steps: delivery has กำลังส่ง, pickup does not', () => {
    expect(onlineOrderStep({ status: 'NEW', fulfillment: 'DELIVERY', paid: false }).steps.map((s) => s.label)).toEqual(['ใหม่', 'รับงาน', 'จัดของ', 'จัดเสร็จ', 'กำลังส่ง', 'เสร็จ']);
    expect(onlineOrderStep({ status: 'NEW', fulfillment: 'PICKUP', paid: false }).steps.map((s) => s.label)).toEqual(['ใหม่', 'รับงาน', 'จัดของ', 'จัดเสร็จ', 'เสร็จ']);
  });

  it('the normal sequence, one primary per status', () => {
    const seq = (f: 'PICKUP' | 'DELIVERY', paid: boolean) =>
      (['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'DONE', 'CANCELLED'] as const).map((s) => onlineOrderStep({ status: s, fulfillment: f, paid }).primary?.label ?? null);
    expect(seq('DELIVERY', false)).toEqual(['รับงาน', 'เริ่มจัดของ', 'จัดของเสร็จ', 'ออกไปส่ง', 'ส่งเสร็จ', null, null]);
    expect(seq('PICKUP', false).slice(0, 4)).toEqual(['รับงาน', 'เริ่มจัดของ', 'จัดของเสร็จ', 'รับเงิน']);
    // pickup paid while still READY (rare: pickup is normally closed by its payment)
    expect(onlineOrderStep({ status: 'READY', fulfillment: 'PICKUP', paid: true }).primary).toEqual({ action: 'done', label: 'ส่งมอบแล้ว' });
    // paid delivery still needs ส่งเสร็จ
    expect(onlineOrderStep({ status: 'DELIVERING', fulfillment: 'DELIVERY', paid: true }).primary?.action).toBe('done');
  });

  it('list texts', () => {
    const todo = (status: Parameters<typeof onlineOrderStep>[0]['status'], fulfillment: 'PICKUP' | 'DELIVERY', paid = false) => onlineOrderStep({ status, fulfillment, paid }).todo;
    expect(todo('ACCEPTED', 'PICKUP')).toBe('รอจัดของ');
    expect(todo('PREPARING', 'PICKUP')).toBe('กำลังจัดของ');
    expect(todo('READY', 'DELIVERY', true)).toBe('รอส่ง');
    expect(todo('READY', 'DELIVERY')).toBe('รอส่ง · ยังไม่รับเงิน');
    expect(todo('READY', 'PICKUP')).toBe('รอรับเงิน');
    expect(todo('DONE', 'PICKUP')).toBe('เสร็จแล้ว');
    expect(todo('CANCELLED', 'PICKUP')).toBe('ยกเลิกแล้ว');
  });

  it('payment: available from ACCEPTED through DELIVERING while unpaid; paid shows paid; closed unpaid hides it', () => {
    for (const s of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'] as const) {
      expect(onlineOrderStep({ status: s, fulfillment: 'DELIVERY', paid: false }).payment).toEqual({ state: 'available' });
      expect(onlineOrderStep({ status: s, fulfillment: 'DELIVERY', paid: true }).payment).toEqual({ state: 'paid' });
    }
    expect(onlineOrderStep({ status: 'DONE', fulfillment: 'PICKUP', paid: true }).payment).toEqual({ state: 'paid' });
    expect(onlineOrderStep({ status: 'CANCELLED', fulfillment: 'PICKUP', paid: false }).payment).toEqual({ state: 'hidden' });
    expect(onlineOrderStep({ status: 'CANCELLED', fulfillment: 'PICKUP', paid: false }).current).toBe(-1);
  });

  it('every status change it offers is one the server allows (status buttons only)', () => {
    const to = { prepare: 'PREPARING', deliver: 'DELIVERING', done: 'DONE' } as const;
    for (const f of ['PICKUP', 'DELIVERY'] as const) {
      for (const s of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'] as const) {
        for (const paid of [false, true]) {
          const a = onlineOrderStep({ status: s, fulfillment: f, paid }).primary?.action;
          if (a && a in to) expect(nextStatuses(s, f)).toContain(to[a as keyof typeof to]);
        }
      }
    }
  });

  it('picking actions are the claim-locked ones', () => {
    expect(['accept', 'prepare', 'picked'].every((a) => isPickingAction(a as never))).toBe(true);
    expect(['deliver', 'done', 'pay'].some((a) => isPickingAction(a as never))).toBe(false);
  });
});
