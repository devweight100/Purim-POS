import { afterEach, describe, expect, it } from 'vitest';
import { askConfirm, askReason, pendingAsks, registerAskHost, settleAsk } from './ask-dialog';

let unregister: (() => void) | null = null;
afterEach(() => {
  unregister?.();
  unregister = null;
});

describe('ask-dialog (in-page prompt / confirm)', () => {
  it('queues requests oldest first and resolves each with its own answer', async () => {
    unregister = registerAskHost();
    const first = askReason({ title: 'เหตุผลที่ยกเลิก' });
    const second = askReason({ title: 'อีกข้อ', defaultValue: 'ค่าเดิม', required: false });
    const [a, b] = pendingAsks();
    expect(a.options.title).toBe('เหตุผลที่ยกเลิก');
    expect(b.kind === 'reason' && b.options.defaultValue).toBe('ค่าเดิม');
    settleAsk(a.id, 'สินค้าหมด');
    expect(pendingAsks().map((r) => r.id)).toEqual([b.id]);
    settleAsk(b.id, null);
    expect(await first).toBe('สินค้าหมด');
    expect(await second).toBeNull();
    expect(pendingAsks()).toEqual([]);
  });

  it('askConfirm is true only for an explicit yes; unknown ids are ignored', async () => {
    unregister = registerAskHost();
    const yes = askConfirm({ title: 'ลบ?' });
    const no = askConfirm({ title: 'ลบอีก?' });
    const [a, b] = pendingAsks();
    settleAsk(999_999, true);
    settleAsk(a.id, true);
    settleAsk(b.id, 'x');
    expect(await yes).toBe(true);
    expect(await no).toBe(false);
  });

  it('removing the last host cancels what is pending', async () => {
    const off = registerAskHost();
    const r = askReason({ title: 'x' });
    const c = askConfirm({ title: 'y' });
    off();
    expect(await r).toBeNull();
    expect(await c).toBe(false);
    expect(pendingAsks()).toEqual([]);
  });
});
