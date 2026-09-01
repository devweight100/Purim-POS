"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { 
  Save, Store, Building2, ArrowRight, Settings, Coins, 
  FileText, MessageSquare, Sparkles, CheckCircle2, Eye, Printer, Phone, MapPin, Hash, Mail
} from "lucide-react";
import Link from "next/link";
import { 
  getCashDrawerConfig, 
  saveCashDrawerConfig, 
  kickCashDrawer, 
  connectWebSerialPrinter, 
  isWebSerialSupported, 
  CashDrawerConfig 
} from "@/lib/cash-drawer-service";
import { 
  loadStoreSettings, 
  saveStoreSettings, 
  StoreSettings, 
  DEFAULT_STORE_SETTINGS 
} from "@/lib/store-settings-storage";
import { ThermalReceiptView, SAMPLE_RECEIPT_DATA } from "@/components/pos/ThermalReceiptView";
import { formatCurrency } from "@/lib/utils";

export default function SettingsPage() {
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [drawerConfig, setDrawerConfig] = useState<CashDrawerConfig>(getCashDrawerConfig());

  useEffect(() => {
    const loaded = loadStoreSettings();
    setSettings(loaded);
    setDrawerConfig(getCashDrawerConfig());
    setLoading(false);
  }, []);

  const handleSaveStore = () => {
    saveStoreSettings(settings);
    toast.success("✅ บันทึกข้อมูลร้านค้าและข้อความใบเสร็จเรียบร้อยแล้ว");
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
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7 font-sans">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
          <Settings className="w-6 h-6 text-sky-500" /> ตั้งค่าระบบร้านค้า & ใบเสร็จ (Settings)
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          จัดการข้อมูลร้านค้า เลขผู้เสียภาษี ข้อความหัว-ท้ายใบเสร็จสลิป และอุปกรณ์ต่อพ่วง
        </p>
      </div>

      {/* Direct Banner Link to Financial Accounts & QR Management */}
      <Card className="bg-gradient-to-r from-sky-50 to-blue-50 border border-sky-200 shadow-2xs">
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-4 px-5">
          <div>
            <CardTitle className="flex items-center text-lg text-sky-950 font-bold">
              <Building2 className="w-5 h-5 mr-2.5 text-sky-600" />
              จัดการบัญชีการเงิน & รูป QR Code
            </CardTitle>
            <CardDescription className="text-sky-700 text-xs mt-0.5">
              เพิ่ม/แก้ไข บัญชีธนาคาร (กสิกรไทย, ไทยพาณิชย์ ฯลฯ) และอัปโหลดรูป QR Code สแกนจ่าย
            </CardDescription>
          </div>
          <Link href="/accounts">
            <Button className="bg-sky-500 hover:bg-sky-600 text-white font-bold h-10 px-4 shadow-2xs shrink-0 text-xs sm:text-sm rounded-xl">
              เปิดหน้าจัดการบัญชี <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </Link>
        </CardHeader>
      </Card>

      {/* 2-Column Responsive Layout: Form on Left, Real-Time Preview on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ─── LEFT COLUMN: SETTINGS FORM (7 cols) ─── */}
        <div className="lg:col-span-7 space-y-5">
          {/* Card 1: ข้อมูลร้านค้า & เอกสาร */}
          <Card className="bg-white border-slate-200 shadow-2xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="flex items-center text-lg text-slate-900 font-bold">
                <Store className="w-5 h-5 mr-2.5 text-sky-600" />
                ข้อมูลร้านค้า & นิติบุคคล
              </CardTitle>
              <CardDescription className="text-slate-500 text-xs">
                ข้อมูลนี้จะแสดงบนใบเสร็จรับเงิน ใบกำกับภาษี และเอกสารการเคลมสินค้า
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-slate-500" />
                    <span>ชื่อร้านค้า / บริษัท <span className="text-rose-500">*</span></span>
                  </label>
                  <Input 
                    value={settings.storeName}
                    onChange={e => setSettings({...settings, storeName: e.target.value})}
                    placeholder="เช่น ร้านปุริม ซุปเปอร์มาร์เก็ต"
                    className="bg-white border-slate-300 font-bold text-slate-900"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>สาขา (Branch)</span>
                  </label>
                  <Input 
                    value={settings.branchName}
                    onChange={e => setSettings({...settings, branchName: e.target.value})}
                    placeholder="เช่น สำนักงานใหญ่, สาขา 1"
                    className="bg-white border-slate-300 font-medium text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-slate-500" />
                    <span>เลขประจำตัวผู้เสียภาษี (Tax ID 13 หลัก)</span>
                  </label>
                  <Input 
                    value={settings.taxId}
                    onChange={e => setSettings({...settings, taxId: e.target.value})}
                    placeholder="เช่น 0105555555555"
                    maxLength={18}
                    className="bg-white border-slate-300 font-mono font-bold text-slate-900"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    <span>เบอร์โทรศัพท์ติดต่อ</span>
                  </label>
                  <Input 
                    value={settings.storePhone}
                    onChange={e => setSettings({...settings, storePhone: e.target.value})}
                    placeholder="เช่น 02-123-4567, 081-234-5678"
                    className="bg-white border-slate-300 font-mono text-slate-900"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  <span>อีเมล / Line ID / ช่องทางติดต่อเพิ่มเติม</span>
                </label>
                <Input 
                  value={settings.storeEmail}
                  onChange={e => setSettings({...settings, storeEmail: e.target.value})}
                  placeholder="เช่น Line: @purimpos, contact@purim.com"
                  className="bg-white border-slate-300 text-slate-900"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  <span>ที่อยู่ร้านค้า (แสดงบนหัวบิล)</span>
                </label>
                <Textarea 
                  value={settings.storeAddress}
                  onChange={e => setSettings({...settings, storeAddress: e.target.value})}
                  placeholder="เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                  className="bg-white border-slate-300 text-slate-900 h-20 text-xs leading-relaxed"
                />
              </div>
            </CardContent>
          </Card>

          {/* Card 2: ข้อความบนใบเสร็จแบบสลิป (Header & Footer) */}
          <Card className="bg-white border-slate-200 shadow-2xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="flex items-center text-lg text-slate-900 font-bold">
                <MessageSquare className="w-5 h-5 mr-2.5 text-indigo-600" />
                ข้อความส่วนบนและส่วนท้ายของใบเสร็จ (Receipt Slogan & Policy)
              </CardTitle>
              <CardDescription className="text-slate-500 text-xs">
                กำหนดคำต้อนรับ คำขอบคุณ หรือเงื่อนไขการเปลี่ยนคืนสินค้าที่จะพิมพ์ลงบนสลิปความร้อน 80mm
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>ข้อความส่วนบนของใบเสร็จ (Header Message / สโลแกน)</span>
                  </label>
                  <span className="text-[11px] text-slate-400 font-mono">แสดงใต้ชื่อร้าน</span>
                </div>
                <Textarea 
                  value={settings.receiptHeader}
                  onChange={e => setSettings({...settings, receiptHeader: e.target.value})}
                  placeholder="เช่น ยินดีต้อนรับสู่ร้านปุริม&#10;เปิดบริการทุกวัน 08:00 - 20:00 น."
                  rows={2}
                  className="bg-white border-slate-300 font-sans text-xs text-slate-900 leading-relaxed"
                />
                <p className="text-[11px] text-slate-400">รองรับการกด Enter เพื่อขึ้นบรรทัดใหม่</p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-indigo-600" />
                    <span>ข้อความส่วนท้ายของใบเสร็จ (Footer Policy / คำขอบคุณ / นโยบาย)</span>
                  </label>
                  <span className="text-[11px] text-slate-400 font-mono">แสดงล่างสุดของสลิป</span>
                </div>
                <Textarea 
                  value={settings.receiptFooter}
                  onChange={e => setSettings({...settings, receiptFooter: e.target.value})}
                  placeholder="เช่น ขอบคุณที่ใช้บริการ / Thank You&#10;* สินค้ารับเปลี่ยนภายใน 7 วันพร้อมใบเสร็จ *&#10;สอบถามเพิ่มเติม Line: @purimpos"
                  rows={3}
                  className="bg-white border-slate-300 font-sans text-xs text-slate-900 leading-relaxed"
                />
                <p className="text-[11px] text-slate-400">ใส่ข้อความแจ้งเงื่อนไขการเคลม หรือช่องทางติดต่อทางโซเชียลมีเดียได้</p>
              </div>

              <div className="pt-2">
                <Button 
                  type="button"
                  onClick={handleSaveStore}
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold h-11 rounded-xl shadow-2xs gap-2 cursor-pointer transition-all active:scale-[0.98]"
                >
                  <Save className="w-4 h-4" /> บันทึกรายละเอียดร้านค้า & ข้อความใบเสร็จ
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Card 3: ตั้งค่าลิ้นชักเก็บเงิน & การเตะลิ้นชัก */}
          <Card className="bg-white border-slate-200 shadow-2xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="flex items-center text-lg text-slate-900 font-bold">
                <Coins className="w-5 h-5 mr-2.5 text-amber-500" />
                ตั้งค่าลิ้นชักเก็บเงิน & การเตะลิ้นชัก (Cash Drawer Settings)
              </CardTitle>
              <CardDescription className="text-slate-500 text-xs">
                กำหนดค่าการสั่งเตะลิ้นชักผ่านเครื่องพิมพ์ใบเสร็จ และการเปิดลิ้นชักอัตโนมัติเมื่อรับเงินสด
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Left: Trigger Method */}
                <div className="p-3.5 border border-slate-200 rounded-2xl bg-slate-50/70 space-y-2.5">
                  <label className="text-xs font-bold text-slate-900 block">รูปแบบคำสั่งเตะลิ้นชัก</label>
                  <div className="space-y-2.5">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="drawerMethod"
                        checked={drawerConfig.method === 'print_pulse'}
                        onChange={() => handleUpdateDrawerConfig({ method: 'print_pulse' })}
                        className="mt-1 text-sky-600"
                      />
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">1. ผ่านไดรเวอร์เครื่องพิมพ์ (Windows Pulse)</span>
                        <span className="text-[10.5px] text-slate-500 block leading-tight">
                          ค่าเริ่มต้นที่แนะนำ: ใช้ร่วมกับการตั้งค่า Cash Drawer ใน Windows
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="drawerMethod"
                        checked={drawerConfig.method === 'web_serial'}
                        onChange={() => handleUpdateDrawerConfig({ method: 'web_serial' })}
                        className="mt-1 text-sky-600"
                      />
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">2. ส่งตรงผ่าน Web Serial API (ESC/POS)</span>
                        <span className="text-[10.5px] text-slate-500 block leading-tight">
                          สำหรับพอร์ต USB/COM สั่งเตะแบบเงียบสนิท ไม่ต้องเปิดหน้าต่างพิมพ์
                        </span>
                      </div>
                    </label>
                  </div>

                  {drawerConfig.method === 'web_serial' && isWebSerialSupported() && (
                    <div className="pt-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleConnectSerial}
                        className="text-[11px] font-bold border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-lg w-full h-8"
                      >
                        🔌 เลือกและเชื่อมต่อพอร์ตเครื่องพิมพ์ USB/Serial
                      </Button>
                    </div>
                  )}
                </div>

                {/* Right: Automation & Test Button */}
                <div className="p-3.5 border border-slate-200 rounded-2xl bg-slate-50/70 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-900 block">การทำงานอัตโนมัติ</label>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={drawerConfig.openOnCashPayment}
                        onChange={(e) => handleUpdateDrawerConfig({ openOnCashPayment: e.target.checked })}
                        className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        เตะเปิดลิ้นชักอัตโนมัติเมื่อรับเงินสด (Cash / Split)
                      </span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={drawerConfig.soundFeedback}
                        onChange={(e) => handleUpdateDrawerConfig({ soundFeedback: e.target.checked })}
                        className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-slate-800 font-medium">
                        ส่งเสียงกระดิ่งเตือน (Chime Ding) เมื่อลิ้นชักเปิด
                      </span>
                    </label>
                  </div>

                  <div className="pt-2 border-t border-slate-200">
                    <Button
                      type="button"
                      onClick={handleTestKick}
                      className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-bold text-xs h-10 rounded-xl shadow-2xs gap-1.5 cursor-pointer transition-all active:scale-95"
                    >
                      <Coins className="w-4 h-4" /> ทดสอบสั่งเตะลิ้นชักเก็บเงินเดี๋ยวนี้ (Test Kick)
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── RIGHT COLUMN: LIVE REAL-TIME RECEIPT SLIP PREVIEW (5 cols) ─── */}
        <div className="lg:col-span-5 lg:sticky lg:top-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-bold text-slate-900">ตัวอย่างสลิปใบเสร็จจริงหน้าขาย (Live Real-Time Preview)</span>
            </div>
            <Badge variant="outline" className="text-[10.5px] bg-emerald-50 text-emerald-700 border-emerald-300 gap-1 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Real-time
            </Badge>
          </div>

          <div className="bg-slate-200/70 p-4 sm:p-5 rounded-2xl border border-slate-300 flex justify-center shadow-inner overflow-x-auto">
            {/* The EXACT SAME Thermal Receipt View component as used in POS sales modal */}
            <ThermalReceiptView data={SAMPLE_RECEIPT_DATA} settings={settings} />
          </div>

          <p className="text-[11px] text-center text-slate-500 font-sans">
            💡 ตัวอย่างสลิปด้านบนนี้ ใช้แม่แบบเดียวกับใบเสร็จจริงหน้าขาย 100% (WYSIWYG) เมื่อพิมพ์ออกมาจะได้แบบนี้ทุกประการ
          </p>
        </div>
      </div>
    </div>
  );
}
