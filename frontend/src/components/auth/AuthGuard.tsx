'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth-store';
import { setInMemoryAuthToken } from '@/lib/api';
import { canAccessRoute } from '@/lib/permissions';
import { ShieldAlert } from 'lucide-react';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, token } = useAuthStore();
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Check if hydration already finished or read from localStorage directly
    const checkHydration = () => {
      if (typeof window === 'undefined') return;
      
      // Sync with localStorage directly so memory state never drifts into a zombie session
      try {
        const raw = localStorage.getItem('auth-storage');
        if (raw) {
          const parsed = JSON.parse(raw);
          const storedToken = parsed.state?.token;
          const memState = useAuthStore.getState();
          if (storedToken && parsed.state?.isAuthenticated) {
            setInMemoryAuthToken(storedToken);
            useAuthStore.setState({
              token: storedToken,
              user: parsed.state.user,
              isAuthenticated: true,
            });
          } else if (memState.token && memState.isAuthenticated) {
            // Recover localStorage if memory still has active token
            setInMemoryAuthToken(memState.token);
            parsed.state = {
              ...parsed.state,
              token: memState.token,
              user: memState.user,
              isAuthenticated: true,
            };
            localStorage.setItem('auth-storage', JSON.stringify(parsed));
          } else {
            // Neither has a valid token -> ensure clean logged-out state
            useAuthStore.getState().logout();
          }
        }
      } catch {}

      setIsHydrated(true);
    };

    const handleUnauthorized = () => {
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login') {
        router.replace('/login');
      }
    };

    const unsub = useAuthStore.persist?.onFinishHydration?.(() => {
      checkHydration();
    });

    checkHydration();
    window.addEventListener('purim:unauthorized', handleUnauthorized);
    const fallbackTimer = setTimeout(() => setIsHydrated(true), 150);

    return () => {
      unsub?.();
      window.removeEventListener('purim:unauthorized', handleUnauthorized);
      clearTimeout(fallbackTimer);
    };
  }, [router]);

  const hasValidAuth = Boolean(isHydrated && isAuthenticated && token);
  const isLoginPage = pathname === '/login';
  const isMasterControl = pathname === '/master-control' || pathname?.startsWith('/master-control');
  const isPublicRoute = isLoginPage || isMasterControl;
  const hasRoutePermission = isPublicRoute || canAccessRoute(user, pathname);

  useEffect(() => {
    if (!isHydrated) return;

    if (!hasValidAuth && !isPublicRoute) {
      // Not logged in -> Redirect to login page
      router.replace('/login');
    } else if (hasValidAuth && isLoginPage) {
      // Already logged in -> Redirect to POS
      router.replace('/pos');
    }
  }, [isHydrated, hasValidAuth, isLoginPage, isPublicRoute, router]);

  // Master Control can be accessed directly for remote monitoring
  if (isMasterControl) {
    return <>{children}</>;
  }

  // While checking auth status
  if (!isHydrated) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-slate-500">กำลังตรวจสอบสิทธิ์การเข้าใช้งาน...</span>
        </div>
      </div>
    );
  }

  // If unauthorized on protected route, show redirect message
  if (!hasValidAuth && !isLoginPage) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-slate-500">กรุณาเข้าสู่ระบบ กำลังนำท่านไปหน้าล็อกอิน...</span>
        </div>
      </div>
    );
  }

  // If already authenticated and trying to view /login, show redirect message
  if (hasValidAuth && isLoginPage) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-slate-500">เข้าสู่ระบบแล้ว กำลังนำท่านไปหน้าขาย...</span>
        </div>
      </div>
    );
  }

  // If logged in but does not have permission for this route
  if (hasValidAuth && !hasRoutePermission) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-100 px-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-slate-200 shadow-xl text-center space-y-4">
          <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-black text-slate-900">ไม่มีสิทธิ์เข้าถึงหน้านี้</h2>
          <p className="text-sm text-slate-500 font-medium">
            บัญชีของคุณ ({user?.fullName || user?.username || 'Cashier'}) ไม่มีสิทธิ์ในการเข้าถึงเมนูนี้ กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบ (Admin)
          </p>
          <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() => router.replace('/pos')}
              className="px-5 py-2.5 bg-slate-150 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition-all cursor-pointer border border-slate-300"
            >
              กลับสู่หน้าร้าน (POS)
            </button>
            <button
              type="button"
              onClick={() => {
                useAuthStore.getState().logout();
                router.replace('/login');
              }}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl transition-all shadow-md cursor-pointer"
            >
              เข้าสู่ระบบด้วย Admin
            </button>
          </div>
          <div className="mt-4 p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-left text-xs text-indigo-900 space-y-1">
            <p className="font-bold">💡 ข้อมูลสำหรับผู้ดูแลร้าน:</p>
            <p>• เมนูหลังบ้านจำเป็นต้องใช้สิทธิ์ <b>ผู้ดูแลระบบ (Admin)</b></p>
            <p>• ชื่อผู้ใช้งาน: <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-200 font-bold">admin</code> / รหัสผ่าน: <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-200 font-bold">admin123</code></p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
