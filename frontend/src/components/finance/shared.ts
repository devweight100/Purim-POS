export interface FinAccount {
  id: string; name: string; type: 'CASH_DRAWER' | 'CASH_SAFE' | 'BANK' | 'CARD_CLEARING'; isActive: boolean; balance: number;
}
export interface FinCategory { id: string; name: string; isActive: boolean }
export const newClientId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `fin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
export const fieldCls = 'w-full h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm';
export const thaiDate = (d: string | Date) => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
