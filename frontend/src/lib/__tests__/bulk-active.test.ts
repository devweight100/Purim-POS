import { describe, expect, it } from 'vitest';
import { bulkActiveActions } from '@/components/products/bulk-active';

describe('bulk bar enable / disable (only the action that applies)', () => {
  const st = { a: true, b: true, c: false, d: false };
  it('all active -> ปิด only', () => expect(bulkActiveActions(['a', 'b'], st)).toEqual({ showEnable: false, showDisable: true }));
  it('all inactive -> เปิด only', () => expect(bulkActiveActions(['c', 'd'], st)).toEqual({ showEnable: true, showDisable: false }));
  it('mixed -> both', () => expect(bulkActiveActions(['a', 'c'], st)).toEqual({ showEnable: true, showDisable: true }));
  it('unknown state -> both', () => expect(bulkActiveActions(['x'], st)).toEqual({ showEnable: true, showDisable: true }));
});
