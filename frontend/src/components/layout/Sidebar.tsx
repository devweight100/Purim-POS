'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { 
  ShoppingCart, ClipboardList, Users, LayoutDashboard, Package, 
  Warehouse, Settings, LogOut, Menu, X, Truck, FileText, BarChart3, FolderTree, Building2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store/auth-store';
import { useRouter } from 'next/navigation';

const menuItems = [
  { href: '/pos', label: 'หน้าขาย (POS)', icon: ShoppingCart },
  { href: '/orders', label: 'รายการออเดอร์', icon: ClipboardList },
  { href: '/customers', label: 'ลูกค้า', icon: Users },
  { type: 'separator' as const },
  { href: '/dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard },
  { href: '/products', label: 'สินค้า', icon: Package },
  { href: '/categories', label: 'หมวดหมู่สินค้า', icon: FolderTree },
  { href: '/inventory', label: 'คลังสินค้า', icon: Warehouse },
  { href: '/suppliers', label: 'ผู้จำหน่าย', icon: Truck },
  { href: '/purchase-orders', label: 'ใบสั่งซื้อ (PO)', icon: FileText },
  { href: '/accounts', label: 'บัญชีการเงิน / QR Code', icon: Building2 },
  { href: '/reports', label: 'รายงาน', icon: BarChart3 },
  { href: '/settings', label: 'ตั้งค่า', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const NavContent = () => (
    <>
      <div className="p-4 flex items-center h-16 shrink-0 border-b border-sidebar-border bg-sidebar">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0 shadow-sm">
          <span className="font-bold text-white text-sm leading-none">P</span>
        </div>
        <span className="ml-3 font-bold text-base text-sidebar-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300 lg:hidden xl:hidden">ร้านปุริม</span>
        <span className="ml-3 font-bold text-base text-sidebar-foreground whitespace-nowrap">ร้านปุริม POS</span>
      </div>

      <div className="flex-1 py-3 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 px-2">
        {menuItems.map((item, index) => {
          if (item.type === 'separator') {
            return <div key={`sep-${index}`} className="h-px bg-sidebar-border my-2" />;
          }

          const isActive = pathname === item.href;
          const Icon = item.icon as any;

          return (
            <Link
              key={item.href}
              href={item.href!}
              className={cn(
                'flex items-center px-3 py-2.5 rounded-lg transition-all duration-150 whitespace-nowrap group/item',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                  : 'text-sidebar-foreground hover:bg-slate-100 hover:text-slate-950'
              )}
            >
              <Icon className={cn('w-5 h-5 shrink-0', isActive && 'text-primary')} />
              <span className="ml-3 text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="p-3 border-t border-sidebar-border shrink-0 bg-sidebar">
        <div className="flex items-center px-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <span className="text-primary text-sm font-bold">{user?.name?.charAt(0)?.toUpperCase() || 'U'}</span>
          </div>
          <div className="ml-3 overflow-hidden">
            <p className="text-sm font-medium text-slate-900 truncate">{user?.name || 'Admin'}</p>
            <p className="text-xs text-slate-500 truncate">{user?.role || 'ADMIN'}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center px-3 py-2 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors text-sm"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span className="ml-3">ออกจากระบบ</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-white text-slate-900 shadow-lg border border-slate-200"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div className={cn(
        'lg:hidden fixed top-0 left-0 h-full w-64 bg-sidebar z-50 flex flex-col transition-transform duration-300 shadow-xl',
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
