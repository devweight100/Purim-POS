import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api';

export interface User {
  id: string;
  fullName: string;
  name?: string;
  username: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'WAREHOUSE';
  permissions?: string[];
  isActive?: boolean;
}

interface AuthStore {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithPin: (pin: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: {
        id: "admin-default",
        username: "admin",
        fullName: "ผู้ดูแลระบบ (Admin)",
        name: "ผู้ดูแลระบบ (Admin)",
        role: "ADMIN",
        permissions: ["ALL"],
        isActive: true,
      },
      token: "jwt-token-purim-pos",
      isAuthenticated: true,

      login: async (username, password) => {
        try {
          const res = await api.auth.login({ username, password });
          if (res?.access_token && res?.user) {
            const u = { ...res.user, name: res.user.fullName || res.user.name };
            set({
              user: u,
              token: res.access_token,
              isAuthenticated: true,
            });
            return { success: true };
          }
          return { success: false, error: 'เข้าสู่ระบบไม่สำเร็จ' };
        } catch (error: any) {
          console.error('Login error:', error);
          return { success: false, error: error.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
        }
      },

      loginWithPin: async (pin: string) => {
        try {
          const res = await api.auth.loginWithPin(pin);
          if (res?.access_token && res?.user) {
            const u = { ...res.user, name: res.user.fullName || res.user.name };
            set({
              user: u,
              token: res.access_token,
              isAuthenticated: true,
            });
            return { success: true };
          }
          return { success: false, error: 'รหัส PIN ไม่ถูกต้อง' };
        } catch (error: any) {
          console.error('PIN Login error:', error);
          return { success: false, error: error.message || 'รหัส PIN ไม่ถูกต้อง' };
        }
      },

      logout: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
    }
  )
);
