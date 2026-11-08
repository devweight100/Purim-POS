import { channelOf, deriveTotals } from './sales-math';

describe('sales totals (shared by P&L, sales summary, dashboard)', () => {
  // QA dataset: list 656, line discount 10, bill discounts 21, one return of 1 x B (list 50, refund 50, cost 20)
  const t = deriveTotals({
    completedCount: 8, voidedCount: 1, voidedAmount: 50,
    billsInclVat: 625, billsVat: 0, billsCogs: 265,
    listValue: 656, lineDiscounts: 10, billDiscounts: 21, unitsSold: 27,
    returns: { count: 1, amount: 50, vat: 0, cogs: 20, listValue: 50, units: 1 },
  });
  it('nets returns out of sales and COGS', () => {
    expect(t.netSales).toBe(575);
    expect(t.cogs).toBe(245);
    expect(t.grossProfit).toBe(330);
  });
  it('gross = list price before any discount; discounts include line discounts; gross - discounts = net', () => {
    expect(t.grossSales).toBe(606);
    expect(t.discounts).toBe(31);
    expect(t.grossSales - t.discounts).toBe(t.netSales);
  });
  it('returned goods carry their share of the bill discount', () => {
    // bill 100 list, 20 bill discount -> refund for half the goods is 40 (list 50)
    const r = deriveTotals({
      completedCount: 1, voidedCount: 0, voidedAmount: 0, billsInclVat: 80, billsVat: 0, billsCogs: 40,
      listValue: 100, lineDiscounts: 0, billDiscounts: 20, unitsSold: 2,
      returns: { count: 1, amount: 40, vat: 0, cogs: 20, listValue: 50, units: 1 },
    });
    expect(r.netSales).toBe(40);
    expect(r.grossSales).toBe(50);
    expect(r.discounts).toBe(10);
  });
  it('VAT of returns is subtracted from output VAT', () => {
    const r = deriveTotals({
      completedCount: 1, voidedCount: 0, voidedAmount: 0, billsInclVat: 50, billsVat: 3.27, billsCogs: 20,
      listValue: 50, lineDiscounts: 0, billDiscounts: 0, unitsSold: 2,
      returns: { count: 1, amount: 25, vat: 1.64, cogs: 10, listValue: 25, units: 1 },
    });
    expect(r.outputVat).toBe(1.63);
    expect(r.revenueExVat).toBe(23.37);
  });
  it('maps payment methods to channels (CREDIT_DEBT is credit, not cash)', () => {
    expect(channelOf('CREDIT_DEBT')).toBe('CREDIT');
    expect(channelOf('DEBT_REDUCTION')).toBe('CREDIT');
    expect(channelOf('TRANSFER')).toBe('QR_TRANSFER');
    expect(channelOf('CASH')).toBe('CASH');
  });
});
