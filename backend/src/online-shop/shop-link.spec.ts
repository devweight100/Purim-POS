import { shopLink } from './online-shop.service';

describe('shopLink (links in LINE messages)', () => {
  it('goes through the LIFF URL when LINE login is configured', () => {
    expect(shopLink({ liffId: '1234567890-AbCdEfGh', loginChannelId: '1234567890', publicBaseUrl: 'https://shop.example.com' }, '/orders/abc')).toBe('https://liff.line.me/1234567890-AbCdEfGh/orders/abc');
    expect(shopLink({ liffId: '1234567890-AbCdEfGh', loginChannelId: '1234567890', publicBaseUrl: null }, '')).toBe('https://liff.line.me/1234567890-AbCdEfGh');
  });
  it('falls back to the web address, else no link', () => {
    expect(shopLink({ liffId: null, loginChannelId: null, publicBaseUrl: 'https://shop.example.com/' }, '/orders/abc')).toBe('https://shop.example.com/shop/orders/abc');
    expect(shopLink({ liffId: null, loginChannelId: null, publicBaseUrl: 'http://lan' }, '')).toBeNull();
  });
});
