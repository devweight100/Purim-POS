/**
 * Member points rule and member import row check (docs/round-shift-today-bundle-replace.md section 5).
 * Runs under backend jest and frontend vitest (global describe / it / expect).
 */
import { DEFAULT_SHOP_POINT_RATES, discountForPoints, effectivePointRates, pointRatesText, pointsForSale, shopPointRates } from '../src/loyalty';
import { memberColumnOf, normalizeImportPhone, parseMemberRow } from '../src/member-import';

describe('shop point rates', () => {
  it('defaults are what the system always used (500 baht -> 10 points, 100 points -> 1 baht)', () => {
    expect(shopPointRates(null)).toEqual(DEFAULT_SHOP_POINT_RATES);
    expect(shopPointRates({})).toMatchObject({ earnBaht: 500, earnPoints: 10, redeemPoints: 100, redeemBaht: 1, minRedeemPoints: 0, enabled: true });
  });
  it('reads the saved shop config; empty / 0 / junk values fall back to the defaults', () => {
    const r = shopPointRates({ defaultPointEarnRateBaht: 100, defaultPointEarnUnits: '5', defaultPointRedeemRatePoints: 0, defaultPointRedeemDiscountBaht: 'x', minRedeemPoints: 20, isLoyaltyEnabled: false });
    expect(r).toEqual({ earnBaht: 100, earnPoints: 5, redeemPoints: 100, redeemBaht: 1, minRedeemPoints: 20, enabled: false });
  });
});

describe('effective member rates', () => {
  const shop = shopPointRates({ defaultPointEarnRateBaht: 100, defaultPointEarnUnits: 5, defaultPointRedeemRatePoints: 50, defaultPointRedeemDiscountBaht: 2 });
  it('a member without own rates uses the shop rate', () => {
    const r = effectivePointRates({}, shop);
    expect([r.earnBaht, r.earnPoints, r.redeemPoints, r.redeemBaht]).toEqual([100, 5, 50, 2]);
    expect(Object.values(r.fromMember).every((x) => x === false)).toBe(true);
  });
  it('a field set (> 0) is the member own; empty, null, 0 and negative are not', () => {
    const r = effectivePointRates({ pointEarnRateBaht: 200, pointEarnUnits: '', pointRedeemRatePoints: 0, pointRedeemDiscountBaht: -1 }, shop);
    expect([r.earnBaht, r.earnPoints, r.redeemPoints, r.redeemBaht]).toEqual([200, 5, 50, 2]);
    expect(r.fromMember).toEqual({ earnBaht: true, earnPoints: false, redeemPoints: false, redeemBaht: false });
  });
  it('no member at all = the shop rate; no shop given = the defaults', () => {
    expect(effectivePointRates(null, shop).earnBaht).toBe(100);
    expect(effectivePointRates({ pointEarnUnits: 3 }).earnPoints).toBe(3);
    expect(effectivePointRates(undefined).earnBaht).toBe(500);
  });
  it('points for a sale and baht for points (whole blocks only)', () => {
    expect(pointsForSale(450, effectivePointRates({}, shop))).toBe(20);
    expect(pointsForSale(1499.99, DEFAULT_SHOP_POINT_RATES)).toBe(20); // same as the old earnedPoints()
    expect(pointsForSale(450, { ...shop, enabled: false })).toBe(0);
    expect(pointsForSale(-5, shop)).toBe(0);
    expect(discountForPoints(120, shop)).toBe(4);
    expect(discountForPoints(30, shop)).toBe(0);
    expect(pointRatesText(shop)).toBe('ซื้อ 100฿ = 5 แต้ม · ใช้ 50 แต้ม = ลด 2฿');
  });
});

describe('member import rows', () => {
  it('maps Thai headers and aliases, ignoring spaces / * / case', () => {
    expect(memberColumnOf('ชื่อ *')).toBe('name');
    expect(memberColumnOf(' เบอร์โทรศัพท์ ')).toBe('phone');
    expect(memberColumnOf('แต้มสะสม')).toBe('points');
    expect(memberColumnOf('Code')).toBe('code');
    expect(memberColumnOf('สีที่ชอบ')).toBeNull();
  });
  it('keeps the leading 0 of a mobile number Excel turned into a number', () => {
    expect(normalizeImportPhone('812345678')).toBe('0812345678');
    expect(normalizeImportPhone('812345678.0')).toBe('0812345678');
    expect(normalizeImportPhone("'0812345678")).toBe('0812345678');
    expect(normalizeImportPhone('021234567')).toBe('021234567');
  });
  it('checks the cells; blank cells are left out (keep the current value)', () => {
    const ok = parseMemberRow({ rowNo: 2, values: { name: 'ร้านสมชาย', phone: '0812345678', priceLevel: '3', points: '1,200', creditLimit: '5000.50', pointEarnUnits: '' } });
    expect(ok.errors).toEqual([]);
    expect(ok.data).toEqual({ name: 'ร้านสมชาย', phone: '0812345678', priceLevel: 3, points: 1200, creditLimit: 5000.5 });
    const bad = parseMemberRow({ rowNo: 3, values: { phone: 'abc', priceLevel: '7', points: '1.5', email: 'x@', pointEarnRateBaht: '0' } });
    expect(bad.errors).toHaveLength(6);
    expect(bad.errors[0]).toBe('ไม่มีชื่อ');
  });
});
