import { describe, expect, it } from 'vitest';
import { dashboardQuery, homePathFor, isPhoneDevice, packBreakdown, pctChange, stockText } from '../mobile';
import { canAccessRoute } from '../permissions';

const water = [
  { name: 'แพ็ค', factor: 6 },
  { name: 'ลัง', factor: 12 },
];

describe('pack breakdown of a stock quantity', () => {
  it('uses the largest packs first and skips packs that do not fit', () => {
    expect(packBreakdown(88, 'ขวด', water)).toBe('7 ลัง 4 ขวด');
    expect(stockText(88, 'ขวด', water)).toBe('88 ขวด = 7 ลัง 4 ขวด');
    expect(packBreakdown(90, 'ขวด', water)).toBe('7 ลัง 1 แพ็ค');
    expect(packBreakdown(12, 'ขวด', water)).toBe('1 ลัง');
  });
  it('no breakdown below the smallest pack, for zero / negative stock or without packs', () => {
    expect(packBreakdown(5, 'ขวด', water)).toBeNull();
    expect(stockText(5, 'ขวด', water)).toBe('5 ขวด');
    expect(packBreakdown(0, 'ขวด', water)).toBeNull();
    expect(stockText(-3, 'ขวด', water)).toBe('-3 ขวด');
    expect(packBreakdown(40, 'ชิ้น', [])).toBeNull();
    expect(packBreakdown(40, 'ชิ้น', [{ name: 'ชิ้น', factor: 1 }])).toBeNull();
  });
  it('keeps decimal remainders (decimal quantities) and groups thousands', () => {
    expect(packBreakdown(25.5, 'เมตร', [{ name: 'ม้วน', factor: 10 }])).toBe('2 ม้วน 5.5 เมตร');
    expect(stockText(1250, 'ชิ้น', [{ name: 'กล่อง', factor: 100 }])).toBe('1,250 ชิ้น = 12 กล่อง 50 ชิ้น');
  });
});

describe('sales period chips', () => {
  // 2026-11-13 10:30 Bangkok
  const now = Date.parse('2026-11-13T03:30:00Z');
  it('map to the dashboard endpoint used by the back office', () => {
    expect(dashboardQuery('today', now)).toBe('/reports/dashboard?range=today&top=10&compare=1');
    expect(dashboardQuery('yesterday', now)).toBe('/reports/dashboard?startDate=2026-11-12&endDate=2026-11-12&top=10&compare=1');
    expect(dashboardQuery('7days', now)).toBe('/reports/dashboard?range=7days&top=10&compare=1');
    expect(dashboardQuery('month', now)).toBe('/reports/dashboard?range=month&top=10&compare=1');
  });
  it('change in percent, none without a previous figure', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 200)).toBe(-75);
    expect(pctChange(10, 0)).toBeNull();
  });
});

describe('landing page after login', () => {
  const phone = { width: 390, coarsePointer: true, canHover: false };
  const desktop = { width: 1366, coarsePointer: false, canHover: true };
  const tabletWithMouse = { width: 1024, coarsePointer: true, canHover: true };
  it('detects phones', () => {
    expect(isPhoneDevice(phone)).toBe(true);
    expect(isPhoneDevice(desktop)).toBe(false);
    expect(isPhoneDevice({ ...desktop, width: 600 })).toBe(true);
    expect(isPhoneDevice(tabletWithMouse)).toBe(false);
  });
  it('phones of users who may see the summary go to /m, others to the POS', () => {
    expect(homePathFor({ role: 'ADMIN' }, phone)).toBe('/m');
    expect(homePathFor({ role: 'MANAGER', permissions: [] }, phone)).toBe('/m');
    expect(homePathFor({ role: 'CASHIER', permissions: ['POS_SELL', 'VIEW_REPORTS'] }, phone)).toBe('/m');
    expect(homePathFor({ role: 'CASHIER', permissions: ['POS_SELL'] }, phone)).toBe('/pos');
    expect(homePathFor({ role: 'ADMIN' }, desktop)).toBe('/pos');
    expect(homePathFor(null, phone)).toBe('/pos');
  });
  it('/m needs VIEW_REPORTS or ADMIN / MANAGER; other routes unchanged', () => {
    expect(canAccessRoute({ role: 'CASHIER', permissions: ['POS_SELL'] }, '/m')).toBe(false);
    expect(canAccessRoute({ role: 'MANAGER', permissions: [] }, '/m')).toBe(true);
    expect(canAccessRoute({ role: 'MANAGER', permissions: [] }, '/reports')).toBe(false);
    expect(canAccessRoute({ role: 'CASHIER', permissions: ['VIEW_REPORTS'] }, '/monitor')).toBe(true);
  });
});
