'use client';

import { useEffect } from 'react';
import { useProductStore } from '@/lib/store/product-store';

export function ClientDbSync() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check if old mock localStorage has been purged
    const isPurged = localStorage.getItem('purim_fresh_db_v3');
    if (!isPurged) {
      console.log('[DB Sync] Purging old mock localStorage keys to reflect clean PostgreSQL database...');
      const keysToPurge = [
        'custom_products',
        'custom_categories',
        'custom_suppliers',
        'custom_purchase_orders',
        'custom_payment_vouchers',
        'pos_customer_debts',
        'pos_customer_claims',
        'pos_supplier_returns',
        'pos_claim_inventory',
        'pos_shift_storage',
        'cart-storage',
      ];

      keysToPurge.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem('purim_fresh_db_v3', 'true');

      // Trigger fresh load from database
      useProductStore.getState().fetchProducts();
    }
  }, []);

  return null;
}
