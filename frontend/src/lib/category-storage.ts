import { categories as defaultCategories } from './mock-data';

export interface CategoryItem {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export function loadCategories(): CategoryItem[] {
  if (typeof window === 'undefined') return defaultCategories;
  try {
    const raw = localStorage.getItem('custom_categories');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return defaultCategories;
}

export function saveCategories(cats: CategoryItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('custom_categories', JSON.stringify(cats));
  } catch {}
}
