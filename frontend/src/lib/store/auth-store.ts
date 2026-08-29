import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch } from '../api';

interface User {
  id: string;
  name: string;
  username: string;
  role: string;
}

interface AuthStore {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: {
        id: "mock-user-1",
        username: "admin",
        name: "ผู้ดูแลระบบ (Admin)",
        role: "ADMIN",
      },
      token: "mock-jwt-token-12345",
      isAuthenticated: true,
      login: async (username, password) => {
        try {
          const loggedUser = {
            id: "mock-user-1",
            username: username || "admin",
            name: username === "cashier" ? "พนักงานขาย (Cashier)" : "ผู้ดูแลระบบ (Admin)",
            role: "ADMIN",
          };
          set({
            user: loggedUser,
            token: "mock-jwt-token-12345",
            isAuthenticated: true,
          });
          return true;
        } catch (error) {
          console.error('Login failed', error);
          return false;
        }
      },
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
    }
  )
);
