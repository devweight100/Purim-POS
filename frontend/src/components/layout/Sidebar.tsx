'use client';

import Link from 'next/link';
import { VersionBadge } from '@/components/common/VersionInfo';
import { usePathname, useRouter } from 'next/navigation';
import React, { useState, useEffect, useRef } from 'react';
import { Gamepad2, 
  ShoppingCart, ClipboardList, Users, LayoutDashboard, Package, 
  Warehouse, Settings, LogOut, Menu, X, Truck, FileText, BarChart3, 
  FolderTree, Building2, Receipt, ShieldAlert, ArrowLeftRight, HandCoins,
  ChevronDown, ChevronsDown, History, PackageX, TrendingUp, Sparkles, Coins, Boxes, UserCog,
  ScanLine, ShoppingBag, PanelLeftClose,
  Wallet, ShieldCheck, Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { performLogout } from '@/lib/logout';
import { useAuthStore } from '@/lib/store/auth-store';
import { canAccessRoute } from '@/lib/permissions';
import { useDocumentSearchStore } from '@/lib/store/document-search-store';
import { useOnlineCounts } from '@/lib/online-orders';
import { useSidebarStore, type SidebarOpenGroups } from '@/lib/store/sidebar-store';
import { SidebarRail } from './SidebarRail';

interface SubMenuItem {
  href: string;
  label: string;
  icon: LucideIcon;
  children?: SubMenuItem[];
}

interface NavGroup {
  id: string;
  title: string;
  icon: LucideIcon;
  items: SubMenuItem[];
  /** Draw a divider (extra space) above this group when a group is shown before it. */
  separatorBefore?: boolean;
}

// Owner's order: overview / reports first, then the daily shop work (stock, selling, purchasing); a divider,
// then money and system pages. Items inside each group keep their order. The POS button stays above all groups.
// Keep BACK_OFFICE_HOMES (lib/permissions.ts, POS "เมนูหลัก") in the same order.
const navGroups: NavGroup[] = [
  {
    id: 'overview',
    title: 'ภาพรวม & รายงาน',
    icon: BarChart3,
    items: [
      { href: '/dashboard', label: 'แดชบอร์ดสรุปภาพรวม', icon: LayoutDashboard },
      {
        href: '/reports',
        label: 'รายงาน & สถิติธุรกิจ',
        icon: BarChart3,
        children: [
          { href: '/reports/sales', label: 'ยอดขาย & กำไรขั้นต้น', icon: TrendingUp },
          { href: '/reports/bestsellers', label: 'สินค้าขายดี & ทำกำไร', icon: Sparkles },
          { href: '/reports/inventory', label: 'มูลค่าคลัง & สต็อกช้า', icon: Boxes },
          { href: '/reports/payments', label: 'ช่องทางชำระ & ปิดกะ', icon: Coins },
          { href: '/reports/customers', label: 'วิเคราะห์ลูกค้า & อายุหนี้', icon: Users },
          { href: '/reports/purchases', label: 'ยอดจัดซื้อ & สถิติของเคลม', icon: Truck },
        ],
      },
      { href: '/m', label: 'มุมมองมือถือ', icon: Smartphone },
    ],
  },
  {
    id: 'inventory',
    title: 'สินค้า & คลังสินค้า',
    icon: Package,
    items: [
      { href: '/products', label: 'รายการสินค้า & ราคา', icon: Package },
      { href: '/inventory', label: 'คลังสินค้า & สต็อก', icon: Warehouse },
      { href: '/categories', label: 'หมวดหมู่สินค้า', icon: FolderTree },
      { href: '/claim-inventory', label: 'สต๊อกของเคลม', icon: PackageX },
    ],
  },
  {
    id: 'sales',
    title: 'งานขาย & ลูกค้า',
    icon: ShoppingCart,
    items: [
      { href: '/online-orders', label: 'ออเดอร์ออนไลน์', icon: ShoppingBag },
      { href: '/orders', label: 'ประวัติการขาย (บิล)', icon: ClipboardList },
      { href: '/customers', label: 'ลูกค้าสมาชิก', icon: Users },
      { href: '/debts', label: 'ลูกหนี้ & ค้างชำระ', icon: Receipt },
      { href: '/claims', label: 'เคลมสินค้า (ลูกค้า)', icon: ShieldAlert },
      { href: '/shifts', label: 'ประวัติการปิดกะ', icon: History },
    ],
  },
  {
    id: 'purchasing',
    title: 'จัดซื้อ & ผู้จำหน่าย',
    icon: Truck,
    items: [
      { href: '/purchase-orders', label: 'ใบสั่งซื้อสินค้า (PO)', icon: FileText },
      { href: '/payables', label: 'เจ้าหนี้การค้า & จ่ายเงิน', icon: HandCoins },
      { href: '/supplier-returns', label: 'ส่งเคลม & ใบลดหนี้บริษัท', icon: ArrowLeftRight },
      { href: '/suppliers', label: 'บริษัทผู้จำหน่าย', icon: Truck },
    ],
  },
  {
    id: 'finance',
    title: 'การเงิน',
    icon: Wallet,
    separatorBefore: true,
    items: [
      { href: '/finance', label: 'เงินสด / บัญชี / ค่าใช้จ่าย', icon: Wallet },
      { href: '/accounts', label: 'บัญชีธนาคาร & QR Code', icon: Building2 },
      { href: '/approvals', label: 'การอนุมัติ (ส่วนลด / ต่ำกว่าทุน)', icon: ShieldCheck },
    ],
  },
  {
    id: 'system',
    title: 'ตั้งค่า & ระบบ',
    icon: Settings,
    items: [
      { href: '/settings', label: 'ตั้งค่าร้าน', icon: Settings },
      { href: '/users', label: 'พนักงาน & สิทธิ์', icon: UserCog },
      { href: '/monitor', label: 'มอนิเตอร์ร้าน (Pixel View)', icon: Gamepad2 },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const onlineCounts = useOnlineCounts((s) => s.counts);
  const onlineBadge = (onlineCounts?.new || 0) + (onlineCounts?.linkRequests || 0);
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggle);

  // device setting (localStorage) after hydration; Ctrl+B collapses / expands the desktop sidebar
  useEffect(() => {
    useSidebarStore.getState().load();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return;
      if (!window.matchMedia('(min-width: 1024px)').matches) return; // phones / tablets use the drawer
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable) return;
      e.preventDefault();
      useSidebarStore.getState().toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Persistent scroll position refs
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const mobileScrollRef = useRef<HTMLDivElement>(null);

  // Filter nav groups and submenus according to user permissions
  const visibleNavGroups = React.useMemo(() => {
    return navGroups
      .map((group) => {
        const visibleItems = group.items
          .filter((item) => canAccessRoute(user, item.href))
          .map((item) => {
            if (!item.children || item.children.length === 0) return item;
            const visibleChildren = item.children.filter((child) => canAccessRoute(user, child.href));
            return {
              ...item,
              children: visibleChildren,
            };
          });

        return {
          ...group,
          items: visibleItems,
        };
      })
      .filter((group) => group.items.length > 0);
  }, [user]);

  // Accordion (owner 2026-11-20): only the group of the current page is open by default; what the user opens or
  // closes is remembered on this device (localStorage). A remembered "closed" never hides the current page.
  const activeGroupId = activeGroupOf(visibleNavGroups, pathname);
  const openState = useSidebarStore((st) => st.openGroups);
  const setOpenState = useSidebarStore((st) => st.setOpenGroups);
  const changeOpenState = (fn: (prev: OpenState) => OpenState) => setOpenState(fn(useSidebarStore.getState().openGroups));
  const isGroupOpen = (id: string) => openState[id] ?? id === activeGroupId;
  const isSubMenuOpen = (href: string, active: boolean) => openState[`sub:${href}`] ?? active;

  // On a route change: the current page's group (and the reports submenu) opens even if the user closed it
  // earlier (the user may close it again while on the page), and the mobile menu closes.
  useEffect(() => {
    const st = useSidebarStore.getState();
    const prev = st.openGroups;
    const forced = { ...prev };
    if (activeGroupId && forced[activeGroupId] === false) delete forced[activeGroupId];
    if (pathname.startsWith('/reports') && forced['sub:/reports'] === false) delete forced['sub:/reports'];
    if (Object.keys(forced).length !== Object.keys(prev).length) st.setOpenGroups(forced);
  }, [pathname, activeGroupId]);
  const [syncedPath, setSyncedPath] = useState(pathname);
  if (syncedPath !== pathname) {
    setSyncedPath(pathname);
    setMobileOpen(false);
  }

  // Save and restore sidebar scroll position across navigation
  const saveCurrentScroll = () => {
    if (desktopScrollRef.current) {
      try {
        sessionStorage.setItem('purim_sidebar_scroll_top', String(desktopScrollRef.current.scrollTop));
      } catch { /* storage blocked */ }
    }
  };

  useEffect(() => {
    const restoreScroll = () => {
      const el = desktopScrollRef.current;
      if (!el) return;
      let saved: string | null = null;
      try { saved = sessionStorage.getItem('purim_sidebar_scroll_top'); } catch { /* storage blocked */ }
      const top = saved === null ? NaN : parseInt(saved, 10);
      if (!isNaN(top) && Math.abs(el.scrollTop - top) > 2) el.scrollTop = top;
      // the current page's item is always in view (a small window scrolls the menu)
      revealActive(el);
    };

    restoreScroll();
    const r1 = requestAnimationFrame(restoreScroll);
    const t1 = setTimeout(restoreScroll, 20);
    const t2 = setTimeout(restoreScroll, 60);

    return () => {
      cancelAnimationFrame(r1);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [pathname, collapsed]);

  const toggleGroup = (groupId: string) => {
    saveCurrentScroll();
    const open = isGroupOpen(groupId);
    changeOpenState((prev) => ({ ...prev, [groupId]: !open }));
  };

  const toggleSubMenu = (href: string, open: boolean) => {
    saveCurrentScroll();
    changeOpenState((prev) => ({ ...prev, [`sub:${href}`]: !open }));
  };

  const handleLogout = () => {
    performLogout();
    router.push('/login');
  };

  const renderNavContent = (scrollRef: React.RefObject<HTMLDivElement | null>, isMobile = false) => (
    <>
      {/* Brand Header */}
      <div className="px-3 flex items-center h-14 shrink-0 border-b border-sidebar-border bg-sidebar">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
          <span className="font-semibold text-white text-base leading-none">P</span>
        </div>
        <div className="ml-3 min-w-0 flex-1 overflow-hidden">
          <span className="font-bold text-sm text-slate-900 block leading-tight">ร้านปุริม POS</span>
          <span className="text-[10px] text-slate-400 font-medium">ระบบบริหารการขาย & สต็อก</span>
        </div>
        {!isMobile && (
          <button
            type="button"
            onClick={toggleCollapsed}
            title="ย่อแถบเมนู (Ctrl+B)"
            aria-label="ย่อแถบเมนู (Ctrl+B)"
            aria-expanded={true}
            aria-controls="backoffice-sidebar"
            data-testid="sidebar-toggle"
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <PanelLeftClose className="h-4.5 w-4.5" />
          </button>
        )}
      </div>

      {/* Navigation Groups (scrolls only when the window is too short; a hint shows there is more) */}
      <ScrollHintArea scrollRef={scrollRef} onScrollTop={isMobile ? undefined : (top) => {
        try { sessionStorage.setItem('purim_sidebar_scroll_top', String(top)); } catch { /* storage blocked */ }
      }}>
        {/* Quick POS Action Button (กลับไปหน้าขาย POS) */}
        <div className="px-1">
          <Link
            href="/pos"
            scroll={false}
            onClick={saveCurrentScroll}
            className={cn(
              'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl font-bold transition-all shadow-xs group',
              pathname === '/pos'
                ? 'bg-sky-500 text-white shadow-sky-200 ring-2 ring-sky-300'
                : 'bg-sky-50 text-sky-950 border border-sky-200/90 hover:bg-sky-100/90'
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn(
                'w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0',
                pathname === '/pos' ? 'bg-white/20 text-white' : 'bg-sky-500 text-white shadow-2xs'
              )}>
                <ShoppingCart className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[13px] font-semibold block whitespace-nowrap leading-tight">หน้าขายหน้าร้าน (POS)</span>
                <span className={cn('text-[10px] block font-normal leading-tight', pathname === '/pos' ? 'text-white/90' : 'text-sky-700')}>สลับไปหน้าจอแคชเชียร์</span>
              </div>
            </div>
          </Link>
        </div>

        {/* Universal Document Search Button */}
        <div className="px-1 pb-1">
          <button
            type="button"
            onClick={() => useDocumentSearchStore.getState().openSearch()}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-50/80 hover:bg-indigo-100 text-indigo-950 border border-indigo-200/80 transition-all shadow-xs cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                <ScanLine className="w-3.5 h-3.5 animate-pulse" />
              </div>
              <span className="font-bold">ค้นหาเอกสารทั้งหมด</span>
            </div>
            <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-md bg-white text-indigo-700 border border-indigo-200 font-semibold">
              F3
            </span>
          </button>
        </div>

        {/* Grouped Accordion Menu */}
        {visibleNavGroups.map((group, index) => {
          const isOpen = isGroupOpen(group.id);
          const isGroupActive = group.id === activeGroupId;
          const GroupIcon = group.icon;

          return (
            <React.Fragment key={group.id}>
              {group.separatorBefore && index > 0 && (
                <div data-testid="sidebar-divider" aria-hidden="true" className="mx-2.5 my-1 border-t border-slate-200" />
              )}
              <div className="space-y-0.5" data-testid={`sidebar-group-${group.id}`}>
                {/* Group Header (หัวข้อใหญ่ ขนาดใหญ่และหนากว่าหัวข้อย่อย) */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  aria-controls={`nav-group-${group.id}${isMobile ? '-m' : ''}`}
                  className={cn(
                    'w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-sm font-bold transition-colors group outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
                    isGroupActive
                      ? 'text-indigo-950 bg-indigo-50/70'
                      : 'text-slate-800 hover:text-slate-950 hover:bg-slate-100/70'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <GroupIcon className={cn('w-4.5 h-4.5 shrink-0', isGroupActive ? 'text-indigo-600' : 'text-slate-500')} />
                    <span className="tracking-tight text-sm font-bold">{group.title}</span>
                  </div>
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 text-slate-400 transition-transform duration-200 group-hover:text-slate-600',
                      isOpen ? 'rotate-0' : '-rotate-90'
                    )}
                  />
                </button>

                {/* Submenu Items (หัวข้อย่อย) */}
                {isOpen && (
                  <div id={`nav-group-${group.id}${isMobile ? '-m' : ''}`} className="ml-3 pl-2.5 border-l-2 border-slate-200/80 space-y-px pb-1">
                    {group.items.map((item) => {
                      const hasChildren = Boolean(item.children && item.children.length > 0);
                      const isChildActive = hasChildren && Boolean(item.children?.some((c) => pathname === c.href));
                      const isSelfActive = pathname === item.href;
                      const isSubOpen = isSubMenuOpen(item.href, isChildActive || isSelfActive);
                      const ItemIcon = item.icon;

                      if (hasChildren) {
                        return (
                          <div key={item.href} className="space-y-0.5">
                            <div
                              onClick={() => toggleSubMenu(item.href, isSubOpen)}
                              className={cn(
                                'flex items-center justify-between px-2.5 py-1 rounded-lg text-[13px] transition-all duration-150 group cursor-pointer',
                                isSelfActive || isChildActive
                                  ? 'bg-indigo-50/80 text-indigo-950 font-bold'
                                  : 'text-slate-700 hover:text-slate-950 hover:bg-slate-100 font-bold'
                              )}
                            >
                              <Link
                                href={item.href}
                                scroll={false}
                                aria-current={isSelfActive ? 'page' : undefined}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  saveCurrentScroll();
                                }}
                                className="flex items-center flex-1 min-w-0"
                              >
                                <ItemIcon className={cn('w-4 h-4 shrink-0 mr-2.5', (isSelfActive || isChildActive) ? 'text-indigo-600' : 'text-slate-500')} />
                                <span className="truncate">{item.label}</span>
                              </Link>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  toggleSubMenu(item.href, isSubOpen);
                                }}
                                className="p-0.5 text-slate-400 hover:text-slate-700 transition-colors ml-1"
                                title="ย่อ/ขยายเมนูย่อยรายงาน"
                                aria-label="ย่อ/ขยายเมนูย่อยรายงาน"
                                aria-expanded={isSubOpen}
                              >
                                <ChevronDown
                                  className={cn(
                                     'w-3.5 h-3.5 transition-transform duration-200',
                                    isSubOpen ? 'rotate-0' : '-rotate-90'
                                  )}
                                />
                              </button>
                            </div>

                            {/* Sub-items inside รายงาน */}
                            {isSubOpen && (
                              <div className="ml-3 pl-2 border-l-2 border-indigo-200/90 space-y-px py-px">
                                {item.children?.map((sub) => {
                                  const isSubActive = pathname === sub.href;
                                  const SubIcon = sub.icon;
                                  return (
                                    <Link
                                      key={sub.href}
                                      href={sub.href}
                                      scroll={false}
                                      aria-current={isSubActive ? 'page' : undefined}
                                      onClick={saveCurrentScroll}
                                      className={cn(
                                        'flex items-center px-2 py-1 rounded-lg text-xs transition-all duration-150 whitespace-nowrap',
                                        isSubActive
                                          ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                                          : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100 font-medium'
                                      )}
                                    >
                                      <SubIcon className={cn('w-3.5 h-3.5 shrink-0 mr-2', isSubActive ? 'text-white' : 'text-slate-400')} />
                                      <span className="truncate">{sub.label}</span>
                                    </Link>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          scroll={false}
                          aria-current={isSelfActive ? 'page' : undefined}
                          onClick={saveCurrentScroll}
                          className={cn(
                            'flex items-center px-2.5 py-1 rounded-lg text-[13px] transition-all duration-150 whitespace-nowrap',
                            isSelfActive
                              ? 'bg-indigo-600 text-white font-bold shadow-xs'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium'
                          )}
                        >
                          <ItemIcon className={cn('w-4 h-4 shrink-0 mr-2.5', isSelfActive ? 'text-white' : 'text-slate-400')} />
                          <span className="truncate">{item.label}</span>
                          {item.href === '/online-orders' && onlineBadge > 0 && (
                            <span data-testid="online-orders-badge" aria-label={`${onlineBadge} รายการใหม่`} className="ml-auto pl-2 shrink-0">
                              <span className="inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold text-white">{onlineBadge}</span>
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </ScrollHintArea>

      {/* User Footer Profile (pinned at the bottom) */}
      <div data-testid="sidebar-footer" className="px-3 py-2 border-t border-sidebar-border shrink-0 bg-sidebar">
        <div className="flex items-center gap-2 px-1">
          <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
            <span className="text-indigo-700 text-xs font-bold">{user?.name?.charAt(0)?.toUpperCase() || 'P'}</span>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="text-xs font-bold text-slate-900 truncate">{user?.name || 'Admin'}</p>
            <p className="text-[10px] text-slate-400 truncate">{user?.role || 'เจ้าของร้าน'}</p>
          </div>
        </div>
        <VersionBadge className="px-1 mt-1" />
        {user ? (
          <button
            type="button"
            onClick={handleLogout}
            className="mt-1 w-full flex items-center px-2 py-1 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors text-xs font-medium cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0 mr-2" />
            <span>ออกจากระบบ</span>
          </button>
        ) : (
          <Link
            href="/login"
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors text-xs font-bold"
          >
            <UserCog className="w-3.5 h-3.5" />
            <span>เข้าสู่ระบบ (Login)</span>
          </Link>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className="lg:hidden fixed top-3 left-3 z-50 p-2.5 rounded-xl bg-white text-slate-900 shadow-md border border-slate-200"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle Menu"
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-xs transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      {/* closed drawer is inert: its links must not take the keyboard focus while off screen */}
      <div data-slot="sidebar" inert={!mobileOpen} className={cn(
        'lg:hidden fixed top-0 left-0 h-full w-64 bg-sidebar z-50 flex flex-col transition-transform duration-300 shadow-2xl border-r border-sidebar-border',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {renderNavContent(mobileScrollRef, true)}
      </div>

      {/* Desktop sidebar: a column as tall as the page (background + border all the way down, also in a full-page
          capture) holding a panel that sticks to the window: full window height, stays put while the page scrolls,
          user box pinned at its bottom. */}
      <aside
        id="backoffice-sidebar"
        data-slot="sidebar"
        data-collapsed={collapsed ? 'true' : 'false'}
        className={cn(
          'hidden lg:block relative z-40 shrink-0 self-stretch bg-sidebar border-r border-sidebar-border',
          collapsed ? 'w-16' : 'w-[240px]',
        )}
      >
        <div data-testid="sidebar-panel" className="sticky top-0 flex h-dvh flex-col">
        {collapsed && (
          <SidebarRail
            groups={visibleNavGroups}
            pathname={pathname}
            onlineBadge={onlineBadge}
            userName={user?.name || 'Admin'}
            userRole={user?.role || 'เจ้าของร้าน'}
            loggedIn={!!user}
            onExpand={toggleCollapsed}
            onLogout={handleLogout}
          />
        )}
        {/* kept mounted while collapsed (hidden), so the menu's scroll position and open groups survive a toggle */}
        <div className={collapsed ? 'hidden' : 'contents'}>{renderNavContent(desktopScrollRef, false)}</div>
        </div>
      </aside>
    </>
  );
}

type OpenState = SidebarOpenGroups;

/** The group holding the current page (its own page, a report under it, or a sub page such as /products/x). */
function activeGroupOf(groups: NavGroup[], pathname: string): string | null {
  const hit = (href: string) => pathname === href || pathname.startsWith(href + '/');
  return groups.find((g) => g.items.some((i) => hit(i.href) || i.children?.some((c) => hit(c.href))))?.id ?? null;
}

/** Scroll the menu so the current page's item is visible (only when it is not). */
function revealActive(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>('[aria-current="page"]');
  if (!el) return;
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < c.top + 4) container.scrollTop -= c.top + 24 - r.top;
  else if (r.bottom > c.bottom - 4) container.scrollTop += r.bottom - c.bottom + 32;
}

/**
 * The menu's scroll area. It scrolls only when the window is too short for the open groups (e.g. 1093x614 with a
 * long group open); then a fade + "เลื่อนดูเมนูเพิ่ม" at the bottom (and a fade at the top once scrolled) shows
 * that there is more.
 */
function ScrollHintArea({
  scrollRef, onScrollTop, children,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScrollTop?: (top: number) => void;
  children: React.ReactNode;
}) {
  const [more, setMore] = useState({ up: false, down: false });
  const measure = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const up = el.scrollTop > 2;
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setMore((m) => (m.up === up && m.down === down ? m : { up, down }));
  }, [scrollRef]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, scrollRef]);
  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        data-testid="sidebar-nav"
        onScroll={(e) => {
          measure();
          onScrollTop?.(e.currentTarget.scrollTop);
        }}
        className="h-full overflow-y-auto overflow-x-hidden px-2 py-2 [scrollbar-width:thin]"
      >
        <div className="flex flex-col gap-1">{children}</div>
      </div>
      {more.up && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-white to-transparent" />
      )}
      {more.down && (
        <div
          aria-hidden="true"
          data-testid="sidebar-scroll-hint"
          className="pointer-events-none absolute inset-x-0 bottom-0 flex h-9 items-end justify-center bg-gradient-to-t from-white via-white/90 to-transparent pb-1"
        >
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 shadow-2xs">
            <ChevronsDown className="h-3 w-3" />
            เลื่อนดูเมนูเพิ่ม
          </span>
        </div>
      )}
    </div>
  );
}
