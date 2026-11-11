import { Prisma } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { DECIMAL_QTY_DISABLED } from '../common/qty';

/** In-memory stand-in for the Prisma transaction client (batches hold Prisma.Decimal like the real DB). */
function fakeTx(batches: { id: string; qty: string; cost: string; at: number }[], allowDecimalQty: boolean) {
  const rows = batches.map((b) => ({
    id: b.id, productId: 'p1', quantityRemaining: new Prisma.Decimal(b.qty), quantityReceived: new Prisma.Decimal(b.qty),
    unitCost: new Prisma.Decimal(b.cost), receivedAt: new Date(b.at),
  }));
  let raw = 0;
  const tx: any = {
    rows,
    $queryRaw: jest.fn(async () => (raw++ % 2 === 0
      ? [{ id: 'p1', costPrice: new Prisma.Decimal('3'), basePrice: new Prisma.Decimal('9') }]
      : rows.map((r) => ({ id: r.id, quantityRemaining: r.quantityRemaining, unitCost: r.unitCost })))),
    storeSettings: { findFirst: jest.fn(async () => ({ allowDecimalQty })) },
    product: { findFirst: jest.fn(async () => ({ id: 'p1', sku: 'S1', name: 'เชือก', unit: 'เมตร', costPrice: new Prisma.Decimal('3'), stockBatches: rows })) },
    stockBatch: {
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id)!;
        r.quantityRemaining = new Prisma.Decimal(data.quantityRemaining);
        return r;
      }),
      create: jest.fn(async ({ data }: any) => {
        const r = { id: 'new' + rows.length, productId: 'p1', quantityRemaining: new Prisma.Decimal(data.quantityRemaining), quantityReceived: new Prisma.Decimal(data.quantityReceived), unitCost: new Prisma.Decimal(data.unitCost), receivedAt: new Date() };
        rows.push(r);
        return r;
      }),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  return tx;
}

const total = (tx: any) => tx.rows.reduce((s: number, r: any) => s + Math.round(Number(r.quantityRemaining) * 100), 0) / 100;
const service = new InventoryService({} as any);

describe('decimal stock (FIFO)', () => {
  it('deducts decimal quantities across batches without residues', async () => {
    const tx = fakeTx([{ id: 'a', qty: '0.1', cost: '10', at: 1 }, { id: 'b', qty: '0.2', cost: '20', at: 2 }, { id: 'c', qty: '10.5', cost: '30', at: 3 }], true);
    const r1 = await service.deductFIFO('p1', 0.3, tx);
    expect(r1.batches.map((b: any) => [b.batchId, b.deducted])).toEqual([['a', 0.1], ['b', 0.2]]);
    expect(r1.totalCost).toBeCloseTo(0.1 * 10 + 0.2 * 20, 10);
    expect(tx.rows.find((r: any) => r.id === 'a').quantityRemaining.toString()).toBe('0');
    expect(tx.rows.find((r: any) => r.id === 'b').quantityRemaining.toString()).toBe('0');
    await service.deductFIFO('p1', 1.25, tx);
    await service.deductFIFO('p1', 2.5, tx);
    expect(tx.rows.find((r: any) => r.id === 'c').quantityRemaining.toString()).toBe('6.75');
    // every stored value has at most 2 decimals
    for (const call of tx.stockBatch.update.mock.calls) expect(String(call[0].data.quantityRemaining)).toMatch(/^-?\d+(\.\d{1,2})?$/);
  });

  it('oversells into a negative batch with an exact decimal remainder', async () => {
    const tx = fakeTx([{ id: 'a', qty: '1.1', cost: '10', at: 1 }], true);
    await service.deductFIFO('p1', 1.3, tx);
    expect(tx.rows[0].quantityRemaining.toString()).toBe('0');
    expect(tx.rows[1].quantityRemaining.toString()).toBe('-0.2');
    expect(total(tx)).toBe(-0.2);
  });

  it('adjusts ADD / SUB / SET with decimals when the store allows them', async () => {
    const tx = fakeTx([{ id: 'a', qty: '10.5', cost: '5', at: 1 }], true);
    const add = await service.adjustStock({ productId: 'p1', type: 'ADD', amount: 0.25 }, tx);
    expect(add).toMatchObject({ previousStock: 10.5, newStock: 10.75, delta: 0.25 });
    const sub = await service.adjustStock({ productId: 'p1', type: 'SUB', amount: 3.5 }, tx);
    expect(sub).toMatchObject({ previousStock: 10.75, newStock: 7.25, delta: -3.5 });
    expect(total(tx)).toBe(7.25);
    const set = await service.adjustStock({ productId: 'p1', type: 'SET', amount: 7.2 }, tx);
    expect(set).toMatchObject({ previousStock: 7.25, newStock: 7.2, delta: -0.05 });
    expect(total(tx)).toBe(7.2);
    await expect(service.adjustStock({ productId: 'p1', type: 'ADD', amount: 1.234 }, tx)).rejects.toThrow('ทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
  });

  it('rejects decimal adjustments when the store has decimal quantities turned off', async () => {
    const tx = fakeTx([{ id: 'a', qty: '10', cost: '5', at: 1 }], false);
    await expect(service.adjustStock({ productId: 'p1', type: 'ADD', amount: 1.5 }, tx)).rejects.toThrow(DECIMAL_QTY_DISABLED);
    await expect(service.adjustStock({ productId: 'p1', type: 'SET', amount: 2.5 }, tx)).rejects.toThrow(DECIMAL_QTY_DISABLED);
    const ok = await service.adjustStock({ productId: 'p1', type: 'SUB', amount: 3 }, tx);
    expect(ok.newStock).toBe(7);
  });
});
