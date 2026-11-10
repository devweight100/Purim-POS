'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuthStore } from '@/lib/store/auth-store';
import { useCartStore } from '@/lib/store/cart-store';
import { useShiftStore } from '@/lib/store/shift-store';
import { performLogout } from '@/lib/logout';

type Variant = 'classic' | 'neo';

const BUTTON_CLASS: Record<Variant, string> = {
  classic:
    'h-11 px-3 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-2xs transition-colors',
  neo:
    'h-10 rounded-xl border-2 border-black bg-white px-3 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-[#E2E8F0] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1.5 shrink-0',
};

/** "ออกจากระบบ" for the sales screens: confirms, then signs out and goes to the login page. */
export function PosLogoutButton({ variant = 'classic', className = '' }: { variant?: Variant; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const userName = useAuthStore((s) => s.user?.fullName || s.user?.name || s.user?.username || '');
  const cartCount = useCartStore((s) => s.items.length);
  const heldCount = useCartStore((s) => s.heldBills.length);
  const shiftOpen = useShiftStore((s) => Boolean(s.currentShift));

  const confirmLogout = () => {
    setOpen(false);
    performLogout();
    router.replace('/login');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${BUTTON_CLASS[variant]} ${className}`}
        title={userName ? `ออกจากระบบ (${userName})` : 'ออกจากระบบ'}
        aria-label="ออกจากระบบ"
      >
        <LogOut className="w-4 h-4" />
        <span className="hidden sm:inline">ออกจากระบบ</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-white sm:max-w-md">
          <DialogTitle className="text-base font-bold text-slate-900">ออกจากระบบ{userName ? ` (${userName})` : ''}?</DialogTitle>
          <DialogDescription className="text-sm text-slate-600 space-y-1.5">
            {shiftOpen && (
              <span className="block">
                กะของคุณ<b>ยังเปิดอยู่</b> การออกจากระบบ<b>ไม่ใช่การปิดกะ</b> ถ้าเลิกงานแล้วให้กด &quot;ปิดกะ&quot; เพื่อนับเงินก่อน
              </span>
            )}
            {cartCount > 0 && (
              <span className="block">ตะกร้ามีสินค้า {cartCount} รายการ จะยังค้างอยู่ในเครื่องนี้</span>
            )}
            {heldCount > 0 && <span className="block">บิลที่พักไว้ {heldCount} บิล จะยังอยู่ในเครื่องนี้</span>}
            {!shiftOpen && cartCount === 0 && heldCount === 0 && <span className="block">กลับไปหน้าเข้าสู่ระบบ</span>}
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={confirmLogout}
              autoFocus
              className="px-4 py-2 text-sm bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              ออกจากระบบ
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
