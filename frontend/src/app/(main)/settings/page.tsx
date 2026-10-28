"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { 
  Save, Store, Building2, ArrowRight, Settings, Coins, 
  FileText, MessageSquare, Sparkles, CheckCircle2, Eye, Printer, Phone, MapPin, Hash, Mail,
  Trash2, AlertTriangle, RefreshCcw, ShieldAlert
} from "lucide-react";
import Link from "next/link";
import { Database, DownloadCloud, ShieldCheck } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  backupService,
  describeBackupError,
  formatBytes,
  type BackupFile,
  type BackupStatus,
} from "@/lib/backup-service";
import { api } from "@/lib/api";
import { useProductStore } from "@/lib/store/product-store";
import { useShiftStore } from "@/lib/store/shift-store";
import { useCartStore } from "@/lib/store/cart-store";
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
  loadStoreSettingsFromBackend,
  saveStoreSettingsToBackend,
  StoreSettings, 
  DEFAULT_STORE_SETTINGS 
} from "@/lib/store-settings-storage";
import { ThermalReceiptView, SAMPLE_RECEIPT_DATA } from "@/components/pos/ThermalReceiptView";
import { formatCurrency } from "@/lib/utils";

function BackupSection() {
  const role = useAuthStore((s) => s.user?.role);
  const allowed = role === "ADMIN" || role === "MANAGER";
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [list, st] = await Promise.all([backupService.list(), backupService.status()]);
      setFiles(list);
      setStatus(st);
    } catch (err) {
      toast.error(describeBackupError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!allowed) return null;

  const handleCreate = async () => {
    setCreating(true);
    setVerifyMsg(null);
    try {
      const res = await backupService.create();
      toast.success(`สำรองข้อมูลสำเร็จ: ${res.fileName} (${formatBytes(res.sizeBytes)})`);
      if (res.verify) {
        setVerifyMsg({
          ok: res.verify.ok,
          text: res.verify.ok ? "ตรวจสอบไฟล์สำรองผ่าน" : `ตรวจสอบไฟล์ไม่ผ่าน: ${res.verify.message || ""}`,
        });
      }
      await load();
    } catch (err) {
      toast.error(describeBackupError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleVerify = async (fileName: string) => {
    setVerifying(fileName);
    const res = await backupService.verify(fileName);
    if (res) {
      setVerifyMsg({
        ok: res.ok,
        text: res.ok
          ? `${fileName}: ไฟล์สมบูรณ์ (${formatBytes(res.sizeBytes)})`
          : `${fileName}: ตรวจสอบไม่ผ่าน ${res.message || ""}`,
      });
    } else {
      toast.error("ตรวจสอบไฟล์สำรองไม่ได้ในขณะนี้");
    }
    setVerifying(null);
  };

  const fmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "-";

  return (
    <Card className="bg-white border-slate-200 shadow-2xs mt-6">
      <CardHeader className="pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center text-lg text-slate-900 font-bold">
              <Database className="w-5 h-5 mr-2 text-emerald-600" /> สำรองข้อมูล
            </CardTitle>
            <CardDescription className="text-slate-500 text-xs">
              ระบบสำรองอัตโนมัติทุกวัน 23:30 และเก็บไฟล์ย้อนหลังตามนโยบาย
            </CardDescription>
          </div>
          <Button onClick={handleCreate} disabled={creating} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <DownloadCloud className="w-4 h-4 mr-1.5" />
            {creating ? "กำลังสำรอง..." : "สำรองข้อมูลตอนนี้"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="text-xs text-slate-600">
          สำรองอัตโนมัติล่าสุด: <span className="font-bold">{status ? fmt(status.lastAutoBackupAt) : "ไม่มีข้อมูล"}</span>
          {status?.lastBackupOk === false && (
            <span className="ml-2 text-rose-600 font-bold">ครั้งล่าสุดล้มเหลว: {status.lastError}</span>
          )}
        </div>
        {verifyMsg && (
          <div className={`text-xs font-bold flex items-center gap-1 ${verifyMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>
            <ShieldCheck className="w-4 h-4" /> {verifyMsg.text}
          </div>
        )}
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {loading && <div className="p-3 text-xs text-slate-500">กำลังโหลด...</div>}
          {!loading && files.length === 0 && (
            <div className="p-3 text-xs text-slate-500">ยังไม่มีไฟล์สำรองข้อมูล</div>
          )}
          {files.map((f) => (
            <div key={f.fileName} className="flex items-center justify-between gap-3 p-2.5 text-xs">
              <div className="min-w-0">
                <div className="font-mono font-bold text-slate-800 truncate">{f.fileName}</div>
                <div className="text-slate-500">{fmt(f.createdAt)} • {formatBytes(f.sizeBytes)}</div>
              </div>
              {f.fileName.endsWith(".dump") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={verifying === f.fileName}
                  onClick={() => handleVerify(f.fileName)}
                >
                  {verifying === f.fileName ? "กำลังตรวจ..." : "ตรวจสอบไฟล์"}
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [drawerConfig, setDrawerConfig] = useState<CashDrawerConfig>(getCashDrawerConfig());

  // Reset database state
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  // Hardware / Printer detection state
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [installedPrinters, setInstalledPrinters] = useState<any[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [testingKick, setTestingKick] = useState(false);
  const [lastKickResult, setLastKickResult] = useState<{
    success: boolean;
    text: string;
    printer?: string;
    time: string;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    setSettings(loadStoreSettings());
    loadStoreSettingsFromBackend().then((loaded) => {
      if (mounted) setSettings(loaded);
    });
    setDrawerConfig(getCashDrawerConfig());

    // Check if running inside Electron desktop app and fetch Windows printers
    if (typeof window !== "undefined" && (window as any).electronAPI) {
      setIsDesktopApp(true);
      if ((window as any).electronAPI.getPrinters) {
        setLoadingPrinters(true);
        (window as any).electronAPI.getPrinters().then((printers: any[]) => {
          if (mounted) {
            setInstalledPrinters(printers || []);
          }
        }).catch((e: any) => {
          console.warn("Failed to load printers:", e);
        }).finally(() => {
          if (mounted) setLoadingPrinters(false);
        });
      }
    }

    setLoading(false);
    return () => { mounted = false; };
  }, []);

  const handleResetAllData = async () => {
    if (confirmText.trim() !== "RESET") {
      toast.error("กรุณาพิมพ์คำว่า RESET เพื่อยืนยัน");
      return;
    }

    setIsResetting(true);
    try {
      await api.settings.resetDatabase();

      // Clear all local storage keys
      if (typeof window !== "undefined") {
        const keysToRemove = [
          "pos_orders_history",
          "pos_shifts_history",
          "pos_current_shift",
          "pos_cash_transactions",
          "pos_product_claims",
          "pos_replacement_warranties",
          "custom_products",
          "pos_customers",
          "pos_customer_debts",
          "pos_debt_records",
          "pos_cart_state",
          "pos_product_categories",
          "pos_suppliers",
          "pos_purchase_orders",
          "pos_payable_bills",
          "pos_payment_vouchers",
          "pos_supplier_returns",
          "pos_bank_accounts",
          "offline_orders_queue",
        ];
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      }

      // Reset stores
      await useProductStore.getState().fetchProducts();
      useShiftStore.setState({ currentShift: null, completedOrders: [], cashTransactions: [] });
      useCartStore.getState().clearCart();

      toast.success("✅ ล้างข้อมูลทั้งหมดในระบบเรียบร้อยแล้ว คงเหลือเฉพาะผู้ใช้งาน admin");
      setIsResetModalOpen(false);
      setConfirmText("");

      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err: any) {
      console.error("Failed to reset database:", err);
      toast.error(err?.message || "ไม่สามารถรีเซ็ตฐานข้อมูลได้");
    } finally {
      setIsResetting(false);
    }
  };

  const handleSaveStore = async () => {
    try {
      const saved = await saveStoreSettingsToBackend(settings);
      setSettings(saved);
      toast.success("บันทึกข้อมูลร้านค้าและข้อความใบเสร็จลงฐานข้อมูลแล้ว");
    } catch (error) {
      toast.error('ยังบันทึกข้อมูลร้านไม่ได้ ข้อมูลที่กรอกยังอยู่ กรุณาลองใหม่: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleUpdateDrawerConfig = (update: Partial<CashDrawerConfig>) => {
    const updated = saveCashDrawerConfig(update);
    setDrawerConfig(updated);
    toast.success("บันทึกการตั้งค่าลิ้นชักเรียบร้อย");
  };

  const handleRefreshPrinters = async () => {
    if (typeof window !== "undefined" && (window as any).electronAPI?.getPrinters) {
      setLoadingPrinters(true);
      try {
        const printers = await (window as any).electronAPI.getPrinters();
        setInstalledPrinters(printers || []);
        toast.success(`ค้นพบเครื่องพิมพ์ใน Windows ทั้งหมด ${printers?.length || 0} รายการ`);
      } catch (e: any) {
        toast.error("ไม่สามารถค้นหาเครื่องพิมพ์ได้: " + (e?.message || ""));
      } finally {
        setLoadingPrinters(false);
      }
    }
  };

  const handleTestKick = async () => {
    setTestingKick(true);
    setLastKickResult(null);
    try {
      const res = await kickCashDrawer({
        reason: 'ทดสอบการเตะลิ้นชัก',
        printerName: drawerConfig.selectedPrinter,
        technique: drawerConfig.kickTechnique
      });
      const nowStr = new Date().toLocaleTimeString('th-TH');
      if (res.success) {
        toast.success(`⚡ สั่งเตะลิ้นชักสำเร็จ (${res.printer || 'เครื่องพิมพ์สลิป'})`);
        setLastKickResult({
          success: true,
          printer: res.printer,
          text: `ส่งสัญญาณสำเร็จไปยัง [${res.printer || 'Auto-detect'}]: ${res.output || 'OK'}`,
          time: nowStr
        });
      } else {
        toast.error(`❌ ไม่สามารถสั่งเปิดลิ้นชักได้: ${res.error || 'ตรวจสอบเครื่องพิมพ์'}`);
        setLastKickResult({
          success: false,
          printer: res.printer,
          text: `เกิดข้อผิดพลาด: ${res.error || 'ไม่สามารถส่งสัญญาณเตะลิ้นชักได้'}`,
          time: nowStr
        });
      }
    } catch (err: any) {
      toast.error(`เกิดข้อผิดพลาด: ${err?.message || ''}`);
    } finally {
      setTestingKick(false);
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
                    value={settings.storeName || ''}
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
                    value={settings.branchName || ''}
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
                    value={settings.taxId || ''}
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
                    value={settings.storePhone || ''}
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
                  value={settings.storeEmail || ''}
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
                  value={settings.storeAddress || ''}
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
                  value={settings.receiptHeader || ''}
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
                  value={settings.receiptFooter || ''}
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

          {/* Card 3: ตั้งค่าลิ้นชักเก็บเงิน & เครื่องพิมพ์ใบเสร็จ */}
          <Card className="bg-white border-slate-200 shadow-2xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center text-lg text-slate-900 font-bold">
                  <Coins className="w-5 h-5 mr-2.5 text-amber-500" />
                  ตั้งค่าเครื่องพิมพ์สลิป & ลิ้นชักเก็บเงิน (Printer & Cash Drawer)
                </CardTitle>
                {isDesktopApp ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-300 text-[11px] font-bold gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Desktop Native Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-slate-500 text-[11px]">
                    Web Browser Mode
                  </Badge>
                )}
              </div>
              <CardDescription className="text-slate-500 text-xs">
                กำหนดค่าเครื่องพิมพ์ EPSON TM-T82, การเลือกเครื่องพิมพ์ใน Windows, รูปแบบคำสั่งเตะเปิดลิ้นชัก, และระบบความปลอดภัย
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {/* Section A: Printer Selection (If running in Electron Desktop App) */}
              {isDesktopApp && (
                <div className="p-3.5 border border-sky-200 rounded-2xl bg-sky-50/50 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-sky-950 flex items-center gap-1.5">
                      <Printer className="w-4 h-4 text-sky-600" />
                      <span>เลือกเครื่องพิมพ์สลิปที่เชื่อมต่อกับลิ้นชัก (Target Printer)</span>
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleRefreshPrinters}
                      disabled={loadingPrinters}
                      className="h-7 px-2 text-[11px] text-sky-700 hover:bg-sky-100 rounded-lg gap-1"
                      title="ค้นหาเครื่องพิมพ์ใหม่อีกครั้ง"
                    >
                      <RefreshCcw className={`w-3 h-3 ${loadingPrinters ? 'animate-spin' : ''}`} />
                      <span>รีเฟรชรายชื่อ</span>
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    <select
                      value={drawerConfig.selectedPrinter || ''}
                      onChange={(e) => handleUpdateDrawerConfig({ selectedPrinter: e.target.value })}
                      className="flex-1 h-9 px-3 text-xs bg-white border border-sky-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer"
                    >
                      <option value="">-- ตรวจหาอัตโนมัติ (EPSON TM-T82 / Slip / Thermal Receipt) --</option>
                      {installedPrinters.map((p: any) => (
                        <option key={p.name} value={p.name}>
                          {p.name} {p.isDefault ? '⭐ (เครื่องเริ่มต้น Windows)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[11px] text-sky-700/80">
                    💡 หากต่อเครื่องพิมพ์ Epson TM-T82 ไว้ สามารถเลือกชื่อเครื่องพิมพ์โดยตรง หรือปล่อยให้ระบบตรวจหาอัตโนมัติได้
                  </p>
                </div>
              )}

              {/* Section B: Kick Technique & Automation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Left: Technique Selector */}
                <div className="p-3.5 border border-slate-200 rounded-2xl bg-slate-50/70 space-y-2.5">
                  <label className="text-xs font-bold text-slate-900 block">รูปแบบคำสั่งสั่งเตะลิ้นชัก</label>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer p-2 rounded-xl hover:bg-white transition-colors">
                      <input
                        type="radio"
                        name="kickTechnique"
                        checked={drawerConfig.kickTechnique === 'escpos' || !drawerConfig.kickTechnique}
                        onChange={() => handleUpdateDrawerConfig({ kickTechnique: 'escpos' })}
                        className="mt-0.5 text-sky-600"
                      />
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">1. สัญญาณ ESC/POS Raw Pulse (แนะนำสูงสุด: ไวมาก &lt; 0.1 วิ / ไม่ฟีดกระดาษ)</span>
                        <span className="text-[10.5px] text-slate-500 block leading-tight">
                          ส่งพัลส์ไฟฟ้าตรง Pin 2 &amp; Pin 5 ขนาด 100ms ปลดล็อคสลักทันทีโดยไม่เลื่อนกระดาษแม้แต่จุดเดียว
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 cursor-pointer p-2 rounded-xl hover:bg-white transition-colors">
                      <input
                        type="radio"
                        name="kickTechnique"
                        checked={drawerConfig.kickTechnique === 'auto'}
                        onChange={() => handleUpdateDrawerConfig({ kickTechnique: 'auto' })}
                        className="mt-0.5 text-sky-600"
                      />
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">2. โหมดผสม Auto</span>
                        <span className="text-[10.5px] text-slate-500 block leading-tight">
                          ส่ง ESC/POS Pulse ทันที หากไดรเวอร์ไม่ตอบสนองจะสลับไปใช้ Epson APD Font สำรอง
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 cursor-pointer p-2 rounded-xl hover:bg-white transition-colors">
                      <input
                        type="radio"
                        name="kickTechnique"
                        checked={drawerConfig.kickTechnique === 'epson_font'}
                        onChange={() => handleUpdateDrawerConfig({ kickTechnique: 'epson_font' })}
                        className="mt-0.5 text-sky-600"
                      />
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">3. ไดรเวอร์ Epson APD (Font Control: A)</span>
                        <span className="text-[10.5px] text-slate-500 block leading-tight">
                          ส่งผ่านฟอนต์ระบบของ Epson โดยตรง (ระบบเดียวกับโปรแกรม POSPOS)
                        </span>
                      </div>
                    </label>
                  </div>
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
                      disabled={testingKick}
                      className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-bold text-xs h-10 rounded-xl shadow-2xs gap-1.5 cursor-pointer transition-all active:scale-95"
                    >
                      <Coins className={`w-4 h-4 ${testingKick ? 'animate-spin' : ''}`} />
                      {testingKick ? 'กำลังส่งสัญญาณเตะลิ้นชัก...' : 'ทดสอบสั่งเตะลิ้นชักเก็บเงินเดี๋ยวนี้ (Test Kick)'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Section C: Live Test Result Banner */}
              {lastKickResult && (
                <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                  lastKickResult.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}>
                  {lastKickResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold">
                        {lastKickResult.success ? 'สั่งเตะลิ้นชักสำเร็จ' : 'สั่งเตะลิ้นชักไม่สำเร็จ'}
                      </span>
                      <span className="text-[10px] opacity-75 font-mono">{lastKickResult.time}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed">{lastKickResult.text}</p>
                  </div>
                </div>
              )}

              {/* Section D: Hardware Troubleshooting Checklist */}
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1.5">
                <p className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                  <span>🛠️ คำแนะนำตรวจสอบหากลิ้นชักยังไม่เด้งเปิด:</span>
                </p>
                <ul className="text-[11px] text-amber-900/90 space-y-1 pl-4 list-disc leading-relaxed">
                  <li>
                    <strong>ตำแหน่งลูกกุญแจลิ้นชัก:</strong> ต้องบิดให้อยู่ตำแหน่ง <u>แนวตั้ง (ตรงกลาง)</u> เท่านั้นจึงจะเปิดด้วยสัญญาณไฟฟ้าได้ (หากบิดไปซ้ายสุดจะเป็นการล็อคตาย ลิ้นชักจะไม่เปิดแม้จะมีคำสั่ง)
                  </li>
                  <li>
                    <strong>สายเคเบิลลิ้นชัก (DK Port):</strong> สาย RJ11/RJ12 ต้องเสียบแน่นที่พอร์ต <u>DK (Drawer Kick)</u> ด้านหลังเครื่องพิมพ์ Epson TM-T82
                  </li>
                  <li>
                    <strong>สวิตช์ & กระดาษ:</strong> เครื่องพิมพ์ต้องเปิดสวิตช์ มีม้วนกระดาษ และไฟ Power สีเขียวติดสว่างปกติ
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── RIGHT COLUMN: LIVE REAL-TIME RECEIPT SLIP PREVIEW (5 cols) ─── */}
        <div className="lg:col-span-5 lg:sticky lg:top-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-bold text-slate-900">ตัวอย่างสลิป EPSON TM-T82 (ความกว้างพอดีกระดาษ 80mm)</span>
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

      {/* ─── DANGER ZONE: SYSTEM & DATABASE RESET (Clean Light Theme with Rose Accent) ─── */}
      <BackupSection />

      <Card className="bg-white border border-rose-200 shadow-2xs rounded-2xl overflow-hidden mt-6">
        <CardHeader className="pb-3 border-b border-rose-100 bg-rose-50/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-700 border border-rose-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <CardTitle className="text-base font-bold text-rose-950 flex items-center gap-2">
                  <span>จัดการฐานข้อมูล & ล้างข้อมูลระบบ (System Data Reset)</span>
                  <Badge className="bg-rose-100 text-rose-800 border-rose-300 text-[10px] font-bold">
                    Admin Only
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  ล้างข้อมูลทั้งหมดในฐานข้อมูลและประวัติการขายในระบบ โดยจะคงเหลือไว้เฉพาะผู้ใช้งาน admin
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">
              ⚠️ รายการที่จะถูกล้างทั้งหมด:
            </p>
            <p className="text-slate-500">
              • ออเดอร์และประวัติการขายทั้งหมด • รายการสินค้า สต็อก และหมวดหมู่ • ข้อมูลลูกหนี้ เจ้าหนี้ และผู้จำหน่าย • ประวัติกะและเงินทอน • การเคลมสินค้า • บัญชีผู้ใช้อื่นๆ ทั้งหมด (คงเหลือเฉพาะ <span className="font-bold text-slate-800">user: admin</span>)
            </p>
          </div>

          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setConfirmText("");
              setIsResetModalOpen(true);
            }}
            className="bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold text-xs h-10 px-4 rounded-xl shadow-xs gap-2 shrink-0 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>ล้างข้อมูลทั้งหมดในระบบ (Reset Database)</span>
          </Button>
        </CardContent>
      </Card>

      {/* ─── RESET CONFIRMATION MODAL ─── */}
      <Dialog open={isResetModalOpen} onOpenChange={setIsResetModalOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-slate-200 p-6 rounded-2xl shadow-xl">
          <DialogHeader className="space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center mx-auto mb-1">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <DialogTitle className="text-center text-lg font-black text-slate-900">
              ยืนยันการล้างข้อมูลทั้งหมดในระบบ?
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-slate-600 leading-relaxed">
              การกระทำนี้จะ <strong className="text-rose-600 font-bold">ลบข้อมูลทั้งหมดในฐานข้อมูลอย่างถาวร</strong> (ออเดอร์, สินค้า, ลูกค้า, เจ้าหนี้, สต็อก, กะ ฯลฯ) และ <strong className="text-slate-900">ไม่สามารถกู้คืนได้</strong> โดยจะคงเหลือไว้เฉพาะผู้ใช้งาน <code className="bg-slate-100 text-indigo-700 px-1 py-0.5 rounded font-mono font-bold">admin</code>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3 border-y border-slate-100 my-2">
            <label className="text-xs font-bold text-slate-700 block">
              พิมพ์คำว่า <span className="text-rose-600 font-mono font-black">RESET</span> เพื่อยืนยัน:
            </label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="พิมพ์ RESET ตรงนี้..."
              className="text-center font-mono font-bold text-sm tracking-wider uppercase border-slate-300 focus-visible:ring-rose-500 h-10 rounded-xl"
              autoFocus
            />
          </div>

          <DialogFooter className="flex sm:justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsResetModalOpen(false)}
              disabled={isResetting}
              className="w-full sm:w-auto text-xs font-bold rounded-xl h-10 cursor-pointer"
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleResetAllData}
              disabled={confirmText.trim() !== "RESET" || isResetting}
              className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl h-10 gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isResetting ? (
                <>
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                  <span>กำลังล้างข้อมูล...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>ยืนยันล้างข้อมูลเดี๋ยวนี้</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
