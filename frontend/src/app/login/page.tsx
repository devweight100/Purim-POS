"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ShoppingBag, ArrowRight, ShieldCheck, UserCheck, CheckCircle2, Sparkles } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuthStore();

  const doLoginAndRedirect = (userRole: string = "admin") => {
    try {
      if (typeof window !== "undefined") {
        // Force set auth storage synchronously in localStorage so any page can read it immediately
        localStorage.setItem(
          "auth-storage",
          JSON.stringify({
            state: {
              user: {
                id: "mock-user-1",
                username: userRole,
                name: userRole === "cashier" ? "พนักงานขาย (Cashier)" : "ผู้ดูแลระบบ (Admin)",
                role: "ADMIN",
              },
              token: "mock-jwt-token-12345",
              isAuthenticated: true,
            },
            version: 0,
          })
        );
      }
    } catch {}

    // Hard browser redirect to guarantee navigation on all mobile and desktop devices
    window.location.href = "/pos";
  };

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    doLoginAndRedirect(username || "admin");
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-100 px-4 py-8">
      <Card className="relative z-10 w-full max-w-md border-slate-200 bg-white shadow-2xl rounded-3xl overflow-hidden">
        <CardHeader className="space-y-2 items-center pt-8 pb-4 border-b border-slate-100 bg-slate-50/70 text-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mb-1 text-white shadow-md">
            <ShoppingBag className="w-8 h-8" />
          </div>
          <CardTitle className="text-2xl font-black text-slate-900">ร้านปุริม POS</CardTitle>
          <CardDescription className="text-slate-500 text-xs font-medium">
            ระบบจัดการหน้าร้านและการขาย (Purim Point of Sale)
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 sm:p-8 space-y-5">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-xs font-bold text-slate-700">
                ชื่อผู้ใช้งาน
              </label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 border-slate-300 bg-white text-sm font-semibold rounded-xl focus:border-indigo-500 shadow-inner"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-bold text-slate-700">
                รหัสผ่าน
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 border-slate-300 bg-white text-sm font-semibold rounded-xl focus:border-indigo-500 shadow-inner"
                required
              />
            </div>

            <Button
              type="button"
              onClick={() => handleLogin()}
              className="w-full h-12 text-base font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-all mt-2 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>เข้าสู่ระบบ (Login)</span>
            </Button>
          </form>

          {/* Quick Access Buttons */}
          <div className="pt-3 border-t border-slate-200 space-y-2.5">
            <span className="text-[11px] font-bold text-slate-500 block text-center">
              หรือเข้าใช้งานหน้าร้านได้ทันที:
            </span>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => doLoginAndRedirect("admin")}
                className="h-10 px-3 text-xs font-bold border border-slate-300 hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 bg-white text-slate-700 rounded-xl flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer transition-all active:scale-95"
              >
                <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Admin (ผู้ดูแล)</span>
              </button>

              <button
                type="button"
                onClick={() => doLoginAndRedirect("cashier")}
                className="h-10 px-3 text-xs font-bold border border-slate-300 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 bg-white text-slate-700 rounded-xl flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer transition-all active:scale-95"
              >
                <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Cashier (แคชเชียร์)</span>
              </button>
            </div>

            {/* Direct Native Link (Never fails on any mobile phone/browser) */}
            <a
              href="/pos"
              onClick={() => doLoginAndRedirect("admin")}
              className="w-full h-11 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-xl flex items-center justify-center gap-2 shadow-sm mt-1 transition-all active:scale-95"
            >
              <span>🚀 เข้าหน้าขายหน้าร้าน (POS) ทันที</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
