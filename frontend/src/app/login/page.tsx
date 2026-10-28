"use client";

import { useState } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ShoppingBag, Sparkles } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuthStore();

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast.error("กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน");
      return;
    }
    setIsLoading(true);
    try {
      const res = await login(username.trim(), password.trim());
      if (res?.success) {
        toast.success("เข้าสู่ระบบสำเร็จ");
        window.location.href = "/pos";
      } else {
        toast.error(res?.error || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }
    } catch (err: any) {
      toast.error(err?.message || "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
    } finally {
      setIsLoading(false);
    }
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
                placeholder="กรอกชื่อผู้ใช้ เช่น admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 border-slate-300 bg-white text-sm font-semibold rounded-xl focus:border-indigo-500 shadow-inner"
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-bold text-slate-700">
                รหัสผ่าน
              </label>
              <Input
                id="password"
                type="password"
                placeholder="กรอกรหัสผ่าน"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 border-slate-300 bg-white text-sm font-semibold rounded-xl focus:border-indigo-500 shadow-inner"
                required
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 text-base font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-all mt-2 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>กำลังเข้าสู่ระบบ...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>เข้าสู่ระบบ (Login)</span>
                </>
              )}
            </Button>
          </form>

          <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-500 space-y-1">
            <p>Admin: <span className="font-semibold text-slate-700">admin</span> / <span className="font-semibold text-slate-700">admin123</span></p>
            <p>Cashier: <span className="font-semibold text-slate-700">cashier</span> / <span className="font-semibold text-slate-700">cashier123</span></p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
