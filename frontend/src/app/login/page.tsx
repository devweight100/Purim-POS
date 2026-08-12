"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ShoppingBag } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const login = useAuthStore((state) => state.login);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const success = await login(username, password);
      if (success) {
        toast.success("เข้าสู่ระบบสำเร็จ");
        router.push("/pos");
      } else {
        toast.error("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4 py-8">
      <Card className="relative z-10 w-full max-w-md border-slate-200 bg-white shadow-xl">
        <CardHeader className="space-y-3 items-center pt-8 pb-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mb-2">
            <ShoppingBag className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold text-slate-900">ร้านปุริม POS</CardTitle>
          <CardDescription className="text-slate-500">
            ระบบจัดการหน้าร้านและการขาย
          </CardDescription>
        </CardHeader>
        <CardContent className="px-8 pb-8">
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">ชื่อผู้ใช้งาน</label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-12 border-slate-300 bg-white text-lg focus-visible:ring-primary"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">รหัสผ่าน</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 border-slate-300 bg-white text-lg focus-visible:ring-primary"
                required
              />
            </div>
            <Button
              type="submit"
              className="w-full h-12 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25"
              disabled={isLoading}
            >
              {isLoading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
            </Button>
            
            <p className="text-center text-sm text-slate-500 mt-4">
              Demo: admin / admin123
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
