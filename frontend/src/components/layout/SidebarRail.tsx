'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, PanelLeftOpen, ScanLine, ShoppingCart, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDocumentSearchStore } from '@/lib/store/document-search-store';

export interface RailItem {
  href: string;
  label: string;
  icon: LucideIcon;
  children?: RailItem[];
}

export interface RailGroup {
  id: string;
  title: string;
  icon: LucideIcon;
  items: RailItem[];
  separatorBefore?: boolean;
}

/** Icon with a tooltip on the right (hover and keyboard focus); the element keeps its own aria-label. */
function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Hover flyout timing (owner 2026-11-22): open after 100 ms of pointing, close 250 ms after leaving. */
export const RAIL_OPEN_DELAY = 100;
export const RAIL_CLOSE_DELAY = 250;

const railBtn =
  'relative flex h-10 w-10 items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400';

/**
 * Collapsed desktop sidebar (64 px icon rail, owner 2026-11-18): logo, expand button (Ctrl+B), POS launcher,
 * document search (F3), one icon per menu group that opens a flyout with the group's pages (Escape / click outside
 * closes it and gives the focus back), user + logout. The online orders badge shows on the sales group icon.
 */
export function SidebarRail({
  groups, pathname, onlineBadge, userName, userRole, loggedIn, onExpand, onLogout,
}: {
  groups: RailGroup[];
  pathname: string;
  onlineBadge: number;
  userName: string;
  userRole: string;
  loggedIn: boolean;
  onExpand: () => void;
  onLogout: () => void;
}) {
  // byHover: opened by pointing at the icon (closes again when the pointer leaves icon + flyout);
  // a click or the keyboard opens it "pinned" (closes on Escape, a click outside or a page change)
  const [open, setOpen] = useState<{ id: string; top: number; byHover: boolean } | null>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const flyoutRef = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);

  const clearTimers = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const close = useCallback((refocus: boolean) => {
    clearTimers();
    setOpen((cur) => {
      if (cur && refocus) triggers.current[cur.id]?.focus();
      return null;
    });
  }, [clearTimers]);

  const flyoutTop = (id: string) => {
    const r = triggers.current[id]?.getBoundingClientRect();
    return Math.max(8, Math.min(r?.top ?? 80, window.innerHeight - 340));
  };

  // Hover: open after RAIL_OPEN_DELAY (a pointer passing over the rail opens nothing), close RAIL_CLOSE_DELAY after
  // the pointer left both the icon and the flyout (time to cross the gap between them).
  const hoverGroup = (id: string) => {
    window.clearTimeout(closeTimer.current);
    if (open?.id === id) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      setOpen((cur) => (cur && cur.id === id ? cur : { id, top: flyoutTop(id), byHover: true }));
    }, RAIL_OPEN_DELAY);
  };
  const leaveHover = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen((cur) => (cur?.byHover ? null : cur));
    }, RAIL_CLOSE_DELAY);
  };

  // a page change closes the flyout
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(null);
  }

  useEffect(() => {
    if (!open) return;
    if (focusFirst.current) {
      focusFirst.current = false;
      flyoutRef.current?.querySelector<HTMLElement>('a')?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (flyoutRef.current?.contains(t) || triggers.current[open.id]?.contains(t)) return;
      close(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, close]);

  const toggleGroup = (id: string, byKeyboard: boolean) => {
    clearTimers();
    // a click on an icon whose flyout the hover already opened keeps it open (pins it)
    if (open?.id === id && open.byHover && !byKeyboard) return setOpen({ ...open, byHover: false });
    if (open?.id === id) return close(false);
    focusFirst.current = byKeyboard;
    setOpen({ id, top: flyoutTop(id), byHover: false });
  };

  // ↑/↓ inside the flyout move between its links
  const onFlyoutKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = Array.from(flyoutRef.current?.querySelectorAll<HTMLElement>('a') ?? []);
    const i = links.indexOf(document.activeElement as HTMLElement);
    const next = links[(i + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  const openGroup = groups.find((g) => g.id === open?.id);
  const isActive = (href: string) => pathname === href;

  return (
    <>
      <div className="flex h-16 shrink-0 items-center justify-center border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 shadow-sm" aria-hidden="true">
          <span className="text-base font-black leading-none text-white">P</span>
        </div>
      </div>

      <nav aria-label="เมนูหลัก (ย่อ)" className="flex flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden py-3">
        <Tip label="ขยายแถบเมนู (Ctrl+B)">
          <button
            type="button"
            onClick={onExpand}
            aria-label="ขยายแถบเมนู (Ctrl+B)"
            aria-expanded={false}
            aria-controls="backoffice-sidebar"
            data-testid="sidebar-toggle"
            className={cn(railBtn, 'text-slate-500 hover:bg-slate-100 hover:text-slate-900')}
          >
            <PanelLeftOpen className="h-5 w-5" />
          </button>
        </Tip>

        <Tip label="หน้าขายหน้าร้าน (POS)">
          <Link
            href="/pos"
            aria-label="หน้าขายหน้าร้าน (POS)"
            data-testid="rail-pos"
            className={cn(railBtn, pathname === '/pos' ? 'bg-sky-500 text-white' : 'bg-sky-500 text-white shadow-sm hover:bg-sky-600')}
          >
            <ShoppingCart className="h-5 w-5" />
          </Link>
        </Tip>

        <Tip label="ค้นหาเอกสารทั้งหมด (F3)">
          <button
            type="button"
            onClick={() => useDocumentSearchStore.getState().openSearch()}
            aria-label="ค้นหาเอกสารทั้งหมด (F3)"
            className={cn(railBtn, 'border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100')}
          >
            <ScanLine className="h-5 w-5" />
          </button>
        </Tip>

        <div className="my-1 w-8 border-t border-slate-200" aria-hidden="true" />

        {groups.map((group, index) => {
          const Icon = group.icon;
          const active = group.items.some((i) => isActive(i.href) || i.children?.some((c) => isActive(c.href)));
          const badge = group.items.some((i) => i.href === '/online-orders') ? onlineBadge : 0;
          const expanded = open?.id === group.id;
          return (
            <React.Fragment key={group.id}>
              {group.separatorBefore && index > 0 && (
                <div data-testid="sidebar-divider" aria-hidden="true" className="my-1 w-8 border-t border-slate-200" />
              )}
              {/* no tooltip: pointing at the icon opens the flyout, whose heading is the group title */}
                <button
                  type="button"
                  ref={(el) => {
                    triggers.current[group.id] = el;
                  }}
                  onClick={(e) => toggleGroup(group.id, e.detail === 0)}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') hoverGroup(group.id); }}
                  onPointerLeave={(e) => { if (e.pointerType === 'mouse') leaveHover(); }}
                  aria-label={badge > 0 ? `${group.title} (${badge} รายการใหม่)` : group.title}
                  aria-haspopup="true"
                  aria-expanded={expanded}
                  aria-controls={expanded ? 'sidebar-flyout' : undefined}
                  data-testid={`rail-group-${group.id}`}
                  className={cn(
                    railBtn,
                    expanded || active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {badge > 0 && (
                    <span data-testid="online-orders-badge" className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white">
                      {badge}
                    </span>
                  )}
                </button>
            </React.Fragment>
          );
        })}
      </nav>

      <div className="flex shrink-0 flex-col items-center gap-2 border-t border-sidebar-border py-3">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50"
          title={`${userName} (${userRole})`}
          aria-label={`${userName} (${userRole})`}
          role="img"
        >
          <span className="text-xs font-bold text-indigo-700">{userName.charAt(0).toUpperCase() || 'P'}</span>
        </div>
        {loggedIn && (
          <Tip label="ออกจากระบบ">
            <button
              type="button"
              onClick={onLogout}
              aria-label="ออกจากระบบ"
              className={cn(railBtn, 'h-9 w-9 text-slate-500 hover:bg-rose-50 hover:text-rose-600')}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </Tip>
        )}
      </div>

      {open && openGroup && (
        <div
          id="sidebar-flyout"
          ref={flyoutRef}
          role="group"
          aria-label={openGroup.title}
          data-testid="sidebar-flyout"
          onKeyDown={onFlyoutKey}
          onPointerEnter={() => window.clearTimeout(closeTimer.current)}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') leaveHover(); }}
          data-by-hover={open.byHover ? 'true' : undefined}
          style={{ top: open.top }}
          className="fixed left-[72px] z-[60] max-h-[calc(100dvh-16px)] w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
        >
          <div className="px-2.5 pb-1.5 pt-1 text-sm font-bold text-slate-900">{openGroup.title}</div>
          <ul className="space-y-0.5">
            {openGroup.items.map((item) => (
              <li key={item.href}>
                <FlyoutLink item={item} active={isActive(item.href)} badge={item.href === '/online-orders' ? onlineBadge : 0} />
                {item.children && item.children.length > 0 && (
                  <ul className="ml-4 mt-0.5 space-y-0.5 border-l-2 border-indigo-100 pl-2">
                    {item.children.map((c) => (
                      <li key={c.href}><FlyoutLink item={c} active={isActive(c.href)} small /></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function FlyoutLink({ item, active, badge = 0, small = false }: { item: RailItem; active: boolean; badge?: number; small?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
        small ? 'py-1.5 text-xs' : 'py-2 text-[13px]',
        active ? 'bg-indigo-600 font-bold text-white' : 'font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950',
      )}
    >
      <Icon className={cn('shrink-0', small ? 'h-3.5 w-3.5' : 'h-4 w-4', active ? 'text-white' : 'text-slate-400')} />
      <span className="truncate">{item.label}</span>
      {badge > 0 && (
        <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-black text-white">{badge}</span>
      )}
    </Link>
  );
}
