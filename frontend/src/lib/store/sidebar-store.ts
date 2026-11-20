import { create } from 'zustand';

/** localStorage key of the back-office sidebar state on this device ("1" = narrow icon rail). */
export const SIDEBAR_COLLAPSED_KEY = 'purim_sidebar_collapsed';

/** localStorage key of the menu groups the user opened / closed on this device (`sub:/reports` = reports submenu). */
export const SIDEBAR_GROUPS_KEY = 'purim_sidebar_groups';

/** group id -> open (true) / closed (false); a group not listed follows the default (open = holds the current page) */
export type SidebarOpenGroups = Record<string, boolean>;

interface SidebarStore {
  /** desktop sidebar shown as a narrow icon rail */
  collapsed: boolean;
  /** accordion choices of the user, remembered per device */
  openGroups: SidebarOpenGroups;
  setOpenGroups: (next: SidebarOpenGroups) => void;
  /** read the device setting (after hydration; the server render is always expanded) */
  load: () => void;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

const save = (collapsed: boolean) => {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* private window / blocked storage: not remembered */
  }
};

const loadGroups = (): SidebarOpenGroups => {
  try {
    const raw = JSON.parse(localStorage.getItem(SIDEBAR_GROUPS_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'boolean')) as SidebarOpenGroups;
  } catch {
    return {}; // private window / blocked storage / bad JSON: only the current page's group is open
  }
};

/**
 * Back-office sidebar collapsed / expanded (owner 2026-11-18): remembered per device, Ctrl+B toggles.
 * Menu groups (owner 2026-11-20): accordion, the user's open / closed choices remembered per device.
 */
export const useSidebarStore = create<SidebarStore>()((set, get) => ({
  collapsed: false,
  openGroups: {},
  setOpenGroups: (next) => {
    try {
      localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
    set({ openGroups: next });
  },
  load: () => {
    let v = false;
    try {
      v = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      /* storage blocked: expanded */
    }
    if (v !== get().collapsed) set({ collapsed: v });
    set({ openGroups: loadGroups() });
  },
  setCollapsed: (collapsed) => {
    save(collapsed);
    set({ collapsed });
  },
  toggle: () => get().setCollapsed(!get().collapsed),
}));

/** Width of the desktop sidebar in px (the content area starts after it). */
export const SIDEBAR_WIDTH = { expanded: 240, collapsed: 64 } as const;
