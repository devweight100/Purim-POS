"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Save, Store, QrCode, Building2, ArrowRight } from "lucide-react";
import Link from "next/link";

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
        <p className="text-slate-500 mt-2">จัดการข้อมูลร้านค้า ช่องทางชำระเงิน และ บัญชีธนาคารรับโอนเงิน</p>
      </div>

      {/* Direct Banner Link to Financial Accounts & QR Management */}
      <Card className="bg-gradient-to-r from-sky-50 to-blue-50 border-2 border-sky-200 shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center text-xl text-sky-900 font-bold">
              <Building2 className="w-6 h-6 mr-3 text-sky-600" />
              จัดการบัญชีการเงิน & รูป QR Code
            </CardTitle>
            <CardDescription className="text-sky-700 mt-1">
              เพิ่ม/แก้ไข บัญชีธนาคาร (กสิกรไทย, ไทยพาณิชย์ ฯลฯ) และ อัปโหลดรูปภาพ QR Code สแกนจ่าย
            </CardDescription>
          </div>
          <Link href="/accounts">
            <Button className="bg-sky-500 hover:bg-sky-600 text-white font-bold h-11 px-5 shadow-sm shrink-0">
              เปิดหน้าจัดการบัญชี <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </CardHeader>
      </Card>

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

          <div className="pt-2">
            <Button onClick={handleSave} className="bg-sky-500 hover:bg-sky-600 text-white font-bold">
              <Save className="w-4 h-4 mr-2" /> บันทึกข้อมูลร้านค้า
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
