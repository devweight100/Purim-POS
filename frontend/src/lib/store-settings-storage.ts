/**
 * Store Settings Storage & Manager
 * Manages store profile, tax ID, address, phone, and receipt header/footer customizations
 */

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
