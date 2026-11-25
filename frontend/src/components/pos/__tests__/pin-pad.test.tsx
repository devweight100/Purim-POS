import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PinPad } from '@/components/common/PinPad';

describe('PinPad (shared PIN dialog pad)', () => {
  const html = renderToStaticMarkup(<PinPad id="approval-pin" label="PIN ผู้อนุมัติ" value="12" onChange={() => {}} onSubmit={() => {}} />);
  it('the PIN field is a masked numeric input with the label (keyboard + tests find it)', () => {
    expect(html).toMatch(/<input[^>]*id="approval-pin"/);
    expect(html).toMatch(/type="password"/);
    expect(html).toMatch(/inputMode="numeric"/);
    expect(html).toMatch(/aria-label="PIN ผู้อนุมัติ"/);
    expect(html).toMatch(/maxLength="6"/);
  });
  it('12 on-screen keys that never take the focus away from the field', () => {
    const keys = html.match(/<button[^>]*>/g) || [];
    expect(keys).toHaveLength(12);
    expect(keys.every((k) => k.includes('tabindex="-1"') || k.includes('tabIndex="-1"'))).toBe(true);
    expect(html).toContain('Enter = ยืนยัน');
  });
});
