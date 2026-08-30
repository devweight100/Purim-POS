'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { 
  ShoppingCart, ClipboardList, Users, LayoutDashboard, Package, 
  Warehouse, Settings, LogOut, Menu, X, Truck, FileText, BarChart3, 
  FolderTree, Building2, Receipt, ShieldAlert, ArrowLeftRight, HandCoins,
  ChevronDown, History
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store/auth-store';
import { useRouter } from 'next/navigation';

interface SubMenuItem {
  href: string;
  label: string;
  icon: any;
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
    icon: LayoutDashboard,
    items: [
      { href: '/dashboard', label: 'แดชบอร์ดสรุป', icon: LayoutDashboard },
      { href: '/reports', label: 'รายงานยอดขาย & สถิติ', icon: BarChart3 },
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

  // Group accordion state (open all by default)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    overview: true,
    sales: true,
    inventory: true,
    purchasing: true,
    system: true,
  });

  // Ensure current pathname's group is open
  useEffect(() => {
    navGroups.forEach((group) => {
      if (group.items.some((item) => item.href === pathname)) {
        setOpenGroups((prev) => ({ ...prev, [group.id]: true }));
      }
    });
  }, [pathname]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const NavContent = () => (
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

      {/* Navigation Groups */}
      <div className="flex-1 py-3 overflow-y-auto overflow-x-hidden flex flex-col gap-3 px-2">
        {/* Quick POS Action Button (Purim POS สีฟ้า) */}
        <div className="px-1">
          <Link
            href="/pos"
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
                    const isActive = pathname === item.href;
                    const ItemIcon = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center px-2.5 py-1.5 rounded-lg text-[13px] transition-all duration-150 whitespace-nowrap',
                          isActive
                            ? 'bg-indigo-600 text-white font-bold shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium'
                        )}
                      >
                        <ItemIcon className={cn('w-4 h-4 shrink-0 mr-2.5', isActive ? 'text-white' : 'text-slate-400')} />
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
        <NavContent />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex fixed top-0 left-0 h-full w-[240px] bg-sidebar flex-col z-50 border-r border-sidebar-border">
        <NavContent />
      </div>
    </>
  );
}
