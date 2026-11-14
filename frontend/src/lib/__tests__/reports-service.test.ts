import { describe, expect, it, vi } from 'vitest';
import { collectAllPages, reportTabsQuery } from '../reports-service';

describe('reportTabsQuery', () => {
  it('sends paging, search and the inventory view only when set', () => {
    expect(reportTabsQuery({ range: '30days', tab: 'sales' })).toBe('range=30days&tab=sales');
    expect(reportTabsQuery({ range: 'all', tab: 'inventory', page: 3, limit: 25, q: '  ปูน ', list: 'deadstock' })).toBe(
      'range=all&tab=inventory&page=3&limit=25&q=%E0%B8%9B%E0%B8%B9%E0%B8%99&list=deadstock',
    );
    expect(reportTabsQuery({ range: 'all', tab: 'inventory', list: 'all', q: '' })).toBe('range=all&tab=inventory');
  });
  it('custom range carries start / end; other ranges ignore them', () => {
    expect(reportTabsQuery({ range: 'custom', start: '2026-01-01', end: '2026-01-31' })).toBe('range=custom&start=2026-01-01&end=2026-01-31');
    expect(reportTabsQuery({ range: 'today', start: '2026-01-01' })).toBe('range=today');
  });
});

describe('collectAllPages (export fetches every page)', () => {
  it('asks page after page until every row is in', async () => {
    const all = Array.from({ length: 1203 }, (_, i) => i);
    const fetchPage = vi.fn(async (page: number, limit: number) => ({ rows: all.slice((page - 1) * limit, page * limit), total: all.length }));
    expect(await collectAllPages(fetchPage, 500)).toEqual(all);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
  });
  it('stops on an exact multiple without an extra empty page', async () => {
    const fetchPage = vi.fn(async (page: number) => ({ rows: page <= 2 ? [1, 2] : [], total: 4 }));
    expect(await collectAllPages(fetchPage, 2)).toEqual([1, 2, 1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
  it('an empty list is one request', async () => {
    const fetchPage = vi.fn(async () => ({ rows: [] as number[], total: 0 }));
    expect(await collectAllPages(fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
