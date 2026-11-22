"use client";

import { DocNameModeToggle } from '@/components/common/DocNameModeToggle';
import { OnlineShopSettings } from '@/components/settings/OnlineShopSettings';
import React, { useEffect, useState } from "react";
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
  Trash2, AlertTriangle, RefreshCcw, ShieldAlert, Package, Wallet, Users, Server, PackageX
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
import { SellingDeviceSetting } from "@/components/settings/SellingDeviceSetting";
import { useShiftStore } from "@/lib/store/shift-store";
import { useCartStore } from "@/lib/store/cart-store";
import { 
  getCashDrawerConfig, 
  saveCashDrawerConfig, 
  kickCashDrawer, 
  CashDrawerConfig 
} from "@/lib/cash-drawer-service";
import { 
  loadStoreSettingsFromBackend,
  saveStoreSettingsToBackend,
  StoreSettings, 
  DEFAULT_STORE_SETTINGS 
} from "@/lib/store-settings-storage";
import { LoadErrorState, errorMessage } from "@/components/common/LoadErrorState";
import { isValidQty, qtyInputMode, qtyStep } from "@/lib/qty";
import { ReceiptOptionsSection, ReceiptPreview, LayoutTabs, type ReceiptLayout } from "@/components/settings/ReceiptOptionsSection";
import { formatCurrency, formatListDateTime } from '@/lib/utils';
import { VersionDetails } from "@/components/common/VersionInfo";
import { clearLocalShopData } from '@/lib/local-data-reset';
import { clearCachedProducts } from '@/lib/offline-db';
import { canAccessRoute } from '@/lib/permissions';
import { settingsTabsFor, parseSettingsTab, type SettingsTab } from '@/lib/settings-tabs';

/** Printer reported by the desktop (Electron) app. */
type InstalledPrinter = { name: string; isDefault?: boolean };
/** The part of the desktop app's preload bridge used here. */
type ElectronBridge = { getPrinters?: () => Promise<InstalledPrinter[]> };
const electronBridge = (): ElectronBridge | undefined =>
  typeof window !== "undefined" ? (window as Window & { electronAPI?: ElectronBridge }).electronAPI : undefined;

