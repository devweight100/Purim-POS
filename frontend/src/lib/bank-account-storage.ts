import { apiFetch } from './api';

export interface BankAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch?: string | null;
  qrImageUrl?: string | null;
  qrCodeUrl?: string | null;
  color?: string;
  isDefault?: boolean;
}

/**
 * Bank accounts live on the server only. This module keeps the last server response in memory
 * (never in localStorage) so modals can read it synchronously; ClientDbSync refreshes it.
 */
let lastServerAccounts: BankAccount[] = [];
let syncPromise: Promise<BankAccount[]> | null = null;

export function normalizeBankAccount(a: any, idx = 0): BankAccount {
  const qr = a?.qrImageUrl ?? a?.qrCodeUrl ?? null;
  return {
    id: String(a?.id || `bank_${idx}`),
    bankName: String(a?.bankName || ''),
    accountName: String(a?.accountName || ''),
    accountNumber: String(a?.accountNumber || ''),
    branch: a?.branch ?? null,
    qrImageUrl: qr,
    qrCodeUrl: qr,
    color: a?.color || '#3b82f6',
    isDefault: Boolean(a?.isDefault),
  };
}

/** Remember a server response (called by api.bankAccounts.getAll). */
export function rememberServerBankAccounts(rows: any[]): BankAccount[] {
  lastServerAccounts = Array.isArray(rows) ? rows.map((a, idx) => normalizeBankAccount(a, idx)) : [];
  return lastServerAccounts;
}

/** Bank accounts from the server. Throws when the server cannot be reached. */
export async function fetchBankAccountsFromBackend(): Promise<BankAccount[]> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    try {
      return rememberServerBankAccounts(await apiFetch('/bank-accounts'));
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}

/** Last list the server returned in this session (empty until the first successful fetch). */
export function loadBankAccounts(): BankAccount[] {
  return lastServerAccounts;
}
