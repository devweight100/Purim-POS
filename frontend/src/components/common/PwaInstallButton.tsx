'use client';

import React, { useState, useEffect, useSyncExternalStore } from 'react';
import { Download, Monitor, CheckCircle2, Laptop, Info, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Running as an installed app (standalone window; iOS sets navigator.standalone). */
function isStandaloneDisplay(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function subscribeDisplayMode(onChange: () => void): () => void {
  const query = window.matchMedia('(display-mode: standalone)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function PwaInstallButton({ className = '' }: { className?: string }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  // false during SSR / hydration, then the real display mode
  const isStandalone = useSyncExternalStore(subscribeDisplayMode, isStandaloneDisplay, () => false);
  const [installedNow, setIsInstalled] = useState(false);
  const isInstalled = isStandalone || installedNow;
  const [showGuideModal, setShowGuideModal] = useState(false);

  useEffect(() => {
    // Already installed (standalone mode): no install prompt to listen for
    if (isStandalone) return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isStandalone]);

  if (isInstalled) {
    return null; // Already running as installed Desktop App!
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else {
      // Show visual guide modal on how to install in Chrome/Edge
      setShowGuideModal(true);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={handleInstallClick}
        className={`bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-bold text-xs rounded-xl shadow-sm gap-1.5 cursor-pointer animate-pulse hover:animate-none ${className}`}
        title="ติดตั้งเป็นโปรแกรม Desktop บนหน้าจอคอมพิวเตอร์"
      >
        <Download className="w-4 h-4 shrink-0 text-indigo-100" />
        <span>ติดตั้งโปรแกรม (Desktop App)</span>
      </Button>

      {/* Visual Guide Modal for Manual PWA Installation */}
      <Dialog open={showGuideModal} onOpenChange={setShowGuideModal}>
        <DialogContent className="max-w-md bg-white border border-slate-200 text-slate-900 rounded-3xl p-6 shadow-2xl space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-lg font-black text-slate-900">
              <div className="w-9 h-9 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center">
                <Laptop className="w-5 h-5" />
              </div>
              <span>วิธีติดตั้งโปรแกรมบน Desktop (PWA)</span>
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-slate-500 leading-relaxed">
            คุณสามารถติดตั้งระบบขายหน้าร้าน <b>&quot;ร้านปุริม POS&quot;</b> เป็นโปรแกรมเดสก์ท็อปที่มีไอคอนบนหน้าจอคอมพิวเตอร์ได้ง่ายๆ ใน 2 คลิก:
          </p>

          <div className="space-y-3 text-xs">
            {/* Step for Google Chrome */}
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <p className="font-bold text-slate-800 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[11px] font-black">1</span>
                <span>หากใช้ Google Chrome:</span>
              </p>
              <div className="pl-6 space-y-1 text-slate-600">
                <p>• คลิกที่ปุ่ม <b>จุดสามจุด (⋮)</b> ที่มุมขวาบนของเบราว์เซอร์</p>
                <p>• เลือกเมนู <b>&quot;บันทึกและแชร์ (Save & share)&quot;</b> หรือ <b>&quot;แคสต์ บันทึก และแชร์&quot;</b></p>
                <p>• กดเลือก <b>&quot;ติดตั้งหน้าเว็บนี้เป็นแอป (Install this page as an app)&quot;</b> หรือ <b>&quot;สร้างทางลัด (Create shortcut)&quot;</b> แล้วติ๊กถูกที่ <i>&quot;เปิดเป็นหน้าต่าง (Open as window)&quot;</i></p>
              </div>
            </div>

            {/* Step for Microsoft Edge */}
            <div className="p-3.5 bg-sky-50/60 rounded-2xl border border-sky-200 space-y-2">
              <p className="font-bold text-sky-900 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-[11px] font-black">2</span>
                <span>หากใช้ Microsoft Edge:</span>
              </p>
              <div className="pl-6 space-y-1 text-sky-800">
                <p>• คลิกที่ปุ่ม <b>จุดสามจุด (...)</b> ที่มุมขวาบน</p>
                <p>• เลือกเมนู <b>&quot;แอป (Apps)&quot;</b> 👉 กด <b>&quot;ติดตั้งไซต์นี้เป็นแอป (Install this site as an app)&quot;</b></p>
              </div>
            </div>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>เมื่อติดตั้งเสร็จ จะมีไอคอน <b>&quot;ปุริม POS&quot;</b> บนหน้าจอ Desktop ดับเบิ้ลคลิกเปิดขายได้ทันที!</span>
          </div>

          <Button
            type="button"
            onClick={() => setShowGuideModal(false)}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-10 rounded-xl"
          >
            เข้าใจแล้ว
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
