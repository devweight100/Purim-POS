import { useCallback, useState, type KeyboardEvent, type MouseEvent } from 'react';

/**
 * Keyboard + mouse pattern for list tables whose rows open something (edit form, detail dialog).
 * One row is "active" (roving tabindex: Tab enters the table on it), ↑/↓ move it, Home/End jump,
 * Enter (or a click on the row) opens it. Clicks on buttons/links/inputs inside the row keep their own action.
 *
 *   const nav = useRowNav(rows.length, (i) => openEdit(rows[i]));
 *   <tbody {...nav.bodyProps}>{rows.map((r, i) => <tr key={r.id} {...nav.rowProps(i)}>...)}</tbody>
 */
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="checkbox"], [role="button"], [role="menuitem"], [data-row-nav-ignore]';

export const ROW_NAV_CLASS =
  'cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-sky-500 focus-visible:-outline-offset-2 data-[row-active=true]:bg-sky-50/70';

export function rowNavRows(root: Element | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('[data-row-nav]'));
}

/** Focus the active (or first) row inside `root`; e.g. ArrowDown from a search box. */
export function focusRowNav(root: Element | null) {
  const rows = rowNavRows(root);
  (rows.find((r) => r.tabIndex === 0) ?? rows[0])?.focus();
}

export function useRowNav(count: number, onOpen: (index: number) => void) {
  const [active, setActive] = useState(0);
  // keep the index inside the list when it gets shorter (page change, filter)
  const current = count === 0 ? -1 : Math.min(active, count - 1);

  const move = useCallback((from: HTMLElement, to: number) => {
    const root = from.closest('[data-row-nav-root]') ?? from.parentElement;
    const rows = rowNavRows(root);
    const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
    if (!target) return;
    const idx = Number(target.dataset.rowNav);
    setActive(idx);
    target.focus();
    target.scrollIntoView({ block: 'nearest' });
  }, []);

  const rowProps = (index: number) => ({
    'data-row-nav': index,
    'data-row-active': index === current,
    'aria-selected': index === current,
    tabIndex: index === current ? 0 : -1,
    onFocus: () => setActive(index),
    onClick: (e: MouseEvent<HTMLElement>) => {
      const t = e.target as HTMLElement;
      if (t.closest(INTERACTIVE) && t.closest(INTERACTIVE) !== e.currentTarget) return;
      setActive(index);
      onOpen(index);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return; // keys inside a button/input of the row
      const rows = rowNavRows(e.currentTarget.closest('[data-row-nav-root]') ?? e.currentTarget.parentElement);
      const pos = rows.indexOf(e.currentTarget);
      if (e.key === 'ArrowDown') { e.preventDefault(); move(e.currentTarget, pos + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(e.currentTarget, pos - 1); }
      else if (e.key === 'Home') { e.preventDefault(); move(e.currentTarget, 0); }
      else if (e.key === 'End') { e.preventDefault(); move(e.currentTarget, rows.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(index); }
    },
  });

  return {
    activeIndex: current,
    setActiveIndex: setActive,
    bodyProps: { 'data-row-nav-root': '' },
    rowProps,
  };
}
