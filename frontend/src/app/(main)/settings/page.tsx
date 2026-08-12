"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Save, Store, QrCode } from "lucide-react";

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({
    storeName: '',
    storePhone: '',
    storeAddress: '',
    qrLabel: ''
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getStoreSettings().then(data => {
      setSettings(data);
      setLoading(false);
    });
  }, []);

  const handleSave = () => {
    toast.success("บันทึกการตั้งค่าสำเร็จ");
  };

  if (loading) return <div className="p-4 text-slate-500 sm:p-6 lg:p-8">Loading...</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 pb-20 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">ตั้งค่าระบบ</h1>
        <p className="text-slate-500 mt-2">จัดการข้อมูลร้านค้าและการชำระเงิน</p>
      </div>

      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center text-xl text-slate-900">
            <Store className="w-5 h-5 mr-3 text-primary" />
            ข้อมูลร้านค้า
          </CardTitle>
          <CardDescription className="text-slate-500">
            ข้อมูลนี้จะแสดงบนใบเสร็จและใบเรียกเก็บเงิน
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">ชื่อร้านค้า</label>
            <Input 
              value={settings.storeName}
              onChange={e => setSettings({...settings, storeName: e.target.value})}
              className="bg-white border-slate-300 focus-visible:ring-primary"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">เบอร์โทรศัพท์</label>
            <Input 
              value={settings.storePhone}
              onChange={e => setSettings({...settings, storePhone: e.target.value})}
              className="bg-white border-slate-300 focus-visible:ring-primary"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">ที่อยู่</label>
            <Textarea 
              value={settings.storeAddress}
              onChange={e => setSettings({...settings, storeAddress: e.target.value})}
              className="bg-white border-slate-300 focus-visible:ring-primary h-24"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center text-xl text-slate-900">
            <QrCode className="w-5 h-5 mr-3 text-primary" />
            ตั้งค่าช่องทางชำระเงิน (QR Code)
          </CardTitle>
          <CardDescription className="text-slate-500">
            สำหรับการชำระเงินผ่าน QR PromptPay
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">ข้อความแสดงใต้ QR Code</label>
            <Input 
              value={settings.qrLabel}
              onChange={e => setSettings({...settings, qrLabel: e.target.value})}
              className="bg-white border-slate-300 focus-visible:ring-primary"
              placeholder="เช่น PromptPay: 081-234-5678"
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">รูปภาพ QR Code</label>
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 sm:p-8 flex flex-col items-center justify-center bg-slate-50 hover:bg-sky-50 transition-colors cursor-pointer group">
              <QrCode className="w-12 h-12 text-slate-400 group-hover:text-primary transition-colors mb-4" />
              <p className="text-slate-500 group-hover:text-slate-700 text-sm text-center">คลิกเพื่ออัปโหลด หรือลากไฟล์มาวางที่นี่</p>
              <p className="text-slate-500 text-xs mt-2">รองรับ JPG, PNG ขนาดไม่เกิน 2MB</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-4">
        <Button variant="outline" className="h-12 px-6 border-slate-300">ยกเลิก</Button>
        <Button className="h-12 px-8 font-bold bg-primary hover:bg-primary/90 text-white" onClick={handleSave}>
          <Save className="w-5 h-5 mr-2" />
          บันทึกการตั้งค่า
        </Button>
      </div>
    </div>
  );
}
