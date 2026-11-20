import { describe, expect, it } from 'vitest';
import { startChoices, startDecision, roleLabel } from '../start-screen';

const ctx = { sellingDevice: false, sellingSetting: null, offline: false, go: null };

describe('startChoices', () => {
  it('admin / ALL: both, back office = dashboard', () => {
    expect(startChoices({ role: 'ADMIN', permissions: [] })).toEqual({ pos: true, backOffice: '/dashboard' });
    expect(startChoices({ role: 'MANAGER', permissions: ['ALL'] })).toEqual({ pos: true, backOffice: '/dashboard' });
  });
  it('a POS-only cashier has no back office (bills / customers / shifts belong to the POS work)', () => {
    expect(startChoices({ role: 'CASHIER', permissions: ['POS_SELL'] })).toEqual({ pos: true, backOffice: null });
    expect(startChoices({ role: 'CASHIER', permissions: ['POS_SELL', 'POS_DISCOUNT'] })).toEqual({ pos: true, backOffice: null });
  });
  it('a cashier with back-office work: back office = the POS "เมนูหลัก" page', () => {
    expect(startChoices({ role: 'CASHIER', permissions: ['POS_SELL', 'POS_DISCOUNT', 'MANAGE_CLAIMS'] })).toEqual({ pos: true, backOffice: '/orders' });
    expect(startChoices({ role: 'CASHIER', permissions: ['POS_SELL', 'VIEW_REPORTS'] })).toEqual({ pos: true, backOffice: '/dashboard' });
    expect(startChoices({ role: 'CASHIER', permissions: ['POS_SELL', 'MANAGE_INVENTORY'] })).toEqual({ pos: true, backOffice: '/products' });
  });
  it('no POS: back office only', () => {
    expect(startChoices({ role: 'CASHIER', permissions: ['MANAGE_DEBTS'] })).toEqual({ pos: false, backOffice: '/customers' });
  });
});

describe('startDecision', () => {
  const both = { pos: true, backOffice: '/dashboard' };
  it('one option -> straight there', () => {
    expect(startDecision({ pos: true, backOffice: null }, ctx)).toEqual({ kind: 'go', to: '/pos', reason: 'only-pos' });
    expect(startDecision({ pos: false, backOffice: '/customers' }, ctx)).toEqual({ kind: 'go', to: '/customers', reason: 'only-backoffice' });
    expect(startDecision({ pos: false, backOffice: null }, ctx)).toMatchObject({ kind: 'go', to: '/pos' });
  });
  it('chooser with the device setting pre-selected; the setting never skips it', () => {
    expect(startDecision(both, ctx)).toEqual({ kind: 'choose', recommended: 'pos' });
    expect(startDecision(both, { ...ctx, sellingDevice: true, sellingSetting: true })).toEqual({ kind: 'choose', recommended: 'pos' });
    expect(startDecision(both, { ...ctx, sellingSetting: false })).toEqual({ kind: 'choose', recommended: 'backoffice' });
  });
  it('offline: a selling device goes to the POS, another device still chooses', () => {
    expect(startDecision(both, { ...ctx, offline: true, sellingDevice: true })).toEqual({ kind: 'go', to: '/pos', reason: 'offline' });
    expect(startDecision(both, { ...ctx, offline: true })).toEqual({ kind: 'choose', recommended: 'pos' });
  });
  it('?go= (desktop F2)', () => {
    expect(startDecision(both, { ...ctx, go: 'backoffice' })).toEqual({ kind: 'go', to: '/dashboard', reason: 'asked' });
    expect(startDecision(both, { ...ctx, go: 'pos' })).toEqual({ kind: 'go', to: '/pos', reason: 'asked' });
    expect(startDecision({ pos: true, backOffice: null }, { ...ctx, go: 'backoffice' })).toMatchObject({ to: '/pos' });
  });
  it('role labels', () => {
    expect(roleLabel('ADMIN')).toBe('ผู้ดูแลระบบ');
    expect(roleLabel('CASHIER')).toBe('แคชเชียร์');
  });
});
