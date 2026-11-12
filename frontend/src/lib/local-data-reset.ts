/**
 * After "ล้างข้อมูลทั้งหมด": forget every piece of shop data cached on this device (orders,
 * shifts, cart and held bills, offline queues, product/customer caches, the offline IndexedDB).
 * Only device preferences survive: who is logged in, printer / cash-drawer setup, screen mode,
 * terminal name and the store settings (re-read from the server anyway).
 */
const KEEP_KEYS = new Set([
  'auth-storage',
  'pos_cash_drawer_config',
  'pos_store_settings_v2',
  'pos_screen_mode',
  'pos_neo_screen_mode',
  'purim_terminal_id',
  'purim_terminal_custom_name',
  'purim_sidebar_scroll_top',
]);

export async function clearLocalShopData(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && !KEEP_KEYS.has(k)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    removed = keys.length;
  } catch {
    /* storage unavailable */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase('purim_pos_offline_db');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  return removed;
}

/**
 * Keys older versions used to keep their own copies of shop data (customers, debts, purchase
 * orders, claims, shifts, …). The server is now the only source of truth, so an upgraded device
 * drops them once at start-up. Device preferences, the order outbox and the cart are not here.
 */
export const LEGACY_KEYS: string[] = [
  'custom_products',
  'custom_categories',
  'custom_bank_accounts',
  'custom_customers',
  'custom_loyalty_config',
  'custom_suppliers',
  'custom_purchase_orders',
  'custom_stock_movements',
  'pos_confirmed_debts',
  'pos_debt_payments_history',
  'pos_manual_debt_records',
  'pos_payment_vouchers',
  'pos_supplier_returns',
  'pos_product_claims',
  'pos_replacement_warranties',
  'pos_claim_inventory_cache',
  'pos_orders',
  'pos_cash_transactions',
  'pos_current_shift', // now 'purim-cache:current-shift' (server-written only)
  'pos_shifts_history',
  'pos_shift_summaries_history',
  'pos_last_shift_summary',
];

const LEGACY_CLEANED_FLAG = 'purim-legacy-cleaned:v1';

/** Remove LEGACY_KEYS once per device (cheap to call on every app start). */
export function clearLegacyLocalData(): void {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(LEGACY_CLEANED_FLAG) === '1') return;
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(LEGACY_CLEANED_FLAG, '1');
  } catch {
    /* storage unavailable */
  }
}
