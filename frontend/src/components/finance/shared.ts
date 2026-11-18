import { formatListDate } from '@/lib/utils';
export interface FinAccount {
  id: string; name: string; type: 'CASH_DRAWER' | 'CASH_SAFE' | 'BANK' | 'CARD_CLEARING'; isActive: boolean; balance: number;
}
export interface FinCategory { id: string; name: string; isActive: boolean }
export const newClientId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `fin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
export const fieldCls = 'w-full h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm';
/** "18 พ.ย. 69" (shared list date, Bangkok) */
export const thaiDate = (d: string | Date) => formatListDate(d);
