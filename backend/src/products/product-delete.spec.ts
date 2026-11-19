import { blockerTexts, inUseMessage, stockWarning } from './product-delete';

describe('product delete texts', () => {
  it('lists only documents with a count, in the fixed order', () => {
    const b = blockerTexts({ PURCHASE_ORDER: 1, SALE: 3, CLAIM: 0 });
    expect(b.map((x) => x.text)).toEqual(['บิลขาย 3 ใบ', 'ใบสั่งซื้อ 1 ใบ']);
    expect(b.map((x) => x.code)).toEqual(['SALE', 'PURCHASE_ORDER']);
    expect(blockerTexts({})).toEqual([]);
  });

  it('refusal names the documents and offers disabling', () => {
    const m = inUseMessage('น้ำดื่ม', blockerTexts({ SALE: 3, PURCHASE_ORDER: 1 }));
    expect(m).toContain('ลบสินค้า "น้ำดื่ม" ไม่ได้');
    expect(m).toContain('มีบิลขาย 3 ใบ, ใบสั่งซื้อ 1 ใบ');
    expect(m).toContain('ปิดการใช้งาน');
  });

  it('stock warning with and without the cost value', () => {
    expect(stockWarning(24, 'ชิ้น', 288)).toBe('ยังมีสต็อก 24 ชิ้น มูลค่าทุน ฿288 จะถูกลบออกจากคลัง');
    expect(stockWarning(1234.5, 'กล่อง', 1000.25)).toBe('ยังมีสต็อก 1,234.5 กล่อง มูลค่าทุน ฿1,000.25 จะถูกลบออกจากคลัง');
    expect(stockWarning(2, '')).toBe('ยังมีสต็อก 2 ชิ้น จะถูกลบออกจากคลัง');
  });
});
