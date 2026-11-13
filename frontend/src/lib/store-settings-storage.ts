import { api } from './api';
import type { ApiStoreSettings } from './types';
import { normalizeReceiptOptions, type ReceiptOptions } from '@shared/receipt-options';

export interface StoreSettings {
  storeName: string;
  branchName: string;
  taxId: string;
  storePhone: string;
  storeEmail: string;
  storeAddress: string;
  receiptHeader: string;
  receiptFooter: string;
  logoUrl?: string | null;
  qrImageUrl?: string | null;
  qrLabel?: string;
  vatRate: number;
  /** the shop charges VAT on sales (prices VAT-inclusive); off = no VAT on bills/receipts */
  vatEnabled: boolean;
  /** one "low stock" level for every page (StoreSettings.lowStockThreshold, default 5) */
  lowStockThreshold?: number;
  /** drawer cash in/out above this needs a manager PIN (0 = always) */
  cashMovementApprovalLimit?: number | string; // Decimal column: the server sends it as a string
  /** quantities may have up to 2 decimals (sell by metre / kg); off = whole units only */
  allowDecimalQty?: boolean;
  /** what slips / A4 documents show, every key filled (read it through lib/receipt-options getReceiptOptions) */
  receiptOptions?: ReceiptOptions;
}

/**
 * READ-ONLY OFFLINE CACHE of the server's store settings (receipt header, VAT, decimal qty…),
 * kept only so the POS and its receipts keep working when the network drops. It is overwritten
 * by every successful server response and never written by local edits.
 */
const STORAGE_KEY = 'pos_store_settings_v2';

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  storeName: 'ร้านปุริม ซุปเปอร์มาร์เก็ต',
  branchName: 'สำนักงานใหญ่',
  // No placeholder business data: a fallback must never print a fake tax id/address/phone.
  taxId: '',
  storePhone: '',
  storeEmail: '',
  storeAddress: '',
  receiptHeader: '',
  receiptFooter: 'ขอบคุณที่ใช้บริการ',
  logoUrl: null,
  vatRate: 7,
  vatEnabled: false,
  lowStockThreshold: 5,
  allowDecimalQty: false,
  receiptOptions: normalizeReceiptOptions(null),
};

export function loadStoreSettings(): StoreSettings {
  if (typeof window === 'undefined') return DEFAULT_STORE_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Fallback check for old mock or settings
      return DEFAULT_STORE_SETTINGS;
    }
    return { ...DEFAULT_STORE_SETTINGS, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Failed to load store settings from localStorage:', err);
    return DEFAULT_STORE_SETTINGS;
  }
}

function normalizeStoreSettings(settings: Partial<StoreSettings> | ApiStoreSettings | null | undefined): StoreSettings {
  return {
    ...DEFAULT_STORE_SETTINGS,
    ...(settings || {}),
    vatRate: Number(settings?.vatRate ?? DEFAULT_STORE_SETTINGS.vatRate),
    vatEnabled: settings?.vatEnabled === true,
    allowDecimalQty: settings?.allowDecimalQty === true,
    receiptOptions: normalizeReceiptOptions(settings?.receiptOptions),
    lowStockThreshold: Number.isFinite(Number(settings?.lowStockThreshold)) ? Number(settings?.lowStockThreshold) : 5,
  };
}

function mirrorStoreSettings(settings: StoreSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('purim:store-settings', { detail: settings }));
  } catch (err) {
    console.error('Failed to mirror store settings to localStorage:', err);
  }
}

/** Store settings from the server (refreshes the offline cache). Throws when unreachable. */
export async function loadStoreSettingsFromBackend(): Promise<StoreSettings> {
  const settings = normalizeStoreSettings(await api.settings.get());
  mirrorStoreSettings(settings);
  return settings;
}

export async function saveStoreSettingsToBackend(settings: Partial<StoreSettings>): Promise<StoreSettings> {
  const updated = normalizeStoreSettings({
    ...loadStoreSettings(),
    ...settings,
  });

  try {
    const saved = normalizeStoreSettings(await api.settings.update(updated));
    mirrorStoreSettings(saved);
    return saved;
  } catch (err) {
    console.error('Failed to save store settings to backend:', err);
    throw err;
  }
}

/** The store-wide low-stock level (products at or below it are "ใกล้หมด"). */
export function getLowStockThreshold(): number {
  const n = Number(loadStoreSettings().lowStockThreshold);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}
