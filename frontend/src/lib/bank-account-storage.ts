export interface BankAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImageUrl?: string | null;
  color?: string;
  isDefault?: boolean;
}

export const defaultBankAccounts: BankAccount[] = [
  {
    id: 'bank_1',
    bankName: 'ธนาคารกสิกรไทย (KBank)',
    accountName: 'ร้านปุริม (Purim POS)',
    accountNumber: '081-234-5678',
    color: '#10b981',
    isDefault: true,
  },
  {
    id: 'bank_2',
    bankName: 'ธนาคารไทยพาณิชย์ (SCB)',
    accountName: 'ร้านปุริม (Purim POS)',
    accountNumber: '123-4-56789-0',
    color: '#8b5cf6',
    isDefault: false,
  }
];

const STORAGE_KEY = 'custom_bank_accounts';

export function loadBankAccounts(): BankAccount[] {
  if (typeof window === 'undefined') return defaultBankAccounts;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveBankAccounts(defaultBankAccounts);
      return defaultBankAccounts;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultBankAccounts;
  } catch {
    return defaultBankAccounts;
  }
}

export function saveBankAccounts(accounts: BankAccount[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch {}
}
