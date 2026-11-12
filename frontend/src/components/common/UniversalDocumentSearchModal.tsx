'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Search, ScanLine, X, FileText, ShoppingBag, ShieldAlert, 
  Calendar, CreditCard, Truck, RotateCcw, FileCheck, Printer, 
  ArrowRight, Loader2, Sparkles, AlertCircle 
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { errorText } from '@/lib/api-error';
import type {
  ApiDebt, ApiDocumentSearchResult, ApiOrderLike, ApiShiftRecord, ClaimRecord, DebtPaymentInstallment, DebtRecord,
  SupplierReturnNote,
} from '@/lib/types';
import type { PaymentVoucher } from '@/lib/payable-service';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

// Preview Modals
import { ReceiptPdfModal, ReceiptData } from '@/components/pos/ReceiptPdfModal';
import { orderToReceiptData } from '@/lib/receipt-mapper';
import { ShiftSummaryPdfModal, ShiftSummaryData } from '@/components/pos/ShiftSummaryPdfModal';
import { ClaimReceiptPdfModal } from '@/components/claims/ClaimReceiptPdfModal';
import { DebtReceiptPdfModal } from '@/components/debts/DebtReceiptPdfModal';
import PurchaseOrderPdfModal, { PurchaseOrderData } from '@/components/pos/PurchaseOrderPdfModal';
import { SupplierReturnPdfModal } from '@/components/supplier-returns/SupplierReturnPdfModal';
import { PaymentVoucherModal } from '@/components/payables/PaymentVoucherModal';

import { useDocumentSearchStore } from '@/lib/store/document-search-store';

export type UnifiedDocumentSearchResult = ApiDocumentSearchResult;

/** rawData of a SHIFT result: the shift row with its user, orders and cash movements. */
type ShiftDocument = Omit<ApiShiftRecord, 'user'> & {
  shiftCode?: string;
  code?: string;
  totalSales?: string | number;
  expectedCash?: string | number;
  user?: { fullName?: string; username?: string } | null;
};

/** Result of one server search: the documents found, or the error. */
type SearchOutcome = { results: UnifiedDocumentSearchResult[] } | { error: unknown };

async function searchDocuments(query: string): Promise<SearchOutcome> {
  try {
    return { results: (await api.documents.search(query)) || [] };
  } catch (error) {
    return { error };
  }
}

