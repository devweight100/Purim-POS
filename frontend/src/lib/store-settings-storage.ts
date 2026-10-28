import { api } from './api';

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
}

const STORAGE_KEY = 'pos_store_settings_v2';

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  storeName: 'ร้านปุริม ซุปเปอร์มาร์เก็ต',
  branchName: 'สำนักงานใหญ่',
  taxId: '0105555555555',
  storePhone: '02-123-4567',
  storeEmail: 'contact@purimpos.com',
  storeAddress: '123/45 ถ.สุขุมวิท แขวงคลองตัน เขตคลองเตย กรุงเทพฯ 10110',
  receiptHeader: 'ยินดีต้อนรับสู่ร้านปุริม (Purim POS)\nเปิดบริการทุกวัน 08:00 - 20:00 น.',
  receiptFooter: 'ขอบคุณที่ใช้บริการ / Thank you\nสินค้าเปลี่ยนได้ภายใน 7 วันพร้อมใบเสร็จ\nสอบถามเพิ่มเติม Line: @purimpos',
  logoUrl: null,
  vatRate: 7,
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

function normalizeStoreSettings(settings: Partial<StoreSettings> | null | undefined): StoreSettings {
  return {
    ...DEFAULT_STORE_SETTINGS,
    ...(settings || {}),
    vatRate: Number(settings?.vatRate ?? DEFAULT_STORE_SETTINGS.vatRate),
  };
}

function mirrorStoreSettings(settings: StoreSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to mirror store settings to localStorage:', err);
  }
}

export async function loadStoreSettingsFromBackend(): Promise<StoreSettings> {
  try {
    const settings = normalizeStoreSettings(await api.settings.get());
    mirrorStoreSettings(settings);
    return settings;
  } catch (err) {
    console.warn('Failed to load store settings from backend:', err);
    return loadStoreSettings();
  }
}

export function saveStoreSettings(settings: Partial<StoreSettings>): StoreSettings {
  if (typeof window === 'undefined') return DEFAULT_STORE_SETTINGS;
  try {
    const current = loadStoreSettings();
    const updated: StoreSettings = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error('Failed to save store settings to localStorage:', err);
    return DEFAULT_STORE_SETTINGS;
  }
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
