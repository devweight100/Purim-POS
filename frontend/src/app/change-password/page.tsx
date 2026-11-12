"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { apiFetch } from "@/lib/api";
import { errorText } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinRequired, setPinRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const forced = Boolean(user?.mustChangePassword);

  useEffect(() => {
    apiFetch("/auth/default-pin")
      .then((res: { hasDefaultPin?: boolean }) => setPinRequired(Boolean(res?.hasDefaultPin)))
      .catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.trim().length < 8) return toast.error("รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร");
    if (newPassword !== confirmPassword) return toast.error("ยืนยันรหัสผ่านใหม่ไม่ตรงกัน");
    if (pinRequired && !/^\d{4,6}$/.test(newPin)) return toast.error("กรุณาตั้ง PIN ใหม่เป็นตัวเลข 4-6 หลัก");
    if (newPin && !/^\d{4,6}$/.test(newPin)) return toast.error("PIN ต้องเป็นตัวเลข 4-6 หลัก");
    setSaving(true);
    try {
      const res = await apiFetch<{ success?: boolean; message?: string; access_token?: string } | null>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword: newPassword.trim(), newPin: newPin || undefined }),
      });
      // The server revokes tokens issued before the change and returns a fresh one.
      if (res?.access_token) useAuthStore.getState().setToken(res.access_token);
      useAuthStore.setState((s) => ({ user: s.user ? { ...s.user, mustChangePassword: false } : s.user }));
      toast.success("เปลี่ยนรหัสผ่านเรียบร้อยแล้ว");
      router.replace("/pos");
    } catch (err) {
      toast.error(errorText(err) || "เปลี่ยนรหัสผ่านไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-100 px-4 py-8">
      <Card className="w-full max-w-md border-slate-200 bg-white shadow-2xl rounded-3xl overflow-hidden">
        <CardHeader className="space-y-2 items-center pt-8 pb-4 border-b border-slate-100 bg-slate-50/70 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center text-white shadow-md">
            <KeyRound className="w-7 h-7" />
          </div>
          <CardTitle className="text-xl font-bold text-slate-900">ตั้งรหัสผ่านใหม่</CardTitle>
          <CardDescription className="text-slate-600">
            {forced
              ? `บัญชี ${user?.username || ""} ยังใช้รหัสเริ่มต้นอยู่ กรุณาตั้งรหัสใหม่ก่อนใช้งานระบบ`
              : "เปลี่ยนรหัสผ่านของบัญชีคุณ"}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">รหัสผ่านปัจจุบัน</span>
              <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="รหัสที่ใช้เข้าสู่ระบบตอนนี้" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</span>
              <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="รหัสผ่านใหม่" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">ยืนยันรหัสผ่านใหม่</span>
              <Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="พิมพ์รหัสผ่านใหม่อีกครั้ง" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-slate-700">
                PIN ใหม่ (ตัวเลข 4-6 หลัก){pinRequired ? " *จำเป็น เพราะ PIN เดิมเป็นค่าเริ่มต้น" : " (ไม่บังคับ)"}
              </span>
              <Input type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN สำหรับเข้าระบบเร็ว" />
            </label>
            <Button type="submit" disabled={saving} className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl">
              {saving ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
            </Button>
            <button
              type="button"
              onClick={() => { logout(); router.replace("/login"); }}
              className="w-full text-xs text-slate-500 hover:text-slate-800"
            >
              ออกจากระบบ
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
