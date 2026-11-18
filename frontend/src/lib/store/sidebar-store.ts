import { create } from 'zustand';

/** localStorage key of the back-office sidebar state on this device ("1" = narrow icon rail). */
export const SIDEBAR_COLLAPSED_KEY = 'purim_sidebar_collapsed';

interface SidebarStore {
  /** desktop sidebar shown as a narrow icon rail */
  collapsed: boolean;
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

/** Back-office sidebar collapsed / expanded (owner 2026-11-18): remembered per device, Ctrl+B toggles. */
export const useSidebarStore = create<SidebarStore>()((set, get) => ({
  collapsed: false,
  load: () => {
    let v = false;
    try {
      v = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      /* storage blocked: expanded */
    }
    if (v !== get().collapsed) set({ collapsed: v });
  },
  setCollapsed: (collapsed) => {
    save(collapsed);
    set({ collapsed });
  },
  toggle: () => get().setCollapsed(!get().collapsed),
}));

/** Width of the desktop sidebar in px (the content area starts after it). */
export const SIDEBAR_WIDTH = { expanded: 240, collapsed: 64 } as const;
