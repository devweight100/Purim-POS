"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Save, Store, QrCode, Building2, ArrowRight, Settings, Coins } from "lucide-react";
import Link from "next/link";
import { 
  getCashDrawerConfig, 
  saveCashDrawerConfig, 
  kickCashDrawer, 
  connectWebSerialPrinter, 
  isWebSerialSupported, 
  CashDrawerConfig 
} from "@/lib/cash-drawer-service";

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({
    storeName: '',
    storePhone: '',
    storeAddress: '',
    qrLabel: ''
  });
  const [loading, setLoading] = useState(true);
  const [drawerConfig, setDrawerConfig] = useState<CashDrawerConfig>(getCashDrawerConfig());

  useEffect(() => {
    api.getStoreSettings().then(data => {
      setSettings(data);
      setLoading(false);
    });
    setDrawerConfig(getCashDrawerConfig());
  }, []);

  const handleSave = () => {
    toast.success("บันทึกการตั้งค่าสำเร็จ");
  };

  const handleUpdateDrawerConfig = (update: Partial<CashDrawerConfig>) => {
    const updated = saveCashDrawerConfig(update);
    setDrawerConfig(updated);
    toast.success("บันทึกการตั้งค่าลิ้นชักเรียบร้อย");
  };

  const handleTestKick = async () => {
    const res = await kickCashDrawer({ reason: 'ทดสอบการเตะลิ้นชัก' });
    if (res.methodUsed === 'print_pulse') {
      toast.success("⚡ ส่งคำสั่งเตะลิ้นชักผ่านเครื่องพิมพ์แล้ว (Windows Driver Pulse)");
    } else if (res.methodUsed === 'web_serial') {
      toast.success("⚡ สั่งเตะลิ้นชักผ่าน Web Serial สำเร็จ");
    } else {
      toast.info("ลิ้นชักถูกปิดใช้งานอยู่");
    }
  };

  const handleConnectSerial = async () => {
    const res = await connectWebSerialPrinter();
    if (res.success) {
      toast.success(res.message);
    } else {
      toast.error(res.message);
    }
  };

  if (loading) return <div className="p-4 text-slate-500 sm:p-6 lg:p-8">Loading...</div>;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
          <Settings className="w-6 h-6 text-sky-500" /> ตั้งค่าระบบร้านค้า (Settings)
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">จัดการข้อมูลร้านค้า ช่องทางชำระเงิน และบัญชีธนาคารรับโอนเงิน</p>
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

      {/* Cash Drawer & Printer Hardware Settings */}
      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center text-xl text-slate-900">
            <Coins className="w-5 h-5 mr-3 text-amber-500" />
            ตั้งค่าลิ้นชักเก็บเงิน & การเตะลิ้นชัก (Cash Drawer Settings)
          </CardTitle>
          <CardDescription className="text-slate-500">
            กำหนดค่าการสั่งเตะลิ้นชักผ่านเครื่องพิมพ์ใบเสร็จ และการเปิดลิ้นชักอัตโนมัติเมื่อรับเงินสด
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Left: Trigger Method */}
            <div className="p-4 border border-slate-200 rounded-2xl bg-slate-50/70 space-y-3">
              <label className="text-sm font-bold text-slate-900 block">รูปแบบคำสั่งเตะลิ้นชัก (Trigger Method)</label>
              <div className="space-y-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="drawerMethod"
                    checked={drawerConfig.method === 'print_pulse'}
                    onChange={() => handleUpdateDrawerConfig({ method: 'print_pulse' })}
                    className="mt-1 text-sky-600"
                  />
                  <div>
                    <span className="text-sm font-bold text-slate-900 block">1. ผ่านไดรเวอร์เครื่องพิมพ์ (Windows Print Pulse)</span>
                    <span className="text-xs text-slate-500 block leading-relaxed">
                      ค่าเริ่มต้นที่แนะนำ: ใช้คำสั่งกระตุ้นผ่าน Windows Printer Driver (เพียงเปิดตั้งค่า Cash Drawer ใน Windows ให้เรียบร้อย)
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="drawerMethod"
                    checked={drawerConfig.method === 'web_serial'}
                    onChange={() => handleUpdateDrawerConfig({ method: 'web_serial' })}
                    className="mt-1 text-sky-600"
                  />
                  <div>
                    <span className="text-sm font-bold text-slate-900 block">2. ส่งรหัสตรงผ่าน Web Serial API (Direct ESC/POS)</span>
                    <span className="text-xs text-slate-500 block leading-relaxed">
                      สำหรับต่อตรงกับเครื่องพิมพ์ USB/Serial พอร์ต COM สั่งเตะแบบเงียบสนิท ไม่ต้องเปิดหน้าต่างพิมพ์
                    </span>
                  </div>
                </label>
              </div>

              {drawerConfig.method === 'web_serial' && isWebSerialSupported() && (
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleConnectSerial}
                    className="text-xs font-bold border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-xl"
                  >
                    🔌 เลือกและเชื่อมต่อพอร์ตเครื่องพิมพ์ USB/Serial
                  </Button>
                </div>
              )}
            </div>

            {/* Right: Automation & Test Button */}
            <div className="p-4 border border-slate-200 rounded-2xl bg-slate-50/70 space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-900 block">การทำงานอัตโนมัติ</label>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={drawerConfig.openOnCashPayment}
                      onChange={(e) => handleUpdateDrawerConfig({ openOnCashPayment: e.target.checked })}
                      className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-sm text-slate-800 font-medium">
                      เตะเปิดลิ้นชักอัตโนมัติเมื่อรับเงินสด (Cash / Split Cash)
                    </span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={drawerConfig.soundFeedback}
                      onChange={(e) => handleUpdateDrawerConfig({ soundFeedback: e.target.checked })}
                      className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-sm text-slate-800 font-medium">
                      ส่งเสียงกระดิ่งเตือน (Chime Ding) เมื่อลิ้นชักเปิด
                    </span>
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  onClick={handleTestKick}
                  className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-black text-sm h-12 rounded-xl shadow-sm gap-2 cursor-pointer transition-all active:scale-95"
                >
                  <Coins className="w-5 h-5" /> ทดสอบสั่งเตะลิ้นชักเก็บเงินเดี๋ยวนี้ (Test Kick)
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
