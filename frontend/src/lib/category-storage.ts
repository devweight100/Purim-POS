import { apiFetch } from './api';

export interface CategoryItem {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * READ-ONLY OFFLINE CACHE of the server's categories, used only so the POS keeps working when
 * the network drops. It is overwritten by every successful server response and never written by
 * local edits (categories are created/edited/deleted through the API only).
 */
const CACHE_KEY = 'purim-cache:categories';
let syncPromise: Promise<CategoryItem[]> | null = null;

function normalizeCategory(c: any, idx = 0): CategoryItem {
  return {
    id: String(c?.id || `cat_${idx}`),
    name: String(c?.name || 'ทั่วไป'),
    color: String(c?.color || '#6366f1'),
    icon: String(c?.icon || '📦'),
    sortOrder: typeof c?.sortOrder === 'number' ? c.sortOrder : idx,
    isActive: c?.isActive !== false,
  };
}

/** Last categories the server returned (POS offline use only). */
export function readCachedCategories(): CategoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map((c, idx) => normalizeCategory(c, idx)) : [];
  } catch {
    return [];
  }
}

/** Normalise a server response and overwrite the offline cache with it. */
export function cacheServerCategories(cats: any[]): CategoryItem[] {
  const normalized = Array.isArray(cats) ? cats.map((c, idx) => normalizeCategory(c, idx)) : [];
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(normalized));
    } catch {}
  }
  return normalized;
}

/** Categories from the server. Throws when the server cannot be reached. */
export async function fetchCategoriesFromBackend(): Promise<CategoryItem[]> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    try {
      const data = await apiFetch('/categories');
      return cacheServerCategories(Array.isArray(data) ? data : []);
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}
