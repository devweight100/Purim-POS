'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useState, useEffect, useRef } from 'react';
import { 
  ShoppingCart, ClipboardList, Users, LayoutDashboard, Package, 
  Warehouse, Settings, LogOut, Menu, X, Truck, FileText, BarChart3, 
  FolderTree, Building2, Receipt, ShieldAlert, ArrowLeftRight, HandCoins,
  ChevronDown, History, PackageX, TrendingUp, Sparkles, Coins, Boxes
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store/auth-store';

interface SubMenuItem {
  href: string;
  label: string;
  icon: any;
  children?: SubMenuItem[];
}

interface NavGroup {
  id: string;
  title: string;
  icon: any;
  items: SubMenuItem[];
}

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
    ],
  },
  {
    id: 'sales',
    title: 'งานขาย & ลูกค้า',
    icon: ShoppingCart,
    items: [
      { href: '/orders', label: 'ประวัติการขาย (Orders)', icon: ClipboardList },
      { href: '/shifts', label: 'ประวัติการปิดกะ', icon: History },
      { href: '/debts', label: 'ลูกหนี้ & ค้างชำระ', icon: Receipt },
      { href: '/customers', label: 'ข้อมูลลูกค้าสมาชิก', icon: Users },
      { href: '/claims', label: 'เคลมสินค้า (ลูกค้า)', icon: ShieldAlert },
    ],
  },
  {
    id: 'inventory',
    title: 'สินค้า & คลังสินค้า',
    icon: Package,
    items: [
      { href: '/products', label: 'รายการสินค้า & ราคา', icon: Package },
      { href: '/categories', label: 'หมวดหมู่สินค้า', icon: FolderTree },
      { href: '/inventory', label: 'คลังสินค้า & สต็อก', icon: Warehouse },
      { href: '/claim-inventory', label: 'สต๊อกของเคลม', icon: PackageX },
    ],
  },
  {
    id: 'purchasing',
    title: 'จัดซื้อ & คู่ค้าบริษัท',
    icon: Truck,
    items: [
      { href: '/suppliers', label: 'บริษัทผู้จำหน่าย', icon: Truck },
      { href: '/purchase-orders', label: 'ใบสั่งซื้อสินค้า (PO)', icon: FileText },
      { href: '/payables', label: 'เจ้าหนี้การค้า & จ่ายเงิน', icon: HandCoins },
      { href: '/supplier-returns', label: 'ส่งเคลม & ใบลดหนี้บริษัท', icon: ArrowLeftRight },
    ],
  },
  {
    id: 'system',
    title: 'การเงิน & การตั้งค่า',
    icon: Settings,
    items: [
      { href: '/accounts', label: 'บัญชีธนาคาร & QR Code', icon: Building2 },
      { href: '/settings', label: 'ตั้งค่าร้านค้า & ระบบ', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Persistent scroll position refs
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const mobileScrollRef = useRef<HTMLDivElement>(null);

  // Group accordion state (open all by default)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    overview: true,
    sales: true,
    inventory: true,
    purchasing: true,
    system: true,
  });

  // Submenu accordion state (for nested submenus like /reports)
  const [openSubMenus, setOpenSubMenus] = useState<Record<string, boolean>>({
    '/reports': true,
  });

  // Ensure current pathname's group and submenus are open
  useEffect(() => {
    navGroups.forEach((group) => {
      const isMatch = group.items.some(
        (item) => item.href === pathname || item.children?.some((c) => c.href === pathname)
      );
      if (isMatch) {
        setOpenGroups((prev) => ({ ...prev, [group.id]: true }));
      }
    });

    if (pathname.startsWith('/reports')) {
      setOpenSubMenus((prev) => ({ ...prev, '/reports': true }));
    }
  }, [pathname]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Save and restore sidebar scroll position across navigation
  const saveCurrentScroll = () => {
    if (desktopScrollRef.current) {
      sessionStorage.setItem('purim_sidebar_scroll_top', String(desktopScrollRef.current.scrollTop));
    }
  };

  useEffect(() => {
    const restoreScroll = () => {
      const saved = sessionStorage.getItem('purim_sidebar_scroll_top');
      if (saved !== null) {
        const top = parseInt(saved, 10);
        if (!isNaN(top)) {
          if (desktopScrollRef.current && Math.abs(desktopScrollRef.current.scrollTop - top) > 2) {
            desktopScrollRef.current.scrollTop = top;
          }
        }
      }
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
  }, [pathname]);

  const toggleGroup = (groupId: string) => {
    saveCurrentScroll();
    setOpenGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const renderNavContent = (scrollRef: React.RefObject<HTMLDivElement | null>, isMobile = false) => (
    <>
      {/* Brand Header */}
      <div className="p-4 flex items-center h-16 shrink-0 border-b border-sidebar-border bg-sidebar">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
          <span className="font-black text-white text-base leading-none">P</span>
        </div>
        <div className="ml-3 overflow-hidden">
          <span className="font-bold text-sm text-slate-900 block leading-tight">ร้านปุริม POS</span>
          <span className="text-[10px] text-slate-400 font-medium">ระบบบริหารการขาย & สต็อก</span>
        </div>
      </div>

      {/* Navigation Groups (Scrollable container with preserved scroll position) */}
      <div 
        ref={scrollRef}
        onScroll={(e) => {
          if (!isMobile) {
            sessionStorage.setItem('purim_sidebar_scroll_top', String(e.currentTarget.scrollTop));
          }
        }}
        className="flex-1 py-3 overflow-y-auto overflow-x-hidden flex flex-col gap-3 px-2"
      >
        {/* Quick POS Action Button (Purim POS สีฟ้า) */}
        <div className="px-1">
          <Link
            href="/pos"
            scroll={false}
            onClick={saveCurrentScroll}
            className={cn(
              'flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold transition-all shadow-xs group',
              pathname === '/pos'
                ? 'bg-sky-500 text-white shadow-sky-200 ring-2 ring-sky-300'
                : 'bg-sky-50 text-sky-950 border border-sky-200/90 hover:bg-sky-100/90'
            )}
          >
            <div className="flex items-center gap-2.5">
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0',
                pathname === '/pos' ? 'bg-white/20 text-white' : 'bg-sky-500 text-white shadow-2xs'
              )}>
                <ShoppingCart className="w-4 h-4" />
              </div>
              <span className="text-sm font-black tracking-wide">Purim POS</span>
            </div>
            <span className={cn(
              'text-[10px] px-2 py-0.5 rounded font-black uppercase',
              pathname === '/pos' ? 'bg-white/20 text-white' : 'bg-sky-200/80 text-sky-800'
            )}>
              ขายสด
            </span>
          </Link>
        </div>

        {/* Grouped Accordion Menu */}
        {navGroups.map((group) => {
          const isOpen = openGroups[group.id] ?? true;
          const isGroupActive = group.items.some((i) => pathname === i.href);
          const GroupIcon = group.icon;

          return (
            <div key={group.id} className="space-y-1">
              {/* Group Header (หัวข้อใหญ่ ขนาดใหญ่และหนากว่าหัวข้อย่อย) */}
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  'w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-sm font-bold transition-colors group',
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
                <div className="ml-3 pl-2.5 border-l-2 border-slate-200/80 space-y-0.5 py-0.5">
                  {group.items.map((item) => {
                    const hasChildren = Boolean(item.children && item.children.length > 0);
                    const isChildActive = hasChildren && Boolean(item.children?.some((c) => pathname === c.href));
                    const isSelfActive = pathname === item.href;
                    const isSubOpen = openSubMenus[item.href] ?? (isChildActive || isSelfActive);
                    const ItemIcon = item.icon;

                    if (hasChildren) {
                      return (
                        <div key={item.href} className="space-y-0.5">
                          <div
                            onClick={() => {
                              saveCurrentScroll();
                              setOpenSubMenus((prev) => ({ ...prev, [item.href]: !isSubOpen }));
                            }}
                            className={cn(
                              'flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] transition-all duration-150 group cursor-pointer',
                              isSelfActive || isChildActive
                                ? 'bg-indigo-50/80 text-indigo-950 font-bold'
                                : 'text-slate-700 hover:text-slate-950 hover:bg-slate-100 font-bold'
                            )}
                          >
                            <Link
                              href={item.href}
                              scroll={false}
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
                                saveCurrentScroll();
                                setOpenSubMenus((prev) => ({ ...prev, [item.href]: !isSubOpen }));
                              }}
                              className="p-0.5 text-slate-400 hover:text-slate-700 transition-colors ml-1"
                              title="ย่อ/ขยายเมนูย่อยรายงาน"
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
                            <div className="ml-3 pl-2 border-l-2 border-indigo-200/90 space-y-0.5 py-0.5">
                              {item.children?.map((sub) => {
                                const isSubActive = pathname === sub.href;
                                const SubIcon = sub.icon;
                                return (
                                  <Link
                                    key={sub.href}
                                    href={sub.href}
                                    scroll={false}
                                    onClick={saveCurrentScroll}
                                    className={cn(
                                      'flex items-center px-2 py-1.5 rounded-lg text-xs transition-all duration-150 whitespace-nowrap',
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
                        onClick={saveCurrentScroll}
                        className={cn(
                          'flex items-center px-2.5 py-1.5 rounded-lg text-[13px] transition-all duration-150 whitespace-nowrap',
                          isSelfActive
                            ? 'bg-indigo-600 text-white font-bold shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium'
                        )}
                      >
                        <ItemIcon className={cn('w-4 h-4 shrink-0 mr-2.5', isSelfActive ? 'text-white' : 'text-slate-400')} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* User Footer Profile */}
      <div className="p-3 border-t border-sidebar-border shrink-0 bg-sidebar">
        <div className="flex items-center px-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
            <span className="text-indigo-700 text-xs font-bold">{user?.name?.charAt(0)?.toUpperCase() || 'P'}</span>
          </div>
          <div className="ml-2.5 overflow-hidden">
            <p className="text-xs font-bold text-slate-900 truncate">{user?.name || 'Admin'}</p>
            <p className="text-[10px] text-slate-400 truncate">{user?.role || 'เจ้าของร้าน'}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors text-xs font-medium"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0 mr-2" />
          <span>ออกจากระบบ</span>
        </button>
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
      <div className={cn(
        'lg:hidden fixed top-0 left-0 h-full w-64 bg-sidebar z-50 flex flex-col transition-transform duration-300 shadow-2xl border-r border-sidebar-border',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {renderNavContent(mobileScrollRef, true)}
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex fixed top-0 left-0 h-full w-[240px] bg-sidebar flex-col z-50 border-r border-sidebar-border">
        {renderNavContent(desktopScrollRef, false)}
      </div>
    </>
  );
}
