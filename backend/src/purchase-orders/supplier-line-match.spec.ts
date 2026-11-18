import { BadRequestException } from '@nestjs/common';
import { matchSupplierLine, normLine, setTrgmAvailableForTest, trigramSimilarity, trigrams } from './supplier-line-match';

describe('supplier-line-match (JavaScript trigram fallback)', () => {
  it('trigrams / similarity behave like pg_trgm', () => {
    expect(normLine('  PV-0185  ท่อ ')).toBe('pv-0185 ท่อ');
    expect(trigrams('cat')).toEqual(new Set(['  c', ' ca', 'cat', 'at ']));
    expect(trigramSimilarity('SCG PVC pipe', 'SCG PVC pipe')).toBe(1);
    expect(trigramSimilarity('SCG PVC pipe', 'scg pvc pipe 1in')).toBeGreaterThan(0.6);
    expect(trigramSimilarity('ท่อพีวีซี', 'ท่อพีวีซี 8.5')).toBeGreaterThan(0.5);
    expect(trigramSimilarity('abc', '')).toBe(0);
  });

  it('ranks supplier code exact, then barcode, then the best name; filters by minScore', async () => {
    setTrgmAvailableForTest(false);
    const rows = [
      { productId: 'a', name: 'ท่อพีวีซี 1 นิ้ว ตราช้าง', sku: '200001', manufacturerName: 'SCG PVC Pipe 1"', supplierProductName: 'ท่อ PVC 1นิ้ว ฟ้า', supplierSku: 'PV-01', purchaseOrderItemId: null, codeExact: false, barcodeExact: false, simSupplier: null, simManufacturer: null, simShop: null },
      { productId: 'b', name: 'ข้อต่อตรง', sku: '200002', manufacturerName: null, supplierProductName: null, supplierSku: 'SCG PVC', purchaseOrderItemId: null, codeExact: true, barcodeExact: false, simSupplier: null, simManufacturer: null, simShop: null },
      { productId: 'c', name: 'เทปพันเกลียว', sku: '200003', manufacturerName: null, supplierProductName: null, supplierSku: null, purchaseOrderItemId: null, codeExact: false, barcodeExact: true, simSupplier: null, simManufacturer: null, simShop: null },
      { productId: 'd', name: 'สายไฟ THW', sku: '200004', manufacturerName: null, supplierProductName: null, supplierSku: null, purchaseOrderItemId: null, codeExact: false, barcodeExact: false, simSupplier: null, simManufacturer: null, simShop: null },
    ];
    const db = { $queryRaw: jest.fn().mockResolvedValue(rows) };
    const res = await matchSupplierLine(db, { supplierId: 's1', text: 'SCG PVC Pipe' });
    expect(res.map((r) => [r.productId, r.matchedBy])).toEqual([
      ['b', 'supplierCode'],
      ['c', 'barcode'],
      ['a', 'manufacturerName'],
    ]);
    expect(res[0].score).toBe(1);
    expect(res[2].score).toBeGreaterThan(0.5);
    await expect(matchSupplierLine(db, { supplierId: '', text: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(matchSupplierLine(db, { supplierId: 's1', text: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    setTrgmAvailableForTest(null);
  });
});
