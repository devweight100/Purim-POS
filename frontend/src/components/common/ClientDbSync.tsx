'use client';

import { useEffect } from 'react';
import { useProductStore } from '@/lib/store/product-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { useCartStore } from '@/lib/store/cart-store';

export function ClientDbSync() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const PURGE_FLAG = 'purim_clean_state_v6';
    if (!localStorage.getItem(PURGE_FLAG)) {
      console.log('[ClientDbSync] 🚀 Purging all legacy mock data from browser localStorage and IndexedDB...');

      // 1. Wipe all specific mock localStorage keys
      const keysToPurge = [
        'custom_products',
        'custom_categories',
        'custom_suppliers',
        'custom_purchase_orders',
        'custom_payment_vouchers',
        'pos_payment_vouchers',
        'pos_debt_payments_history',
        'pos_manual_debt_records',
        'pos_customer_debts',
        'custom_customers',
        'pos_product_claims',
        'pos_replacement_warranties',
        'pos_supplier_returns',
        'pos_claim_inventory',
        'pos_shift_storage',
        'cart-storage',
        'custom_bank_accounts',
        'pos_orders',
        'pos_completed_orders',
        'pos_current_shift',
        'pos_cash_transactions',
      ];

      keysToPurge.forEach((k) => localStorage.removeItem(k));

      // 2. Wipe dynamic prefix keys (e.g. pkg_*, stock_*)
      const allKeys = Object.keys(localStorage);
      allKeys.forEach((key) => {
        if (key.startsWith('pkg_') || key.startsWith('stock_') || key.startsWith('pos_')) {
          if (key !== 'auth-storage' && key !== PURGE_FLAG) {
            localStorage.removeItem(key);
          }
        }
      });

      // 3. Clear IndexedDB cache
      try {
        if (window.indexedDB) {
          const req = window.indexedDB.deleteDatabase('purim_pos_offline_db');
          req.onsuccess = () => console.log('[ClientDbSync] Deleted offline IndexedDB cache');
        }
      } catch (e) {
        console.warn('[ClientDbSync] IndexedDB clear failed:', e);
      }

      // 4. Mark as purged
      localStorage.setItem(PURGE_FLAG, 'true');

      // 5. Reset In-Memory Zustand Stores
      try {
        useCartStore.getState().clearCart();
        useProductStore.setState({ products: [], categories: [] });
        useShiftStore.setState({ currentShift: null, completedOrders: [], cashTransactions: [] });
      } catch {}

      // 6. Refetch fresh products from PostgreSQL
      useProductStore.getState().fetchProducts();
    }
  }, []);

  return null;
}
