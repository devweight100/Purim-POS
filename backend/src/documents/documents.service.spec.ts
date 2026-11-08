import { DocumentsService, formatThaiDateTime } from './documents.service';

describe('DocumentsService', () => {
  it('formats dates as dd/MM/yyyy HH:mm in Buddhist year, Bangkok time', () => {
    expect(formatThaiDateTime('2026-11-06T18:30:00Z')).toBe('07/11/2569 01:30');
    expect(formatThaiDateTime('nope')).toBe('-');
  });

  it('never loads user secrets for orders/shifts and includes the debt of an order', async () => {
    const calls: Record<string, any> = {};
    const model = (name: string) => ({
      findMany: jest.fn(async (args: any) => {
        calls[name] = args;
        return [];
      }),
    });
    const prisma: any = {
      order: model('order'),
      customerClaim: model('customerClaim'),
      shift: model('shift'),
      customerDebt: model('customerDebt'),
      debtPayment: model('debtPayment'),
      purchaseOrder: model('purchaseOrder'),
      supplierReturnNote: model('supplierReturnNote'),
      paymentVoucher: model('paymentVoucher'),
    };
    await new DocumentsService(prisma).search('ORD');
    expect(calls.order.include.user).toEqual({ select: { id: true, username: true, fullName: true } });
    expect(calls.order.include.debt).toBe(true);
    expect(calls.shift.include.user).toEqual({ select: { id: true, username: true, fullName: true } });
  });
});
