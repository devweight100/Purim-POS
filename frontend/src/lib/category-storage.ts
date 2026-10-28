import { apiFetch } from './api';

export interface CategoryItem {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortOrder?: number;
  isActive?: boolean;
}

export const defaultCategories: CategoryItem[] = [];

const STORAGE_KEY = 'custom_categories';
let lastSyncAt = 0;
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

function readLocalCategories(): CategoryItem[] {
  if (typeof window === 'undefined') return defaultCategories;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((c, idx) => normalizeCategory(c, idx));
      }
    }
  } catch {}
  return defaultCategories;
}

export function mirrorCategoriesToStorage(cats: any[]): CategoryItem[] {
  const normalized = Array.isArray(cats) ? cats.map((c, idx) => normalizeCategory(c, idx)) : [];
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {}
  }
  return normalized;
}

export async function fetchCategoriesFromBackend(): Promise<CategoryItem[]> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    try {
      const data = await apiFetch('/categories');
      if (Array.isArray(data)) {
        lastSyncAt = Date.now();
        return mirrorCategoriesToStorage(data);
      }
    } catch {
      // Offline fallback to localStorage
    } finally {
      syncPromise = null;
    }
    return readLocalCategories();
  })();
  return syncPromise;
}

export function loadCategories(): CategoryItem[] {
  const cached = readLocalCategories();
  if (typeof window !== 'undefined' && Date.now() - lastSyncAt > 10000) {
    lastSyncAt = Date.now();
    void fetchCategoriesFromBackend();
  }
  return cached;
}

export function saveCategories(
  cats: CategoryItem[],
  options?: { fromBackend?: boolean },
): void {
  if (typeof window === 'undefined') return;
  const previous = readLocalCategories();
  const normalized = mirrorCategoriesToStorage(cats);

  const isFromBackend =
    options?.fromBackend ||
    (Array.isArray(cats) && cats.length > 0 && cats.every((c: any) => c?.createdAt !== undefined));

  if (isFromBackend) return;

  // Sync local UI changes (add / edit / delete) to PostgreSQL backend in background
  void (async () => {
    try {
      const prevMap = new Map(previous.map((c) => [c.id, c]));
      const nextIds = new Set(normalized.map((c) => c.id));

      for (const item of normalized) {
        if (item.id.startsWith('cat_')) {
          try {
            const created = await apiFetch('/categories', {
              method: 'POST',
              body: JSON.stringify({
                name: item.name,
                color: item.color,
                icon: item.icon,
                sortOrder: item.sortOrder ?? 0,
              }),
            });
            if (created?.id) {
              item.id = created.id;
            }
          } catch {}
        } else {
          const prev = prevMap.get(item.id);
          if (
            prev &&
            (prev.name !== item.name || prev.color !== item.color || prev.icon !== item.icon)
          ) {
            try {
              await apiFetch(`/categories/${item.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  name: item.name,
                  color: item.color,
                  icon: item.icon,
                }),
              });
            } catch {}
          }
        }
      }

      for (const prev of previous) {
        if (!prev.id.startsWith('cat_') && !nextIds.has(prev.id)) {
          try {
            await apiFetch(`/categories/${prev.id}`, { method: 'DELETE' });
          } catch {}
        }
      }

      mirrorCategoriesToStorage(normalized);
    } catch {}
  })();
}
