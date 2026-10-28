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

export const defaultBankAccounts: BankAccount[] = [];

const STORAGE_KEY = 'custom_bank_accounts';
let lastSyncAt = 0;
let syncPromise: Promise<BankAccount[]> | null = null;

function normalizeBankAccount(a: any, idx = 0): BankAccount {
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

function readLocalBankAccounts(): BankAccount[] {
  if (typeof window === 'undefined') return defaultBankAccounts;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((a, idx) => normalizeBankAccount(a, idx));
      }
    }
  } catch {}
  return defaultBankAccounts;
}

export function mirrorBankAccountsToStorage(accounts: any[]): BankAccount[] {
  const normalized = Array.isArray(accounts)
    ? accounts.map((a, idx) => normalizeBankAccount(a, idx))
    : [];
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {}
  }
  return normalized;
}

export async function fetchBankAccountsFromBackend(): Promise<BankAccount[]> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    try {
      const rows = await apiFetch('/bank-accounts');
      if (Array.isArray(rows)) {
        lastSyncAt = Date.now();
        return mirrorBankAccountsToStorage(rows);
      }
    } catch {
      // Offline fallback to localStorage
    } finally {
      syncPromise = null;
    }
    return readLocalBankAccounts();
  })();
  return syncPromise;
}

export function loadBankAccounts(): BankAccount[] {
  const cached = readLocalBankAccounts();
  if (typeof window !== 'undefined' && Date.now() - lastSyncAt > 10000) {
    lastSyncAt = Date.now();
    void fetchBankAccountsFromBackend();
  }
  return cached;
}

export function saveBankAccounts(
  accounts: BankAccount[],
  options?: { fromBackend?: boolean },
): void {
  if (typeof window === 'undefined') return;
  const previous = readLocalBankAccounts();
  const normalized = mirrorBankAccountsToStorage(accounts);

  // Detect if rows came directly from backend API (e.g. api.bankAccounts.getAll)
  const isFromBackend =
    options?.fromBackend ||
    (Array.isArray(accounts) &&
      (accounts.length === 0 ||
        accounts.every((a: any) => a?.createdAt !== undefined || a?.updatedAt !== undefined)));

  if (isFromBackend) return;

  // Sync local UI changes (add / edit / delete / setDefault) to PostgreSQL in background
  void (async () => {
    try {
      const prevMap = new Map(previous.map((a) => [a.id, a]));
      const nextIds = new Set(normalized.map((a) => a.id));

      for (const acc of normalized) {
        if (acc.id.startsWith('bank_')) {
          try {
            const created = await apiFetch('/bank-accounts', {
              method: 'POST',
              body: JSON.stringify({
                bankName: acc.bankName,
                accountName: acc.accountName,
                accountNumber: acc.accountNumber,
                branch: acc.branch || undefined,
                qrCodeUrl: acc.qrImageUrl || acc.qrCodeUrl || undefined,
                isDefault: Boolean(acc.isDefault),
              }),
            });
            if (created?.id) {
              acc.id = created.id;
            }
          } catch {}
        } else {
          const prev = prevMap.get(acc.id);
          if (
            prev &&
            (prev.bankName !== acc.bankName ||
              prev.accountName !== acc.accountName ||
              prev.accountNumber !== acc.accountNumber ||
              prev.qrImageUrl !== acc.qrImageUrl ||
              Boolean(prev.isDefault) !== Boolean(acc.isDefault))
          ) {
            try {
              await apiFetch(`/bank-accounts/${acc.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  bankName: acc.bankName,
                  accountName: acc.accountName,
                  accountNumber: acc.accountNumber,
                  branch: acc.branch || undefined,
                  qrCodeUrl: acc.qrImageUrl || acc.qrCodeUrl || null,
                  isDefault: Boolean(acc.isDefault),
                }),
              });
            } catch {}
          }
        }
      }

      for (const prev of previous) {
        if (!prev.id.startsWith('bank_') && !nextIds.has(prev.id)) {
          try {
            await apiFetch(`/bank-accounts/${prev.id}`, { method: 'DELETE' });
          } catch {}
        }
      }

      mirrorBankAccountsToStorage(normalized);
    } catch {}
  })();
}