interface UniversalDocumentSearchModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function UniversalDocumentSearchModal({ open: controlledOpen, onOpenChange: controlledOnOpenChange }: UniversalDocumentSearchModalProps = {}) {
  const docStore = useDocumentSearchStore();
  const isOpen = controlledOpen !== undefined ? controlledOpen : docStore.isOpen;
  const setOpen = (val: boolean) => {
    if (controlledOnOpenChange) controlledOnOpenChange(val);
    docStore.setIsOpen(val);
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<UnifiedDocumentSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<string>('ALL');
  const inputRef = useRef<HTMLInputElement>(null);

  // Modal Preview States
  const [activeOrder, setActiveOrder] = useState<ReceiptData | null>(null);
  const [activeShift, setActiveShift] = useState<ShiftSummaryData | null>(null);
  // Claim / debt / return note / voucher previews get the server record as the search returned it
  // (the preview modals read the fields both shapes share), hence the casts where they are set.
  const [activeClaim, setActiveClaim] = useState<ClaimRecord | null>(null);
  const [activeDebt, setActiveDebt] = useState<{ debt: DebtRecord; installment: DebtPaymentInstallment } | null>(null);
  const [activePo, setActivePo] = useState<PurchaseOrderData | null>(null);
  const [activeReturnNote, setActiveReturnNote] = useState<SupplierReturnNote | null>(null);
  const [activeVoucher, setActiveVoucher] = useState<PaymentVoucher | null>(null);

  const handleOpenDocument = (doc: UnifiedDocumentSearchResult) => {
    switch (doc.type) {
      case 'ORDER': {
        const ord = doc.rawData as ApiOrderLike;
        // same mapping as the orders page / POS history reprint
        const receipt: ReceiptData = orderToReceiptData(
          { ...ord, orderNumber: ord.orderNumber || doc.docNumber, createdAt: ord.createdAt || String(doc.date) },
          { isReprint: true },
        );
        setActiveOrder(receipt);
        break;
      }
      case 'SHIFT': {
        const sh = doc.rawData as ShiftDocument;
        const totalIn = (sh.cashMovements || [])
          .filter((m) => m.type === 'IN')
          .reduce((sum: number, m) => sum + Number(m.amount || 0), 0);
        const totalOut = (sh.cashMovements || [])
          .filter((m) => m.type === 'OUT')
          .reduce((sum: number, m) => sum + Number(m.amount || 0), 0);

        const shiftData: ShiftSummaryData = {
          shiftId: sh.shiftNumber || sh.id,
          shiftCode: sh.shiftCode || sh.code || sh.shiftNumber || undefined,
          status: sh.status,
          userName: sh.user?.fullName || sh.user?.username || 'แคชเชียร์',
          openedAt: String(sh.openedAt || new Date().toISOString()),
          closedAt: String(sh.closedAt || new Date().toISOString()),
          openingCash: Number(sh.startingCash || 0),
          cashSales: Number(sh.cashSales || 0),
          qrSales: Number(sh.promptpaySales || 0),
          cardSales: Number(sh.creditCardSales || 0),
          transferSales: 0,
          totalSales: Number(sh.totalSales || 0),
          cashIn: totalIn,
          cashOut: totalOut,
          orderCount: (sh.orders || []).length || 0,
          voidCount: 0,
          expectedCash: Number(sh.expectedCash || sh.startingCash || 0),
          actualCash: Number(sh.actualCash !== null && sh.actualCash !== undefined ? sh.actualCash : (sh.expectedCash || sh.startingCash || 0)),
        };
        setActiveShift(shiftData);
        break;
      }
      case 'CLAIM': {
        setActiveClaim(doc.rawData as ClaimRecord);
        break;
      }
      case 'DEBT': {
        const debt = doc.rawData as ApiDebt;
        const latestInstallment = (debt.payments && debt.payments.length > 0)
          ? debt.payments[debt.payments.length - 1]
          : {
              installmentNo: 1,
              paymentDate: debt.createdAt,
              amountPaid: Number(debt.paidAmount || 0),
              previousPaid: 0,
              remainingAfter: Number(debt.remainingAmount || 0),
              paymentMethod: 'CASH',
              cashierName: 'เจ้าหน้าที่',
              receiptNo: doc.docNumber,
            };

        setActiveDebt({
          debt: ({
            id: debt.id,
            orderNumber: debt.order?.orderNumber || debt.id,
            orderDate: debt.createdAt,
            customerName: debt.customer?.name || 'ลูกค้าเงินเชื่อ',
            customerPhone: debt.customer?.phone,
            totalAmount: Number(debt.totalDebt),
            paidAmount: Number(debt.paidAmount),
            remainingAmount: Number(debt.remainingAmount),
          } as unknown as DebtRecord),
          installment: latestInstallment as unknown as DebtPaymentInstallment,
        });
        break;
      }
      case 'PURCHASE_ORDER': {
        setActivePo(doc.rawData as PurchaseOrderData);
        break;
      }
      case 'SUPPLIER_RETURN': {
        setActiveReturnNote(doc.rawData as SupplierReturnNote);
        break;
      }
      case 'PAYMENT_VOUCHER': {
        setActiveVoucher(doc.rawData as PaymentVoucher);
        break;
      }
    }
  };

  /** Show a search outcome (opening the only document found when asked) and end the loading state. */
  const showSearchOutcome = (outcome: SearchOutcome, autoOpenIfSingle: boolean) => {
    try {
      if ('error' in outcome) throw outcome.error;
      setResults(outcome.results);
      if (autoOpenIfSingle && outcome.results.length === 1) {
        handleOpenDocument(outcome.results[0]);
      }
    } catch (err) {
      console.error('Document search error:', err);
      // documents are searched on the server only
      setResults([]);
      toast.error('ค้นหาเอกสารจากเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่: ' + (errorText(err) || 'ติดต่อเซิร์ฟเวอร์ไม่ได้'));
    }
    setIsLoading(false);
  };

  const performSearch = async (query: string, autoOpenIfSingle = false) => {
    setIsLoading(true);
    showSearchOutcome(await searchDocuments(query), autoOpenIfSingle);
  };

  // Opening / closing the modal (or a new query from the store): adjust the search state during
  // render (React's "state from changed props" pattern); the effect below runs the search.
  const [openSync, setOpenSync] = useState<{ isOpen: boolean; initialQuery: string | null }>({ isOpen: false, initialQuery: null });
  if (openSync.isOpen !== isOpen || openSync.initialQuery !== docStore.initialQuery) {
    setOpenSync({ isOpen, initialQuery: docStore.initialQuery });
    if (isOpen) {
      if (docStore.initialQuery) {
        setSearchTerm(docStore.initialQuery);
        setIsLoading(true);
      }
    } else {
      setSearchTerm('');
      setResults([]);
    }
  }

  // An empty search box shows no results (also adjusted during render)
  const [syncedTerm, setSyncedTerm] = useState(searchTerm);
  if (syncedTerm !== searchTerm) {
    setSyncedTerm(searchTerm);
    if (!searchTerm.trim()) {
      setResults([]);
      setIsLoading(false);
    }
  }

  // Search the store's initial query right away and focus the input
  useEffect(() => {
    if (!isOpen) return;
    if (docStore.initialQuery) {
      const query = docStore.initialQuery;
      const run = async () => showSearchOutcome(await searchDocuments(query), true);
      void run();
    }
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 100);
  }, [isOpen, docStore.initialQuery]);

