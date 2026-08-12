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
      user: null,
      token: null,
      isAuthenticated: false,
      login: async (username, password) => {
        try {
          // We need to bypass apiFetch's token check for login, or just use native fetch directly
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          });

          if (!response.ok) {
            return false;
          }

          const data = await response.json();
          set({
            user: { 
              id: data.user.id, 
              username: data.user.username, 
              name: data.user.fullName, 
              role: data.user.role 
            },
            token: data.access_token,
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
