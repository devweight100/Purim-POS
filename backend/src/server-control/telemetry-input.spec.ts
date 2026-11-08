import { BadRequestException } from '@nestjs/common';
import { parseLiveState, parseTerminalId, telemetryClientIp, MAX_CART_ITEMS } from './telemetry-input';
import { isAllowedImage } from '../settings/settings.controller';
import { normalizePermissions } from '../auth/permissions';

describe('telemetry input', () => {
  it('validates terminalId type and shape', () => {
    expect(() => parseTerminalId({ a: 1 })).toThrow(BadRequestException);
    expect(() => parseTerminalId('<img>')).toThrow(BadRequestException);
    expect(parseTerminalId('term-1')).toBe('term-1');
  });
  it('whitelists live state and caps the cart', () => {
    const s = parseLiveState({ activeAction: 'HACK', alertLevel: 'CRITICAL', cartItems: [{ name: 'x', price: 'abc' }], extra: 1 });
    expect(s?.activeAction).toBe('IDLE');
    expect(s?.alertLevel).toBe('NORMAL');
    expect((s as any).extra).toBeUndefined();
    expect(s?.cartItems?.[0].price).toBe(0);
    expect(() => parseLiveState({ cartItems: new Array(MAX_CART_ITEMS + 1).fill({}) })).toThrow(BadRequestException);
  });
  it('ignores X-Forwarded-For unless the socket is loopback', () => {
    expect(telemetryClientIp({ socket: { remoteAddress: '::ffff:192.168.1.5' }, headers: { 'x-forwarded-for': '6.6.6.6' } })).toBe('192.168.1.5');
    expect(telemetryClientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '10.0.0.7' } })).toBe('10.0.0.7');
  });
});

describe('upload filter', () => {
  it('needs an image mimetype AND a matching extension', () => {
    expect(isAllowedImage({ mimetype: 'image/png', originalname: 'a.png' })).toBe(true);
    expect(isAllowedImage({ mimetype: 'image/jpeg', originalname: 'a.JPG' })).toBe(true);
    expect(isAllowedImage({ mimetype: 'text/html', originalname: 'a.png' })).toBe(false);
    expect(isAllowedImage({ mimetype: 'image/png', originalname: 'a.html' })).toBe(false);
    expect(isAllowedImage({ mimetype: 'image/svg+xml', originalname: 'a.svg' })).toBe(false);
  });
});

describe('permissions', () => {
  it('must be an array of known strings', () => {
    expect(() => normalizePermissions('ALL')).toThrow(BadRequestException);
    expect(() => normalizePermissions(['POS_SELL', 'X'])).toThrow(BadRequestException);
    expect(normalizePermissions(['POS_SELL', 'POS_SELL'])).toEqual(['POS_SELL']);
  });
});
