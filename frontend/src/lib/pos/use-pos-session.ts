'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { useShiftStore } from '@/lib/store/shift-store';
import type { PosVariant, PosViewMode } from './pos-variant';

const noopSubscribe = () => () => {};

/** false during server rendering and hydration, true once the page runs in the browser. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Loads the product list now, when the device comes back online / regains focus, and every 15 s while visible. */
export function useProductAutoRefresh(fetchProducts: () => Promise<unknown> | void) {
  useEffect(() => {
    void fetchProducts();
    // Outbox sync is managed globally by ClientDbSync.
    const handleOnline = () => {
      void fetchProducts();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleOnline);
    const timer = setInterval(() => {
      if (!document.hidden) void fetchProducts();
    }, 15000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleOnline);
    };
  }, [fetchProducts]);
}

/**
 * Asks the server for the current shift once the page is mounted and opens the "open shift" dialog
 * when none is open (unless the cashier chose to skip it today).
 */
export function useOpenShiftPrompt(mounted: boolean, openShiftDialog: (open: boolean) => void) {
  useEffect(() => {
    if (!mounted) return;
    // Read the store imperatively: this runs once per mount, not on every shift-store change
    void useShiftStore.getState().fetchCurrentShift().then((serverShift) => {
      const isShiftOpen = serverShift?.isOpen === true || useShiftStore.getState().currentShift?.isOpen === true;
      const todayStr = new Date().toISOString().split('T')[0];
      let skippedDate: string | null = null;
      try {
        skippedDate = localStorage.getItem('pos_shift_skipped_date');
      } catch {
        // storage blocked: treat as not skipped
      }
      if (!isShiftOpen && skippedDate !== todayStr) {
        openShiftDialog(true);
      }
    });
  }, [mounted, openShiftDialog]);
}

function readSavedViewMode(key: string): PosViewMode {
  if (typeof window === 'undefined') return 'touch_screen';
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'list_view' || saved === 'touch_screen') return saved;
  } catch {
    // storage blocked
  }
  return 'touch_screen';
}

/** Touch / list screen mode, remembered per device. */
export function usePosViewMode(variant: PosVariant) {
  // The page renders a loading screen until mounted, so reading storage in the initializer cannot cause
  // a hydration mismatch.
  const [viewMode, setViewMode] = useState<PosViewMode>(() => readSavedViewMode(variant.viewModeStorageKey));

  const changeViewMode = (mode: PosViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(variant.viewModeStorageKey, mode);
    } catch {
      // storage blocked: the mode lasts for this page only
    }
    toast.info(variant.viewModeToast(mode));
  };

  return { viewMode, changeViewMode };
}
