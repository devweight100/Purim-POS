'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, ScanLine, PauseCircle, Clock, LogOut, Receipt, ArrowLeft, Store, Monitor } from 'lucide-react';
import { useDocumentSearchStore } from '@/lib/store/document-search-store';
import type { PosController } from '@/lib/pos/use-pos-controller';
import { PosLogoutButton } from '../PosLogoutButton';

const formatClock = () => new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** hh:mm:ss, ticking every second (only rendered in the browser, after the page has mounted) */
function NeoClock() {
  const [currentTime, setCurrentTime] = useState(formatClock);
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(formatClock()), 1000);
    return () => clearInterval(interval);
  }, []);
  return <>{currentTime}</>;
}

/** Editing-bill banner and the top bar of the neo screen (navigation, search, mode, shift). */
export function NeoHeader({ pos }: { pos: PosController }) {
  const { cart, dialogs: d, filter } = pos;

  return (
    <>
      {/* Editing Order Banner */}
      {cart.editingOrderId && (
        <div className="bg-[#FEF08A] text-black px-4 py-2 border-b-2 border-black flex items-center justify-between shadow-[0_2px_0px_#000] shrink-0 z-30">
          <span className="font-black text-xs sm:text-sm flex items-center gap-2">
            ⚠️ กำลังอยู่ในโหมดแก้ไขรายการบิล #{cart.editingOrderId} (กดชำระเงินจะบันทึกทับบิลเดิม)
          </span>
          <button
            type="button"
            onClick={() => cart.clearCart()}
            className="bg-white hover:bg-neutral-100 text-black text-xs font-black px-3 py-1 rounded-lg border-2 border-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
          >
            ยกเลิกการแก้ไข
          </button>
        </div>
      )}

      {/* TOP HEADER: Neo-Brutalist Retro Bar */}
      <header className="shrink-0 border-b-2 border-black bg-white px-3 py-2 sm:px-4 z-20 shadow-[0_2px_0px_#000]">
        <div className="flex flex-wrap items-center justify-between gap-2.5">

          {/* Left Brand & Navigation */}
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/dashboard"
              className="group flex items-center gap-1.5 rounded-lg border-2 border-black bg-[#FEF08A] px-2.5 py-1.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] transition-all hover:bg-[#FDE047] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              title="กลับหน้าแดชบอร์ดหลัก"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">แดชบอร์ด</span>
            </Link>

            <PosLogoutButton variant="neo" />

            <div className="flex items-center gap-1.5 rounded-lg border-2 border-black bg-black px-2.5 py-1.5 text-white shadow-[2px_2px_0px_#000]">
              <span className="w-2 h-2 rounded-full bg-[#FF6B00] animate-ping" />
              <span className="text-xs font-black tracking-wider uppercase">PURIM POS</span>
              <span className="rounded bg-[#FF6B00] px-1 py-0.2 text-[9px] font-black text-black">NEO</span>
            </div>

            <Link
              href="/pos"
              className="hidden md:flex items-center gap-1 rounded-lg border-2 border-black bg-white px-2 py-1.5 text-[11px] font-bold text-neutral-700 shadow-[2px_2px_0px_#000] hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              title="สลับไปหน้าจอ POS แบบดั้งเดิม"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>โหมดคลาสสิก</span>
            </Link>
          </div>

          {/* Center Search & Scanner Bar */}
          <div className="flex-1 max-w-xl min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black" />
              <input
                type="text"
                placeholder="ยิงบาร์โค้ด หรือพิมพ์ชื่อสินค้า / SKU แล้วกด Enter..."
                value={filter.searchQuery}
                onChange={(e) => filter.setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    pos.handleSearchEnter();
                  }
                }}
                className="w-full h-10 rounded-xl border-2 border-black bg-[#F8F6F0] pl-9 pr-3 text-xs sm:text-sm font-bold text-black placeholder:text-neutral-500 shadow-[2px_2px_0px_#000] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6B00]"
              />
            </div>
          </div>

          {/* Right Action Pills */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* View Mode Selector */}
            <div className="flex items-center rounded-xl border-2 border-black bg-white p-0.5 shadow-[2px_2px_0px_#000]">
              <button
                type="button"
                onClick={() => pos.changeViewMode('touch_screen')}
                className={`rounded-lg px-2 py-1 text-xs font-black transition-all flex items-center gap-1 ${
                  pos.viewMode === 'touch_screen'
                    ? 'bg-[#FEF08A] text-black border border-black shadow-[1px_1px_0px_#000]'
                    : 'text-neutral-600 hover:text-black'
                }`}
                title="หน้าจอขายแบบ Touch Screen"
              >
                <span>📱 Touch</span>
              </button>
              <button
                type="button"
                onClick={() => pos.changeViewMode('list_view')}
                className={`rounded-lg px-2 py-1 text-xs font-black transition-all flex items-center gap-1 ${
                  pos.viewMode === 'list_view'
                    ? 'bg-[#FEF08A] text-black border border-black shadow-[1px_1px_0px_#000]'
                    : 'text-neutral-600 hover:text-black'
                }`}
                title="หน้าจอขายแบบรายการสินค้า"
              >
                <span>📋 รายการ</span>
              </button>
            </div>

            {/* Camera Barcode Scanner */}
            <button
              type="button"
              onClick={() => d.setShowBarcodeScan(true)}
              className="h-10 w-10 flex items-center justify-center rounded-xl border-2 border-black bg-white shadow-[2px_2px_0px_#000] hover:bg-[#FEF08A] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              title="เปิดกล้องสแกนบาร์โค้ด"
            >
              <ScanLine className="w-4 h-4 text-black" />
            </button>

            {/* Document Search (F3) */}
            <button
              type="button"
              onClick={() => useDocumentSearchStore.getState().openSearch()}
              className="hidden sm:flex h-10 items-center gap-1.5 rounded-xl border-2 border-black bg-[#E0E7FF] px-2.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-[#C7D2FE] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              title="ค้นหาเอกสารทั้งหมด / สแกนบาร์โค้ดใบเสร็จ (F3 เมื่อตะกร้าว่าง; มีสินค้าในตะกร้า F3 = ส่วนลดรายการ)"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>ค้นหาเอกสาร</span>
              <span className="rounded bg-black px-1 py-0.2 font-mono text-[10px] text-white">F3</span>
            </button>

            {/* Held Bills Indicator (F10) */}
            {cart.heldBills.length > 0 && (
              <button
                type="button"
                onClick={() => d.setShowHeldBills(true)}
                className="h-10 rounded-xl border-2 border-black bg-[#FEF08A] hover:bg-[#FDE047] text-black font-black text-xs px-2.5 shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1.5 animate-pulse"
                title="ดูรายการบิลที่พักไว้และเรียกคืน (F10)"
              >
                <PauseCircle className="w-3.5 h-3.5 text-black" />
                <span>บิลพัก ({cart.heldBills.length})</span>
              </button>
            )}

            {/* History (Ctrl+H) */}
            <button
              type="button"
              onClick={() => d.setShowOrderHistoryModal(prev => !prev)}
              className="hidden lg:flex h-10 items-center gap-1 rounded-xl border-2 border-black bg-white px-2.5 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-neutral-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              title="ประวัติการขาย (Ctrl+H)"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>ประวัติ</span>
            </button>

            {/* Digital Clock */}
            <div className="hidden xl:flex h-10 items-center rounded-xl border-2 border-black bg-[#FEF08A] px-2.5 font-mono text-xs font-black text-black shadow-[2px_2px_0px_#000]">
              <NeoClock />
            </div>

            {/* Shift Open / Close */}
            {!pos.isShiftOpen ? (
              <button
                type="button"
                onClick={() => d.setShowOpenShift(true)}
                className="h-10 rounded-xl border-2 border-black bg-[#86EFAC] px-3 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-[#4ADE80] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1.5"
              >
                <Store className="w-3.5 h-3.5" />
                <span>เปิดกะ</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => d.setShowCloseShift(true)}
                className="h-10 rounded-xl border-2 border-black bg-[#FECDD3] px-3 text-xs font-black text-black shadow-[2px_2px_0px_#000] hover:bg-[#FDA4AF] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none flex items-center gap-1.5"
                title="ปิดกะการขาย"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">ปิดกะ</span>
              </button>
            )}
          </div>
        </div>
      </header>

    </>
  );
}
