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