function BackupSection() {
  const role = useAuthStore((s) => s.user?.role);
  const allowed = role === "ADMIN" || role === "MANAGER";
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  // shows the spinner from the start when the list is about to load
  const [loading, setLoading] = useState(allowed);
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [offsiteDir, setOffsiteDir] = useState("");
  const [savingOffsite, setSavingOffsite] = useState(false);

  /** Loads the backup list; state is only updated after the requests. */
  const fetchBackups = async () => {
    try {
      const [list, st] = await Promise.all([backupService.list(), backupService.status()]);
      setFiles(list);
      setStatus(st);
      setOffsiteDir(st?.offsiteDir || "");
    } catch (err) {
      toast.error(describeBackupError(err));
    } finally {
      setLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    await fetchBackups();
  };

  // once the role allows it (e.g. after sign-in restored), show the spinner right away
  const [seenAllowed, setSeenAllowed] = useState(allowed);
  if (seenAllowed !== allowed) {
    setSeenAllowed(allowed);
    if (allowed) setLoading(true);
  }

  useEffect(() => {
    if (!allowed) return;
    const run = async () => { await fetchBackups(); };
    void run();
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
    formatListDateTime(iso); // backups: several a day, the time is kept

  return (
    <Card className="bg-white border-slate-200 shadow-2xs">
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
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 space-y-2 text-xs">
          <div className="font-bold text-sky-900">สำรองไว้นอกเครื่อง (แนะนำ)</div>
          <p className="text-slate-600">
            ทุกครั้งที่สำรองข้อมูล ระบบจะคัดลอกไฟล์ไปไว้ที่โฟลเดอร์นี้ด้วย เช่น แฟลชไดรฟ์ ฮาร์ดดิสก์ลูกที่สอง หรือโฟลเดอร์ Google Drive / OneDrive
            ที่ซิงก์ขึ้นคลาวด์ (เก็บ 30 ไฟล์ล่าสุด) — ใส่ตำแหน่งบนเครื่องแม่ เช่น <span className="tabular-nums">D:\PurimBackup</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="flex-1 min-w-[240px] h-9 rounded-lg border border-slate-300 bg-white px-2 tabular-nums"
              value={offsiteDir}
              onChange={(e) => setOffsiteDir(e.target.value)}
              placeholder="เช่น E:\PurimBackup หรือ C:\Users\owner\Google Drive\PurimBackup"
              disabled={role !== "ADMIN"}
            />
            <Button
              size="sm"
              disabled={savingOffsite || role !== "ADMIN"}
              onClick={async () => {
                setSavingOffsite(true);
                try {
                  await backupService.setOffsiteDir(offsiteDir);
                  toast.success(offsiteDir ? "บันทึกโฟลเดอร์และทดสอบเขียนไฟล์ผ่าน" : "ปิดการสำรองนอกเครื่องแล้ว");
                  await load();
                } catch (err) {
                  toast.error((err as Error | undefined)?.message || "ใช้โฟลเดอร์นี้ไม่ได้");
                } finally {
                  setSavingOffsite(false);
                }
              }}
            >
              {savingOffsite ? "กำลังทดสอบ..." : "บันทึกและทดสอบ"}
            </Button>
          </div>
          <div className={status?.lastOffsiteOk === false ? "text-rose-600 font-bold" : "text-slate-600"}>
            {status?.offsiteDir
              ? status.lastOffsiteOk === false
                ? `คัดลอกครั้งล่าสุดล้มเหลว: ${status.lastOffsiteError}`
                : `คัดลอกไปนอกเครื่องล่าสุด: ${fmt(status.lastOffsiteAt)}`
              : "⚠️ ยังไม่ได้ตั้งโฟลเดอร์ ถ้าฮาร์ดดิสก์เครื่องแม่เสีย ไฟล์สำรองจะหายไปด้วย"}
          </div>
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
                <div className="tabular-nums font-bold text-slate-800 truncate">{f.fileName}</div>
                <div className="text-slate-500">{fmt(f.createdAt)} • {formatBytes(f.sizeBytes)}</div>
              </div>
              {role === "ADMIN" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => backupService.download(f.fileName).catch((err) => toast.error(err?.message || "ดาวน์โหลดไม่สำเร็จ"))}
                  title="ดาวน์โหลดไฟล์มาเก็บที่เครื่องนี้"
                >
                  ดาวน์โหลด
                </Button>
              )}
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

/** Words typed to confirm the irreversible operations of ระบบ (ตั้งค่า > ระบบ). */
const CLEAR_PRODUCTS_WORD = "ลบสินค้าทั้งหมด";
const RESET_WORD = "RESET";

/** Save button of a settings tab (every tab saves the same store settings record). */
function SaveBar({ onSave, label = "บันทึกการตั้งค่า" }: { onSave: () => void; label?: string }) {
  return (
    <div className="pt-2 flex justify-end">
      <Button
        type="button"
        onClick={onSave}
        className="bg-sky-600 hover:bg-sky-700 text-white gap-2 cursor-pointer"
      >
        <Save className="w-4 h-4" /> {label}
      </Button>
    </div>
  );
}

/** A card that only links to another page (settings that live on their own page). */
function LinkCard({ href, icon: Icon, title, text, button }: { href: string; icon: React.ElementType; title: string; text: string; button: string }) {
  return (
    <Card className="bg-white border-slate-200 shadow-2xs">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-4 px-5">
        <div>
          <CardTitle className="flex items-center text-base text-slate-900 font-bold">
            <Icon className="w-5 h-5 mr-2.5 text-sky-600" /> {title}
          </CardTitle>
          <CardDescription className="text-slate-500 text-xs mt-0.5">{text}</CardDescription>
        </div>
        <Link href={href}>
          <Button variant="outline" className="shrink-0 sm:text-sm">
            {button} <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </Link>
      </CardHeader>
    </Card>
  );
}

function SectionCard({ icon: Icon, title, text, children, className = "" }: { icon: React.ElementType; title: string; text?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`bg-white border-slate-200 shadow-2xs ${className}`}>
      <CardHeader className="pb-3 border-b border-slate-100">
        <CardTitle className="flex items-center text-lg text-slate-900 font-bold">
          <Icon className="w-5 h-5 mr-2.5 text-sky-600" /> {title}
        </CardTitle>
        {text && <CardDescription className="text-slate-500 text-xs">{text}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4 pt-4">{children}</CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [loading, setLoading] = useState(true);
  // which receipt layout the options card edits and the preview shows
  const [receiptLayout, setReceiptLayout] = useState<ReceiptLayout>("slip");
  const [storeLoadError, setStoreLoadError] = useState<string | null>(null);
  const [drawerConfig, setDrawerConfig] = useState<CashDrawerConfig>(getCashDrawerConfig());

  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "ADMIN";
  // which group of settings is shown (?tab= in the address, so a link can open one directly)
  const [tab, setTab] = useState<SettingsTab>("store");
  const tabs = settingsTabsFor(user?.role);
  const activeTab: SettingsTab = tabs.some((t) => t.id === tab) ? tab : "store";
  const selectTab = (next: SettingsTab) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch { /* address bar not updated: the tab still changes */ }
  };

  // ระบบ > ลบสินค้าทั้งหมด
  const [isClearProductsOpen, setIsClearProductsOpen] = useState(false);
  const [clearProductsText, setClearProductsText] = useState("");
  const [isClearingProducts, setIsClearingProducts] = useState(false);

  // Reset database state
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  // Hardware / Printer detection state
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [installedPrinters, setInstalledPrinters] = useState<InstalledPrinter[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [testingKick, setTestingKick] = useState(false);
  const [lastKickResult, setLastKickResult] = useState<{
    success: boolean;
    text: string;
    printer?: string;
    time: string;
  } | null>(null);


  const reloadStoreSettings = async (alive: () => boolean = () => true) => {
    try {
      const loaded = await loadStoreSettingsFromBackend();
      if (!alive()) return;
      setSettings(loaded);
      setStoreLoadError(null);
    } catch (err) {
      if (alive()) setStoreLoadError(errorMessage(err, "ติดต่อเซิร์ฟเวอร์ไม่ได้"));
    }
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => { await reloadStoreSettings(() => mounted); };
    void run();
    // the tab asked for in the address (?tab=stock ...), read once after hydration
    const askedTab = parseSettingsTab(new URLSearchParams(window.location.search).get("tab"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the address after hydration
    if (askedTab) setTab(askedTab);
    // Browser-only values (drawer config in localStorage, the Electron bridge) exist only after hydration.
    setDrawerConfig(getCashDrawerConfig());

    // Check if running inside Electron desktop app and fetch Windows printers
    const bridge = electronBridge();
    if (bridge) {
      setIsDesktopApp(true);
      if (bridge.getPrinters) {
        setLoadingPrinters(true);
        bridge.getPrinters().then((printers) => {
          if (mounted) {
            setInstalledPrinters(printers || []);
          }
        }).catch((e: unknown) => {
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
    if (confirmText.trim() !== RESET_WORD) {
      toast.error(`กรุณาพิมพ์คำว่า ${RESET_WORD} เพื่อยืนยัน`);
      return;
    }

    setIsResetting(true);
    try {
      await api.settings.resetDatabase();

      // Forget every piece of shop data cached on this device (cart, held bills, offline queues...)
      await clearLocalShopData();

      // Reset stores
      await useProductStore.getState().refreshIfLoaded();
      useShiftStore.setState({ currentShift: null, cashTransactions: [] });
      useCartStore.setState({ items: [], heldBills: [] });
      useCartStore.getState().clearCart();

      toast.success("✅ ล้างข้อมูลทั้งหมดเรียบร้อยแล้ว (รวมยอดเงิน) คงเหลือเฉพาะผู้ใช้งาน admin และการตั้งค่าร้าน — เครื่องลูกอื่นให้กด F5 หรือเปิดโปรแกรมใหม่");
      setIsResetModalOpen(false);
      setConfirmText("");

      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      console.error("Failed to reset database:", err);
      toast.error((err as Error | undefined)?.message || "ไม่สามารถรีเซ็ตฐานข้อมูลได้");
    } finally {
      setIsResetting(false);
    }
  };

  const handleClearAllProducts = async () => {
    if (clearProductsText.trim() !== CLEAR_PRODUCTS_WORD) {
      toast.error(`กรุณาพิมพ์คำว่า ${CLEAR_PRODUCTS_WORD} เพื่อยืนยัน`);
      return;
    }
    setIsClearingProducts(true);
    try {
      const result = await api.products.deleteAll();
      const count = Number(result?.deleted || 0);
      // the only local product data is the POS offline cache
      await clearCachedProducts();
      useProductStore.setState({ products: [] });
      toast.success(
        `ลบสินค้าทั้งหมดเรียบร้อย${count > 0 ? ` ${count} รายการ` : ""}${result?.backupFile ? ` — สำรองข้อมูลก่อนลบไว้ที่ ${result.backupFile}` : ""}`,
      );
      setIsClearProductsOpen(false);
      setClearProductsText("");
    } catch (err) {
      // the server still has the products: change nothing here
      toast.error("ลบสินค้าทั้งหมดไม่สำเร็จ: " + ((err as Error | undefined)?.message || "ติดต่อเซิร์ฟเวอร์ไม่ได้"));
    } finally {
      setIsClearingProducts(false);
    }
  };

  // Store-wide operational limits stored on StoreSettings (not part of the receipt-header type)
  const opSettings = settings as StoreSettings & { lowStockThreshold?: number | string | null; cashMovementApprovalLimit?: number | string | null };
  const lowStockInput = opSettings.lowStockThreshold ?? 5;
  const cashLimitInput = opSettings.cashMovementApprovalLimit ?? 1000;
  const storeFieldErrors = (() => {
    const errors: { storeName?: string; lowStockThreshold?: string; cashMovementApprovalLimit?: string } = {};
    if (!String(settings.storeName ?? '').trim()) errors.storeName = 'กรุณาระบุชื่อร้านค้า (จะพิมพ์บนหัวใบเสร็จ)';
    const lowStr = String(lowStockInput).trim();
    const low = Number(lowStr);
    if (lowStr === '' || !isValidQty(low, { allowDecimal: settings.allowDecimalQty === true, min: 'nonneg', max: 100000 })) {
      errors.lowStockThreshold = settings.allowDecimalQty ? 'ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป (ทศนิยมไม่เกิน 2 ตำแหน่ง)' : 'ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
    }
    const limStr = String(cashLimitInput).trim();
    const lim = Number(limStr);
    if (limStr === '' || !Number.isFinite(lim) || lim < 0) errors.cashMovementApprovalLimit = 'ต้องเป็นจำนวนเงินตั้งแต่ 0 ขึ้นไป';
    return errors;
  })();

  const handleSaveStore = async () => {
    const firstError = storeFieldErrors.storeName || storeFieldErrors.lowStockThreshold || storeFieldErrors.cashMovementApprovalLimit;
    if (firstError) {
      toast.error('ยังบันทึกไม่ได้: ' + firstError);
      return;
    }
    if (storeLoadError) {
      // never overwrite the server's settings with values it has not confirmed
      toast.error('ยังบันทึกไม่ได้: โหลดข้อมูลร้านจากเซิร์ฟเวอร์ไม่สำเร็จ กรุณากด "ลองใหม่" ก่อน');
      return;
    }
    try {
      const saved = await saveStoreSettingsToBackend({
        ...settings,
        storeName: settings.storeName.trim(),
        lowStockThreshold: Number(lowStockInput),
        cashMovementApprovalLimit: Number(cashLimitInput),
      } as StoreSettings);
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
    const bridge = electronBridge();
    if (bridge?.getPrinters) {
      setLoadingPrinters(true);
      try {
        const printers = await bridge.getPrinters();
        setInstalledPrinters(printers || []);
        toast.success(`ค้นพบเครื่องพิมพ์ใน Windows ทั้งหมด ${printers?.length || 0} รายการ`);
      } catch (e) {
        toast.error("ไม่สามารถค้นหาเครื่องพิมพ์ได้: " + ((e as Error | undefined)?.message || ""));
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
    } catch (err) {
      toast.error(`เกิดข้อผิดพลาด: ${(err as Error | undefined)?.message || ''}`);
    } finally {
      setTestingKick(false);
    }
  };


  if (loading) return <div className="p-4 text-slate-500 sm:p-6 lg:p-8">Loading...</div>;
  return (
    <div className="page-shell">
      <div>
        <h1 className="page-title">
          <Settings className="w-6 h-6 text-sky-500" /> ตั้งค่าร้าน
        </h1>
        <p className="page-subtitle">
          แยกเป็นหมวด เลือกหมวดด้านล่าง — ค่าแต่ละอย่างอยู่ที่เดียว
        </p>
      </div>

      {storeLoadError && (
        <LoadErrorState message={storeLoadError} onRetry={() => void reloadStoreSettings()} />
      )}

      {/* groups of settings */}
      <div role="tablist" aria-label="หมวดการตั้งค่า" className="flex flex-wrap gap-btn pb-1 border-b border-slate-200">
        {tabs.map((t) => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`settings-tab-${t.id}`}
              onClick={() => selectTab(t.id)}
              className={`shrink-0 px-3.5 py-2 rounded-t-xl text-sm font-bold border-b-2 transition-colors cursor-pointer ${
                active
                  ? t.id === "system" ? "border-rose-600 text-rose-700 bg-rose-50" : "border-sky-600 text-sky-800 bg-sky-50"
                  : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ─── ข้อมูลร้าน ─── */}
      {activeTab === "store" && (
        <div className="max-w-4xl" role="tabpanel">
          <SectionCard icon={Store} title="ข้อมูลร้านค้า & นิติบุคคล" text="แสดงบนใบเสร็จ ใบกำกับภาษี และเอกสารการเคลมสินค้า">
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
                    required
                    aria-invalid={!!storeFieldErrors.storeName}
                    className={`bg-white text-slate-900 ${storeFieldErrors.storeName ? 'border-rose-400' : 'border-slate-300'}`}
                  />
                  {storeFieldErrors.storeName && (
                    <p role="alert" className="text-[11px] font-bold text-rose-600">{storeFieldErrors.storeName}</p>
                  )}
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
                    className="bg-white border-slate-300 text-slate-900"
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
                    className="bg-white border-slate-300 tabular-nums text-slate-900"
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
                    className="bg-white border-slate-300 tabular-nums text-slate-900"
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
            <SaveBar onSave={() => void handleSaveStore()} label="บันทึกข้อมูลร้าน" />
          </SectionCard>
        </div>
      )}

      {/* ─── การขายและใบเสร็จ ─── */}
      {activeTab === "sales" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start" role="tabpanel">
          <div className="lg:col-span-7 space-y-5">
            <SectionCard icon={Coins} title="การขาย" text="ภาษีขายและการขายเป็นจำนวนทศนิยม ใช้กับทุกเครื่อง">
              {/* VAT on sales (store-wide). Purchases are separate and not affected. */}
              <div className={`rounded-xl border p-3.5 space-y-2.5 ${settings.vatEnabled ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.vatEnabled === true}
                    onChange={(e) => setSettings({ ...settings, vatEnabled: e.target.checked })}
                    className="mt-0.5 w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-semibold text-slate-900">ร้านคิดภาษีมูลค่าเพิ่ม (VAT) จากการขาย</span>
                    <span className="block text-xs text-slate-600 leading-relaxed">
                      {settings.vatEnabled
                        ? `เปิดอยู่: ราคาขายถือว่ารวม VAT ${settings.vatRate}% แล้ว ระบบถอดยอด VAT แสดงในบิล ใบเสร็จ และรายงานภาษีขาย`
                        : 'ปิดอยู่: ไม่คิด VAT — หน้าขาย บิล และใบเสร็จจะไม่แสดงส่วนภาษีเลย (เหมาะกับร้านที่ไม่ได้จดทะเบียน VAT)'}
                    </span>
                  </span>
                </label>
                {settings.vatEnabled && (
                  <div className="flex items-center gap-2 pl-8">
                    <span className="text-xs font-bold text-slate-700">อัตรา VAT</span>
                    <Input
                      type="number"
                      min={0}
                      max={30}
                      step={0.01}
                      value={settings.vatRate}
                      onChange={(e) => setSettings({ ...settings, vatRate: Number(e.target.value) })}
                      className="w-24 h-8 bg-white border-slate-300 tabular-nums"
                    />
                    <span className="text-xs font-bold text-slate-700">%</span>
                  </div>
                )}
                <p className="text-[11px] text-slate-500 pl-8">มีผลกับบิลขายใหม่ทุกเครื่องทันทีหลังกดบันทึก (บิลเก่าไม่เปลี่ยน) · ภาษีฝั่งซื้อแยกตามบิลซื้อ ไม่เกี่ยวกับตัวเลือกนี้</p>
              </div>
              {/* Decimal quantities (store-wide): sell by metre / kg / cubic metre */}
              <div className={`rounded-xl border p-3.5 space-y-1.5 ${settings.allowDecimalQty ? 'border-sky-300 bg-sky-50/60' : 'border-slate-200 bg-slate-50'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="allow-decimal-qty"
                    checked={settings.allowDecimalQty === true}
                    onChange={(e) => setSettings({ ...settings, allowDecimalQty: e.target.checked })}
                    className="mt-0.5 w-5 h-5 rounded text-sky-600 focus:ring-sky-500"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-semibold text-slate-900">อนุญาตจำนวนทศนิยม (สูงสุด 2 ตำแหน่ง) เช่น ขายเป็นเมตร / กิโล</span>
                    <span className="block text-xs text-slate-600 leading-relaxed">
                      {settings.allowDecimalQty
                        ? 'เปิดอยู่: ใส่จำนวนได้ เช่น 1.5 เมตร, 2.25 กก., 0.5 คิว ทั้งหน้าขาย ใบสั่งซื้อ ปรับสต็อก คืนสินค้า เคลม และนำเข้าสินค้า'
                        : 'ปิดอยู่: จำนวนเป็นจำนวนเต็มเท่านั้น (ระบบปฏิเสธจำนวนที่มีทศนิยม)'}
                    </span>
                  </span>
                </label>
                <p className="text-[11px] text-slate-500 pl-8">มีผลกับทุกเครื่องหลังกดบันทึก · รายการเดิมที่มีทศนิยมยังคงอยู่แม้จะปิดภายหลัง</p>
              </div>
              <SaveBar onSave={() => void handleSaveStore()} />
            </SectionCard>
            {/* what slips / A4 documents show: next to the live preview */}
            <ReceiptOptionsSection
              settings={settings}
              onChange={setSettings}
              layout={receiptLayout}
              onLayoutChange={setReceiptLayout}
              disabled={!!storeLoadError}
            />
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
                  <span className="text-[11px] text-slate-400 tabular-nums">แสดงใต้ชื่อร้าน</span>
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
                  <span className="text-[11px] text-slate-400 tabular-nums">แสดงล่างสุดของสลิป</span>
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
              <SaveBar onSave={() => void handleSaveStore()} label="บันทึกข้อความใบเสร็จ" />
            </CardContent>
          </Card>
          </div>

          {/* ─── LIVE RECEIPT PREVIEW ─── */}
        <div className="lg:col-span-5 lg:sticky lg:top-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-bold text-slate-900">
                {receiptLayout === "slip" ? "ตัวอย่างสลิป (ความกว้างพอดีกระดาษ 80mm)" : "ตัวอย่างใบเสร็จ A4 (ย่อ 50%)"}
              </span>
            </div>
            <LayoutTabs value={receiptLayout} onChange={setReceiptLayout} />
          </div>

          <div className="bg-slate-200/70 p-4 sm:p-5 rounded-2xl border border-slate-300 flex justify-center shadow-inner overflow-x-auto">
            {/* The EXACT SAME components that print (80 mm slip / A4 receipt) */}
            <ReceiptPreview settings={settings} layout={receiptLayout} />
          </div>

          <p className="text-[11px] text-center text-slate-500 font-sans">
            ตัวอย่างนี้ใช้แม่แบบเดียวกับที่พิมพ์จริง เปลี่ยนตัวเลือกแล้วเห็นผลทันที (กดบันทึกเพื่อใช้กับทุกเครื่อง)
          </p>
        </div>
        </div>
      )}

      {/* ─── สินค้าและสต็อก ─── */}
      {activeTab === "stock" && (
        <div className="max-w-4xl space-y-4" role="tabpanel">
          <SectionCard icon={Package} title="สินค้าและสต็อก" text="ใช้กับหน้าสินค้า คลังสินค้า แดชบอร์ด มือถือ และรายงาน">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="low-stock-threshold" className="text-xs font-bold text-slate-700">
                    เกณฑ์สินค้าใกล้หมด (ชิ้น)
                  </label>
                  <Input
                    id="low-stock-threshold"
                    type="number"
                    min={0}
                    step={qtyStep(settings.allowDecimalQty === true)}
                    inputMode={qtyInputMode(settings.allowDecimalQty === true)}
                    value={String(lowStockInput)}
                    onChange={e => setSettings({ ...settings, lowStockThreshold: e.target.value } as unknown as StoreSettings)}
                    aria-invalid={!!storeFieldErrors.lowStockThreshold}
                    className={`bg-white tabular-nums text-slate-900 ${storeFieldErrors.lowStockThreshold ? 'border-rose-400' : 'border-slate-300'}`}
                  />
                  {storeFieldErrors.lowStockThreshold
                    ? <p role="alert" className="text-[11px] font-bold text-rose-600">{storeFieldErrors.lowStockThreshold}</p>
                    : <p className="text-[11px] text-slate-500">สินค้าที่คงเหลือเท่านี้หรือน้อยกว่าจะถือว่าใกล้หมด ใช้ทุกหน้าและรายงาน</p>}
                </div>
            </div>
            {/* product names on supplier documents (docs/product-names.md) */}
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2" data-testid="supplier-doc-name-setting">
              <DocNameModeToggle
                label="ชื่อสินค้าบนเอกสารถึงผู้ขาย (ค่าเริ่มต้น)"
                value={settings.supplierDocNameMode === 'SUPPLIER' ? 'SUPPLIER' : 'SHOP'}
                onChange={(mode) => setSettings({ ...settings, supplierDocNameMode: mode })}
              />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                ใช้กับใบสั่งซื้อ (หน้าจอ + PDF) หน้ารับสินค้า และใบส่งคืนสินค้า / ใบลดหนี้ผู้ขายที่สร้างใหม่ เปลี่ยนรายใบได้ และเก็บไว้กับเอกสาร (พิมพ์ซ้ำได้ชื่อเดิม)
                <br />
                ใช้ชื่อผู้ผลิต = ชื่อ/รหัสสินค้าของผู้ขายรายนั้น → ถ้าไม่มีใช้ชื่อผู้ผลิต → ถ้าไม่มีใช้ชื่อร้าน · ใบเสร็จ ร้านออนไลน์ และรายงานใช้ชื่อร้านเสมอ
              </p>
            </div>
            <SaveBar onSave={() => void handleSaveStore()} />
          </SectionCard>
          {canAccessRoute(user, "/categories") && (
            <LinkCard href="/categories" icon={Package} title="หมวดหมู่สินค้า" text="เพิ่ม / แก้ไขหมวดหมู่ที่ใช้จัดกลุ่มสินค้า" button="เปิดหน้าหมวดหมู่" />
          )}
        </div>
      )}

      {/* ─── การเงิน ─── */}
      {activeTab === "finance" && (
        <div className="max-w-4xl space-y-4" role="tabpanel">
          <SectionCard icon={Wallet} title="เงินในลิ้นชัก" text="การนำเงินเข้า / ออกลิ้นชักที่หน้าขาย">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="cash-movement-approval-limit" className="text-xs font-bold text-slate-700">
                    วงเงินนำเงินเข้า/ออกลิ้นชักที่ต้องให้ผู้จัดการอนุมัติ (0 = ทุกครั้ง)
                  </label>
                  <Input
                    id="cash-movement-approval-limit"
                    type="number"
                    min={0}
                    step={0.01}
                    inputMode="decimal"
                    value={String(cashLimitInput)}
                    onChange={e => setSettings({ ...settings, cashMovementApprovalLimit: e.target.value } as unknown as StoreSettings)}
                    aria-invalid={!!storeFieldErrors.cashMovementApprovalLimit}
                    className={`bg-white tabular-nums text-slate-900 ${storeFieldErrors.cashMovementApprovalLimit ? 'border-rose-400' : 'border-slate-300'}`}
                  />
                  {storeFieldErrors.cashMovementApprovalLimit
                    ? <p role="alert" className="text-[11px] font-bold text-rose-600">{storeFieldErrors.cashMovementApprovalLimit}</p>
                    : <p className="text-[11px] text-slate-500">นำเงินเข้า/ออกเกินยอดนี้ (บาท) ต้องใช้ PIN ผู้จัดการ</p>}
                </div>
            </div>
            <SaveBar onSave={() => void handleSaveStore()} />
          </SectionCard>
          {canAccessRoute(user, "/accounts") && (
            <LinkCard href="/accounts" icon={Building2} title="บัญชีธนาคาร & รูป QR Code" text="เพิ่ม / แก้ไขบัญชีธนาคารและรูป QR สำหรับรับโอน" button="เปิดหน้าบัญชีธนาคาร" />
          )}
        </div>
      )}

      {/* ─── เครื่องพิมพ์และลิ้นชัก (this device) ─── */}
      {activeTab === "devices" && (
        <div className="max-w-5xl" role="tabpanel">
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
                      className="text-sky-700 hover:bg-sky-100 gap-1"
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
                      {installedPrinters.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name} {p.isDefault ? '⭐ (เครื่องเริ่มต้น Windows)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="text-xs font-bold text-slate-900 block pt-1">เครื่องพิมพ์เอกสาร A4 (ใบกำกับภาษี / ใบสั่งซื้อ)</label>
                  <div className="flex gap-2">
                    <select
                      value={drawerConfig.selectedA4Printer || ''}
                      onChange={(e) => handleUpdateDrawerConfig({ selectedA4Printer: e.target.value })}
                      className="flex-1 h-9 px-3 text-xs bg-white border border-sky-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer"
                    >
                      <option value="">-- ไม่ระบุ (แสดงหน้าต่างเลือกเครื่องพิมพ์ของ Windows) --</option>
                      {installedPrinters.map((p) => (
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
                      className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white gap-1.5 cursor-pointer transition-all active:scale-95"
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
                      <span className="text-[10px] opacity-75 tabular-nums">{lastKickResult.time}</span>
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
          <SellingDeviceSetting />
        </div>
      )}

      {/* ─── ผู้ใช้และสิทธิ์ ─── */}
      {activeTab === "users" && (
        <div className="max-w-4xl space-y-4" role="tabpanel">
          {canAccessRoute(user, "/users") && (
            <LinkCard href="/users" icon={Users} title="พนักงาน & สิทธิ์" text="เพิ่มพนักงาน กำหนดตำแหน่ง สิทธิ์การใช้งาน และรหัส PIN" button="เปิดหน้าพนักงาน" />
          )}
          {canAccessRoute(user, "/approvals") && (
            <LinkCard href="/approvals" icon={ShieldCheck} title="การอนุมัติด้วย PIN ผู้จัดการ" text="ประวัติและคำขออนุมัติ (ส่วนลด / ขายต่ำกว่าทุน / เงินเข้าออกลิ้นชัก)" button="เปิดหน้าการอนุมัติ" />
          )}
          {!canAccessRoute(user, "/users") && !canAccessRoute(user, "/approvals") && (
            <p className="text-sm text-slate-500">บัญชีนี้ไม่มีสิทธิ์จัดการพนักงานหรือการอนุมัติ</p>
          )}
        </div>
      )}

      {/* ─── ร้านออนไลน์ (ADMIN): LINE / LIFF settings; the Messaging API token never comes back from the server ─── */}
      {activeTab === "online" && <OnlineShopSettings />}

      {/* ─── ระบบ (ADMIN + MANAGER): version, backups; the irreversible operations: ADMIN only ─── */}
      {activeTab === "system" && (
        <div className="max-w-5xl space-y-5" role="tabpanel">
          <Card className="bg-white border-slate-200 shadow-2xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="flex items-center text-lg text-slate-900 font-bold">
                <Server className="w-5 h-5 mr-2.5 text-sky-600" /> เวอร์ชันระบบ
              </CardTitle>
              <CardDescription className="text-slate-500 text-xs">รุ่นที่กำลังใช้งานจริง และตรวจว่าหลังอัปเดต ได้ build และเปิดเซิร์ฟเวอร์ใหม่แล้วหรือยัง</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <VersionDetails />
            </CardContent>
          </Card>

          <BackupSection />

          {/* DANGER ZONE: kept apart from everything else, each action needs a typed word; ADMIN only (same as the API) */}
          {isAdmin && (
          <section data-testid="danger-zone" className="rounded-2xl border-2 border-rose-300 bg-rose-50/40 p-4 sm:p-5 space-y-4 mt-8">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 border border-rose-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-rose-950 flex items-center gap-2">
                  พื้นที่อันตราย — ลบข้อมูลถาวร
                  <Badge className="bg-rose-100 text-rose-800 border-rose-300 text-[10px] font-bold">เฉพาะ Admin</Badge>
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  ใช้เฉพาะตอนเริ่มระบบใหม่หรือนำเข้าข้อมูลใหม่ทั้งหมด กู้คืนไม่ได้ ควรกด &quot;สำรองข้อมูลตอนนี้&quot; ด้านบนก่อนทุกครั้ง
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-rose-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-600 space-y-0.5">
                <p className="text-sm font-bold text-slate-900">ลบสินค้าทั้งหมด</p>
                <p>ลบรายการสินค้า ราคา บาร์โค้ด ขนาดบรรจุ รูปสินค้า และ cache สินค้าในเครื่อง — ใช้ก่อนนำเข้าสินค้าใหม่ทั้งหมด (สินค้าที่มีบิลขายแล้วลบไม่ได้) — ระบบสำรองข้อมูลให้ก่อนลบเสมอ</p>
              </div>
              <Button
                type="button"
                variant="outline"
                data-testid="open-clear-products"
                onClick={() => {
                  setClearProductsText("");
                  setIsClearProductsOpen(true);
                }}
                className="border-rose-300 text-rose-700 hover:bg-rose-50 gap-2 shrink-0 cursor-pointer"
              >
                <PackageX className="w-4 h-4" /> ลบสินค้าทั้งหมด...
              </Button>
            </div>

            <div className="rounded-xl border border-rose-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-600 space-y-0.5">
                <p className="text-sm font-bold text-slate-900">ล้างข้อมูลทั้งหมดในระบบ</p>
                <p>
                  ลบออเดอร์ ประวัติการขาย สินค้า สต็อก หมวดหมู่ ลูกหนี้ เจ้าหนี้ ผู้จำหน่าย กะ ยอดเงินสด/ธนาคาร การเคลม และบัญชีผู้ใช้อื่น
                  (คงไว้เฉพาะ <span className="font-bold text-slate-800">admin</span> และการตั้งค่าร้าน) — ระบบสำรองข้อมูลให้ก่อนล้างเสมอ
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                data-testid="open-reset-database"
                onClick={() => {
                  setConfirmText("");
                  setIsResetModalOpen(true);
                }}
                className="border-rose-300 text-rose-700 hover:bg-rose-50 gap-2 shrink-0 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" /> ล้างข้อมูลทั้งหมด...
              </Button>
            </div>
          </section>
          )}

          {/* ─── DELETE ALL PRODUCTS CONFIRMATION ─── */}
          <Dialog open={isClearProductsOpen} onOpenChange={(o) => { if (!isClearingProducts) setIsClearProductsOpen(o); }}>
            <DialogContent className="sm:max-w-md bg-white border border-slate-200 p-6 rounded-2xl shadow-xl">
              <DialogHeader className="space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center mx-auto mb-1">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <DialogTitle className="text-center text-lg font-semibold text-slate-900">ยืนยันการลบสินค้าทั้งหมด?</DialogTitle>
                <DialogDescription className="text-center text-xs text-slate-600 leading-relaxed">
                  สินค้า ราคา บาร์โค้ด ขนาดบรรจุ และรูปสินค้า <strong className="text-rose-600 font-bold">จะถูกลบถาวร</strong> — ระบบจะสำรองข้อมูลให้ก่อนลบทุกครั้ง (กู้คืนได้จากไฟล์สำรองนั้นเท่านั้น) ถ้าสำรองไม่สำเร็จจะไม่ลบอะไรเลย
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-3 border-y border-slate-100 my-2">
                <label className="text-xs font-bold text-slate-700 block">
                  พิมพ์คำว่า <span className="text-rose-600 font-semibold">{CLEAR_PRODUCTS_WORD}</span> เพื่อยืนยัน:
                </label>
                <Input
                  data-testid="clear-products-confirm-input"
                  value={clearProductsText}
                  onChange={(e) => setClearProductsText(e.target.value)}
                  placeholder={CLEAR_PRODUCTS_WORD}
                  className="text-center border-slate-300 focus-visible:ring-rose-500"
                  autoFocus
                />
              </div>
              <DialogFooter className="flex sm:justify-between gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsClearProductsOpen(false)} disabled={isClearingProducts} className="w-full sm:w-auto cursor-pointer">
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleClearAllProducts()}
                  disabled={clearProductsText.trim() !== CLEAR_PRODUCTS_WORD || isClearingProducts}
                  className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isClearingProducts ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <PackageX className="w-4 h-4" />}
                  {isClearingProducts ? "กำลังลบ..." : "ยืนยันลบสินค้าทั้งหมด"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

      {/* ─── RESET CONFIRMATION MODAL ─── */}
      <Dialog open={isResetModalOpen} onOpenChange={setIsResetModalOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-slate-200 p-6 rounded-2xl shadow-xl">
          <DialogHeader className="space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center mx-auto mb-1">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <DialogTitle className="text-center text-lg font-semibold text-slate-900">
              ยืนยันการล้างข้อมูลทั้งหมดในระบบ?
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-slate-600 leading-relaxed">
              การกระทำนี้จะ <strong className="text-rose-600 font-bold">ลบข้อมูลทั้งหมดในฐานข้อมูลอย่างถาวร</strong> (ออเดอร์, สินค้า, ลูกค้า, เจ้าหนี้, สต็อก, กะ, ยอดเงินสด/ธนาคาร, ค่าใช้จ่าย, การคืนสินค้า ฯลฯ) และ <strong className="text-slate-900">ไม่สามารถกู้คืนได้</strong> โดยจะคงเหลือไว้เฉพาะผู้ใช้งาน <code className="bg-slate-100 text-indigo-700 px-1 py-0.5 rounded tabular-nums font-bold">admin</code> และการตั้งค่าร้าน — ระบบจะสำรองข้อมูลให้ก่อนล้างทุกครั้ง ถ้าสำรองไม่สำเร็จจะไม่ลบอะไรเลย
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3 border-y border-slate-100 my-2">
            <label className="text-xs font-bold text-slate-700 block">
              พิมพ์คำว่า <span className="text-rose-600 tabular-nums font-semibold">RESET</span> เพื่อยืนยัน:
            </label>
            <Input
              data-testid="reset-confirm-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="พิมพ์ RESET ตรงนี้..."
              className="text-center tabular-nums   border-slate-300 focus-visible:ring-rose-500"
              autoFocus
            />
          </div>

          <DialogFooter className="flex sm:justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsResetModalOpen(false)}
              disabled={isResetting}
              className="w-full sm:w-auto cursor-pointer"
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleResetAllData}
              disabled={confirmText.trim() !== RESET_WORD || isResetting}
              className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white gap-1.5 cursor-pointer disabled:opacity-50"
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
      )}
    </div>
  );
}