  // Global F3 shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F3 has a single owner: if another handler (e.g. POS item discount, which runs first on
      // document) already handled it, it calls preventDefault and the document search stays closed.
      if (e.key === 'F3' && !e.defaultPrevented) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Debounced search
  useEffect(() => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;

    const timer = setTimeout(() => {
      performSearch(trimmed);
    }, 280);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = searchTerm.trim();
      if (trimmed) {
        performSearch(trimmed, true);
      }
    }
  };

  const getDocTypeIcon = (type: string) => {
    switch (type) {
      case 'ORDER': return <ShoppingBag className="w-4 h-4 text-emerald-600" />;
      case 'CLAIM': return <ShieldAlert className="w-4 h-4 text-orange-500" />;
      case 'SHIFT': return <Calendar className="w-4 h-4 text-purple-600" />;
      case 'DEBT': return <CreditCard className="w-4 h-4 text-rose-600" />;
      case 'PURCHASE_ORDER': return <Truck className="w-4 h-4 text-sky-600" />;
      case 'SUPPLIER_RETURN': return <RotateCcw className="w-4 h-4 text-indigo-600" />;
      case 'PAYMENT_VOUCHER': return <FileCheck className="w-4 h-4 text-teal-600" />;
      default: return <FileText className="w-4 h-4 text-slate-500" />;
    }
  };

  const getDocTypeBadgeStyle = (type: string) => {
    switch (type) {
      case 'ORDER': return 'bg-emerald-50 text-emerald-800 border-emerald-300';
      case 'CLAIM': return 'bg-orange-50 text-orange-800 border-orange-300';
      case 'SHIFT': return 'bg-purple-50 text-purple-800 border-purple-300';
      case 'DEBT': return 'bg-rose-50 text-rose-800 border-rose-300';
      case 'PURCHASE_ORDER': return 'bg-sky-50 text-sky-800 border-sky-300';
      case 'SUPPLIER_RETURN': return 'bg-indigo-50 text-indigo-800 border-indigo-300';
      case 'PAYMENT_VOUCHER': return 'bg-teal-50 text-teal-800 border-teal-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const filteredResults = selectedFilter === 'ALL'
    ? results
    : results.filter(r => r.type === selectedFilter);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-white border-slate-200 rounded-3xl shadow-2xl">
          {/* Header & Barcode Input Bar (Bright / Light Theme) */}
          <div className="bg-slate-50 border-b border-slate-200 p-5 pb-4 space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-indigo-100/80 border border-indigo-200 text-indigo-600 flex items-center justify-center shadow-xs">
                  <ScanLine className="w-5 h-5 text-indigo-600 animate-pulse" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-black text-slate-900 flex items-center gap-2">
                    <span>ค้นหาเอกสารทั้งหมด / สแกนบาร์โค้ด</span>
                    <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200 font-mono font-bold">
                      F3 Shortcut
                    </Badge>
                  </DialogTitle>
                  <p className="text-xs text-slate-500 font-medium">
                    สแกนบาร์โค้ดหรือพิมพ์เลขที่เอกสารใดก็ได้ ค้นหาและเปิดพิมพ์สลิปซ้ำได้ทันที
                  </p>
                </div>
              </div>
            </div>

            {/* Input with Scanner Icon */}
            <div className="relative">
              <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <Input
                ref={inputRef}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="สแกนบาร์โค้ดเอกสาร หรือพิมพ์เลขที่เอกสาร (เช่น ORD-..., CLM-..., SHF-..., PO-..., DN-..., PV-...)"
                className="pl-11 pr-10 h-12 bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 text-sm font-mono rounded-2xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-xs"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
              {[
                { key: 'ALL', label: 'ทั้งหมด' },
                { key: 'ORDER', label: 'บิลขาย' },
                { key: 'CLAIM', label: 'ใบเคลม' },
                { key: 'SHIFT', label: 'สรุปกะ' },
                { key: 'DEBT', label: 'ชำระหนี้' },
                { key: 'PURCHASE_ORDER', label: 'ใบสั่งซื้อ' },
                { key: 'SUPPLIER_RETURN', label: 'ใบลดหนี้' },
                { key: 'PAYMENT_VOUCHER', label: 'ใบสำคัญจ่าย' },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setSelectedFilter(f.key)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer border ${
                    selectedFilter === f.key
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Results List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50 min-h-[340px] max-h-[58vh]">
            {isLoading ? (
              <div className="py-16 text-center space-y-2">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
                <p className="text-sm font-bold text-slate-600">กำลังค้นหาเอกสารจากระบบ...</p>
              </div>
            ) : filteredResults.length > 0 ? (
              filteredResults.map((doc, idx) => (
                <div
                  key={`${doc.type}-${doc.id}-${idx}`}
                  className="bg-white border border-slate-200 hover:border-indigo-400 rounded-2xl p-3.5 shadow-xs hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border flex items-center gap-1 ${getDocTypeBadgeStyle(doc.type)}`}>
                        {getDocTypeIcon(doc.type)}
                        {doc.typeName}
                      </span>
                      <span className="font-mono font-black text-slate-900 text-sm">
                        {doc.docNumber}
                      </span>
                      {doc.customerName && (
                        <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                          {doc.customerName}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {doc.description}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      วันที่: {new Date(doc.date).toLocaleString('th-TH')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {doc.amount !== undefined && (
                      <div className="text-right mr-2 hidden sm:block">
                        <span className="text-xs text-slate-500 block">ยอดเงิน</span>
                        <span className="text-sm font-black text-slate-900">{formatCurrency(doc.amount)}</span>
                      </div>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleOpenDocument(doc)}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1.5 rounded-xl h-9 px-3.5 shadow-sm group-hover:scale-105 transition-transform"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>ดู & พิมพ์สลิป</span>
                    </Button>
                  </div>
                </div>
              ))
            ) : searchTerm ? (
              <div className="py-16 text-center space-y-3">
                <AlertCircle className="w-10 h-10 text-slate-400 mx-auto" />
                <p className="text-sm font-bold text-slate-700">ไม่พบเอกสารที่ตรงกับ &quot;{searchTerm}&quot;</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  ตรวจสอบให้แน่ใจว่าตัวเลขบาร์โค้ดถูกต้อง หรือลองสแกนใหม่อีกครั้ง โดยไม่ต้องเลือกว่าเป็นเอกสารประเภทใด
                </p>
              </div>
            ) : (
              <div className="py-16 text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center mx-auto text-indigo-600">
                  <ScanLine className="w-7 h-7" />
                </div>
                <h4 className="text-sm font-bold text-slate-800">
                  พร้อมรับการสแกนบาร์โค้ด หรือพิมพ์ค้นหา
                </h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  ยิงบาร์โค้ดที่อยู่บนสลิปใบเสร็จ, สรุปกะ, ใบเคลม, ใบเสร็จชำระหนี้, PO, ใบลดหนี้ หรือใบสำคัญจ่าย เพื่อเปิดเอกสารทันที
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Document Slips Modals Triggered Directly from Search ─── */}
      <ReceiptPdfModal
        open={Boolean(activeOrder)}
        onOpenChange={(v) => !v && setActiveOrder(null)}
        data={activeOrder}
      />

      <ShiftSummaryPdfModal
        open={Boolean(activeShift)}
        onOpenChange={(v) => !v && setActiveShift(null)}
        data={activeShift}
      />

      <ClaimReceiptPdfModal
        open={Boolean(activeClaim)}
        onOpenChange={(v) => !v && setActiveClaim(null)}
        claim={activeClaim}
      />

      <DebtReceiptPdfModal
        open={Boolean(activeDebt)}
        onOpenChange={(v) => !v && setActiveDebt(null)}
        debtRecord={activeDebt?.debt || null}
        installment={activeDebt?.installment || null}
      />

      <PurchaseOrderPdfModal
        open={Boolean(activePo)}
        onOpenChange={(v) => !v && setActivePo(null)}
        po={activePo}
      />

      <SupplierReturnPdfModal
        open={Boolean(activeReturnNote)}
        onOpenChange={(v) => !v && setActiveReturnNote(null)}
        returnNote={activeReturnNote}
      />

      <PaymentVoucherModal
        open={Boolean(activeVoucher)}
        onOpenChange={(v) => !v && setActiveVoucher(null)}
        voucher={activeVoucher}
      />
    </>
  );
}
