'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Building2, CheckCircle2, DollarSign, FileText, 
  Receipt, ShieldAlert, Sparkles, Tag, Wallet, ArrowRight,
  HelpCircle, CreditCard, Banknote, Calendar, AlertCircle,
  Search, X, Check, ChevronDown, Percent
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency, thaiBahtText } from '@/lib/utils';
import { 
  SupplierPayableBill, 
  PaymentVoucher, 
  settleMultipleBills,
  updateBillInvoiceNo 
} from '@/lib/payable-service';
import { loadSupplierReturnNotes } from '@/lib/supplier-return-service';
import { SupplierReturnNote } from '@/lib/types';
import { toast } from 'sonner';

interface SettleMultipleBillsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allBills: SupplierPayableBill[];
  initialSupplierId?: string;
  preSelectedPoIds?: string[];
  onSuccess: (voucher: PaymentVoucher) => void;
}

export function SettleMultipleBillsModal({
  open,
  onOpenChange,
  allBills,
  initialSupplierId,
  preSelectedPoIds = [],
  onSuccess,
}: SettleMultipleBillsModalProps) {
  // Available suppliers with pending bills
  const availableSuppliers = useMemo(() => {
    const map = new Map<string, { id: string; name: string; contact?: string; phone?: string; unpaidCount: number; totalUnpaid: number }>();
    allBills.forEach((b) => {
      if (b.status === 'CANCELLED' || b.paymentStatus === 'PAID' || b.remainingPayable <= 0) return;
      const cur = map.get(b.supplierId) || { 
        id: b.supplierId, 
        name: b.supplierName, 
        contact: b.supplierContact,
        phone: b.supplierPhone,
        unpaidCount: 0, 
        totalUnpaid: 0 
      };
      cur.unpaidCount++;
      cur.totalUnpaid += b.remainingPayable;
      map.set(b.supplierId, cur);
    });
    return Array.from(map.values());
  }, [allBills]);

  // Selected supplier & search query
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [supplierSearchQuery, setSupplierSearchQuery] = useState<string>('');
  const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState<boolean>(false);
  const supplierSearchRef = useRef<HTMLDivElement>(null);

  // Payment Mode: FULL vs PARTIAL
  const [payMode, setPayMode] = useState<'FULL' | 'PARTIAL'>('FULL');

  // Selected bills & payment amount mapping
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(new Set());
  const [billPayAmounts, setBillPayAmounts] = useState<Record<string, number>>({});

  // Matched Debit Notes
  const [availableDebitNotes, setAvailableDebitNotes] = useState<SupplierReturnNote[]>([]);
  const [matchedDebitNotes, setMatchedDebitNotes] = useState<Record<string, number>>({});

  // Discount & Payment details
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'CHEQUE' | 'OTHER'>('TRANSFER');
  const [bankAccountLabel, setBankAccountLabel] = useState<string>('กสิกรไทย (KBANK) - 123-4-56789-0 (บัญชีหลักร้านค้า)');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState<string>('');
  const [cashierName, setCashierName] = useState<string>('เจ้าหน้าที่การเงิน');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inline edit state for invoice no
  const [editingPoId, setEditingPoId] = useState<string | null>(null);
  const [tempInvoiceNo, setTempInvoiceNo] = useState<string>('');

  // Close supplier dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (supplierSearchRef.current && !supplierSearchRef.current.contains(e.target as Node)) {
        setIsSupplierDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initialize or reset state when modal opens
  useEffect(() => {
    if (open) {
      const targetSuppId = initialSupplierId || (preSelectedPoIds.length > 0 ? allBills.find(b => preSelectedPoIds.includes(b.poId))?.supplierId : '') || '';
      setSelectedSupplierId(targetSuppId);
      setSupplierSearchQuery('');
      setIsSupplierDropdownOpen(false);
      setPayMode('FULL');

      // Pre-select POs
      if (preSelectedPoIds && preSelectedPoIds.length > 0) {
        const set = new Set(preSelectedPoIds);
        setSelectedBillIds(set);
        const amounts: Record<string, number> = {};
        allBills.forEach((b) => {
          if (set.has(b.poId)) {
            amounts[b.poId] = b.remainingPayable;
          }
        });
        setBillPayAmounts(amounts);
      } else {
        setSelectedBillIds(new Set());
        setBillPayAmounts({});
      }

      setDiscountAmount(0);
      setReferenceNo('');
      setNote('');
    }
  }, [open, initialSupplierId, preSelectedPoIds, allBills, availableSuppliers]);

  // Filtered suppliers for search
  const filteredSuppliers = useMemo(() => {
    const q = supplierSearchQuery.trim().toLowerCase();
    if (!q) return availableSuppliers;
    return availableSuppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.contact && s.contact.toLowerCase().includes(q)) ||
        (s.phone && s.phone.includes(q)) ||
        s.id.toLowerCase().includes(q)
    );
  }, [availableSuppliers, supplierSearchQuery]);

  // Load bills for currently selected supplier
  const supplierBills = useMemo(() => {
    return allBills.filter(
      (b) => b.supplierId === selectedSupplierId && b.status !== 'CANCELLED' && b.remainingPayable > 0
    );
  }, [allBills, selectedSupplierId]);

  // Load debit notes for selected supplier
  useEffect(() => {
    if (!selectedSupplierId) {
      setAvailableDebitNotes([]);
      setMatchedDebitNotes({});
      return;
    }
    const allNotes = loadSupplierReturnNotes();
    const notes = allNotes.filter(
      (n) => n.supplierId === selectedSupplierId && n.remainingCreditAmount > 0
    );
    setAvailableDebitNotes(notes);
    setMatchedDebitNotes({});
  }, [selectedSupplierId]);

  // Handle supplier change
  const handleSupplierChange = (newSuppId: string) => {
    setSelectedSupplierId(newSuppId);
    setSelectedBillIds(new Set());
    setBillPayAmounts({});
    setMatchedDebitNotes({});
    setIsSupplierDropdownOpen(false);
    setSupplierSearchQuery('');
  };

  // Toggle bill selection
  const handleToggleBill = (poId: string, remaining: number) => {
    setSelectedBillIds((prev) => {
      const next = new Set(prev);
      if (next.has(poId)) {
        next.delete(poId);
        setBillPayAmounts((cur) => {
          const c = { ...cur };
          delete c[poId];
          return c;
        });
      } else {
        next.add(poId);
        setBillPayAmounts((cur) => ({ ...cur, [poId]: remaining }));
      }
      return next;
    });
  };

  // Select all bills for current supplier
  const handleSelectAllBills = () => {
    if (selectedBillIds.size === supplierBills.length) {
      setSelectedBillIds(new Set());
      setBillPayAmounts({});
    } else {
      const allIds = new Set(supplierBills.map((b) => b.poId));
      setSelectedBillIds(allIds);
      const amounts: Record<string, number> = {};
      supplierBills.forEach((b) => {
        amounts[b.poId] = b.remainingPayable;
      });
      setBillPayAmounts(amounts);
    }
  };

  // Handle individual amount change for a bill
  const handleBillAmountChange = (poId: string, val: string, maxAmount: number) => {
    const num = Math.max(0, Math.min(maxAmount, Number(val) || 0));
    setBillPayAmounts((prev) => ({
      ...prev,
      [poId]: num,
    }));
  };

  // Switch to Full Payment mode
  const handleSelectFull = () => {
    setPayMode('FULL');
    const amounts: Record<string, number> = {};
    supplierBills.forEach((b) => {
      if (selectedBillIds.has(b.poId)) {
        amounts[b.poId] = b.remainingPayable;
      }
    });
    setBillPayAmounts(amounts);
  };

  // Switch to Partial Payment mode
  const handleSelectPartial = () => {
    setPayMode('PARTIAL');
  };

  // Quick percentage allocation across selected bills (25%, 50%, 75%, 100%)
  const handleQuickPercent = (pct: number) => {
    const amounts: Record<string, number> = {};
    supplierBills.forEach((b) => {
      if (selectedBillIds.has(b.poId)) {
        const calculated = Math.round((b.remainingPayable * pct) / 100);
        amounts[b.poId] = calculated;
      }
    });
    setBillPayAmounts(amounts);
  };

  // Toggle debit note deduction
  const handleToggleDebitNote = (noteId: string, maxCredit: number) => {
    setMatchedDebitNotes((prev) => {
      const next = { ...prev };
      if (next[noteId] !== undefined) {
        delete next[noteId];
      } else {
        next[noteId] = maxCredit;
      }
      return next;
    });
  };

  // Save inline invoice no
  const handleSaveInvoiceNo = (poId: string) => {
    if (!tempInvoiceNo.trim()) {
      setEditingPoId(null);
      return;
    }
    const res = updateBillInvoiceNo(poId, tempInvoiceNo.trim());
    if (res.success) {
      toast.success(res.message);
      const bill = allBills.find(b => b.poId === poId);
      if (bill) bill.supplierInvoiceNo = tempInvoiceNo.trim();
    }
    setEditingPoId(null);
  };

  // Totals calculations
  const totalBillsPayAmount = useMemo(() => {
    return Object.entries(billPayAmounts)
      .filter(([id]) => selectedBillIds.has(id))
      .reduce((sum, [_, val]) => sum + (Number(val) || 0), 0);
  }, [billPayAmounts, selectedBillIds]);

  const totalDebitDeducted = useMemo(() => {
    return Object.values(matchedDebitNotes).reduce((sum, val) => sum + (Number(val) || 0), 0);
  }, [matchedDebitNotes]);

  const netCashOrTransferRequired = useMemo(() => {
    return Math.max(0, Math.round((totalBillsPayAmount - totalDebitDeducted - (Number(discountAmount) || 0)) * 100) / 100);
  }, [totalBillsPayAmount, totalDebitDeducted, discountAmount]);

  // Submit payment
  const handleSubmit = () => {
    if (selectedBillIds.size === 0) {
      toast.error('กรุณาเลือกบิล / Invoice ที่ต้องการชำระอย่างน้อย 1 ใบ');
      return;
    }

    if (totalBillsPayAmount <= 0) {
      toast.error('ยอดชำระของบิลต้องมากกว่า 0 บาท');
      return;
    }

    setIsSubmitting(true);
    try {
      const currentSupp = availableSuppliers.find(s => s.id === selectedSupplierId);

      const billsToSettle = Array.from(selectedBillIds).map(poId => ({
        poId,
        amountToPay: Number(billPayAmounts[poId]) || 0,
      })).filter(b => b.amountToPay > 0);

      const matchedNotesPayload = Object.entries(matchedDebitNotes)
        .filter(([_, amt]) => Number(amt) > 0)
        .map(([returnNoteId, amountToDeduct]) => ({
          returnNoteId,
          amountToDeduct: Number(amountToDeduct),
        }));

      const res = settleMultipleBills({
        supplierId: selectedSupplierId,
        supplierName: currentSupp?.name,
        billsToSettle,
        matchedDebitNotes: matchedNotesPayload,
        discountAmount: Number(discountAmount) || 0,
        netCashOrTransferAmount: netCashOrTransferRequired,
        paymentMethod,
        bankAccountLabel: paymentMethod === 'TRANSFER' ? bankAccountLabel : undefined,
        referenceNo: referenceNo.trim() || undefined,
        note: note.trim() || undefined,
        cashierName: cashierName.trim() || 'เจ้าหน้าที่การเงิน',
        paymentDate: paymentDate ? new Date(paymentDate).toISOString() : new Date().toISOString(),
      });

      if (res.success && res.voucher) {
        toast.success(res.message);
        onOpenChange(false);
        onSuccess(res.voucher);
      } else {
        toast.error(res.message || 'เกิดข้อผิดพลาดในการบันทึกชำระหนี้');
      }
    } catch (err) {
      console.error('Failed to settle multiple bills:', err);
      toast.error('เกิดข้อผิดพลาดในการทำรายการ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedSupplierObj = availableSuppliers.find(s => s.id === selectedSupplierId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-[1240px] h-[88vh] sm:h-[90vh] max-h-[90vh] flex flex-col bg-white border-slate-200 text-slate-900 rounded-3xl p-0 overflow-hidden shadow-2xl font-sans my-auto">
        {/* ─── MODAL HEADER (Consistent POS Theme) ─── */}
        <DialogHeader className="px-8 py-5 bg-gradient-to-r from-slate-50 via-white to-indigo-50/40 border-b border-slate-200 shrink-0 flex flex-row items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-200">
              <Receipt className="w-6 h-6" />
            </div>
            <div>
              <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
                <span>สร้างใบชำระหนี้ / จ่ายเงินเจ้าหนี้</span>
                <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 font-mono text-xs font-bold px-2 py-0.5">
                  Multi-Invoice Settlement
                </Badge>
              </DialogTitle>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                เลือกตัดชำระบิลหลายใบในรอบเดียว รองรับทั้งชำระเต็มจำนวนหรือแบ่งชำระ ประกบใบลดหนี้ และออกใบสำคัญจ่าย A4
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* ─── SCROLLABLE BODY WITH GENEROUS PADDING ─── */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 bg-slate-50/40">
          {/* STEP 1: Search & Select Supplier */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-600" />
                <span>1. ค้นหาและเลือกบริษัทผู้จำหน่าย (Search Supplier):</span>
              </label>
              {selectedSupplierObj && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">ยอดหนี้ค้างชำระรวม:</span>
                  <span className="font-mono font-black text-rose-600 text-sm">
                    {formatCurrency(selectedSupplierObj.totalUnpaid)}
                  </span>
                  <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[11px] font-bold">
                    {selectedSupplierObj.unpaidCount} บิลค้าง
                  </Badge>
                </div>
              )}
            </div>

            {/* Search Input with Auto-Suggest Dropdown */}
            <div className="relative" ref={supplierSearchRef}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <Input
                    value={supplierSearchQuery}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSupplierSearchQuery(val);
                      setIsSupplierDropdownOpen(val.trim().length > 0);
                    }}
                    placeholder="พิมพ์ชื่อบริษัท, ผู้ติดต่อ หรือเบอร์โทรศัพท์เพื่อค้นหาผู้จำหน่าย..."
                    className="pl-10 h-10 text-xs sm:text-sm bg-slate-50 border-slate-300 rounded-xl focus:bg-white font-medium"
                  />
                  {supplierSearchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSupplierSearchQuery('');
                        setIsSupplierDropdownOpen(false);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsSupplierDropdownOpen((prev) => !prev)}
                  className="h-10 px-3.5 text-xs font-bold border-slate-300 rounded-xl gap-1.5 shrink-0"
                >
                  <span>รายชื่อทั้งหมด ({availableSuppliers.length})</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isSupplierDropdownOpen ? 'rotate-180' : ''}`} />
                </Button>
              </div>

              {/* Dropdown Options - ONLY when user opened or typed something */}
              {isSupplierDropdownOpen && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-64 overflow-y-auto divide-y divide-slate-100">
                  {filteredSuppliers.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      ไม่พบบริษัทผู้จำหน่ายที่ตรงกับการค้นหา
                    </div>
                  ) : (
                    filteredSuppliers.map((s) => {
                      const isSelected = selectedSupplierId === s.id;
                      return (
                        <div
                          key={s.id}
                          onClick={() => handleSupplierChange(s.id)}
                          className={`p-3.5 flex items-center justify-between cursor-pointer transition-colors ${
                            isSelected ? 'bg-indigo-50/80 text-indigo-900' : 'hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                              <Building2 className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="font-bold text-xs sm:text-sm">{s.name}</p>
                              <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                                {s.contact && <span>ติดต่อ: {s.contact}</span>}
                                {s.phone && <span>โทร: {s.phone}</span>}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-[11px] text-slate-400 block font-sans">หนี้ค้าง {s.unpaidCount} บิล</span>
                            <span className="font-mono font-black text-xs sm:text-sm text-rose-600">
                              {formatCurrency(s.totalUnpaid)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Selected Supplier Display */}
            {selectedSupplierObj && (
              <div className="flex items-center justify-between p-3.5 bg-indigo-50/60 border border-indigo-100 rounded-xl text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-indigo-950 text-sm">{selectedSupplierObj.name}</span>
                      <Badge variant="outline" className="bg-white text-indigo-700 text-[10px] font-bold">
                        หนี้ค้าง {selectedSupplierObj.unpaidCount} บิล
                      </Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                      {selectedSupplierObj.contact && `ติดต่อ: ${selectedSupplierObj.contact} • `}
                      {selectedSupplierObj.phone && `โทร: ${selectedSupplierObj.phone} • `}
                      ยอดหนี้รวม: <b className="text-rose-600">{formatCurrency(selectedSupplierObj.totalUnpaid)}</b>
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedSupplierId('');
                    setSupplierSearchQuery('');
                    setIsSupplierDropdownOpen(false);
                  }}
                  className="h-8 text-xs font-bold text-slate-600 hover:text-indigo-600 border-slate-200 bg-white"
                >
                  เปลี่ยนผู้จำหน่าย
                </Button>
              </div>
            )}
          </div>

          {/* STEP 2: Bills Section (Guarded by Supplier Selection) */}
          {!selectedSupplierId ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center shadow-xs space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto shadow-2xs">
                <Building2 className="w-7 h-7" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <p className="text-base font-bold text-slate-800">กรุณาเลือกหรือค้นหาบริษัทผู้จำหน่ายก่อน</p>
                <p className="text-xs text-slate-500">
                  เมื่อเลือกบริษัทผู้จำหน่ายแล้ว ระบบจะดึงรายการบิลและ Invoice ที่ค้างชำระทั้งหมดของบริษัทนั้นมาแสดงให้เลือกตัดจ่ายทันที
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* STEP 2: Multi-select Bills / Invoices & Partial Payment */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-indigo-600" />
                      <span>2. รายการบิล / Invoice ที่เลือกชำระ:</span>
                    </span>
                    <Badge variant="outline" className="text-xs font-bold font-mono bg-slate-50">
                      เลือกแล้ว {selectedBillIds.size} / {supplierBills.length} บิล
                    </Badge>
                  </div>

                  {/* Payment Mode Selector & Quick Percentage Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-slate-100">
                      <button
                        type="button"
                        onClick={handleSelectFull}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1 ${
                          payMode === 'FULL'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>ชำระเต็มจำนวน</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleSelectPartial}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1 ${
                          payMode === 'PARTIAL'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        <span>แบ่งชำระ (ระบุยอดเอง)</span>
                      </button>
                    </div>

                    {payMode === 'PARTIAL' && selectedBillIds.size > 0 && (
                      <div className="flex items-center gap-1 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-xl">
                        <span className="text-[11px] font-bold text-indigo-700 mr-1">แบ่งจ่ายด่วน:</span>
                        {[25, 50, 75, 100].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => handleQuickPercent(pct)}
                            className="px-2 py-0.5 text-xs font-bold bg-white text-indigo-700 border border-indigo-200 rounded-md hover:bg-indigo-600 hover:text-white transition-colors"
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    )}

                    {supplierBills.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleSelectAllBills}
                        className="h-8 text-xs font-bold text-indigo-700 border-indigo-200 hover:bg-indigo-50 rounded-xl"
                      >
                        {selectedBillIds.size === supplierBills.length ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกทุกบิล'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Bills Table with Row-Level Progress Bar (หลอดพลังประจำบิล) */}
                {supplierBills.length === 0 ? (
                  <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs">
                    ไม่มีบิลค้างชำระสำหรับผู้จำหน่ายรายนี้
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-3 w-10 text-center">
                            <Checkbox
                              checked={supplierBills.length > 0 && selectedBillIds.size === supplierBills.length}
                              onCheckedChange={handleSelectAllBills}
                            />
                          </th>
                          <th className="py-3 px-3">เลขที่บิลผู้จำหน่าย (Invoice No.)</th>
                          <th className="py-3 px-2 text-center w-28">เลขที่ PO</th>
                          <th className="py-3 px-2 text-center w-24">วันที่ในบิล</th>
                          <th className="py-3 px-3 text-right w-28">ยอดหนี้เต็ม</th>
                          <th className="py-3 px-3 text-right w-28">หนี้คงเหลือ</th>
                          <th className="py-3 px-3 text-right w-40">ยอดตัดจ่ายรอบนี้ (฿)</th>
                          <th className="py-3 px-3 text-center w-40">ความคืบหน้าชำระ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {supplierBills.map((b) => {
                          const isSelected = selectedBillIds.has(b.poId);
                          const isEditingThis = editingPoId === b.poId;
                          const currentAmount = billPayAmounts[b.poId] ?? b.remainingPayable;
                          const isFull = currentAmount >= b.remainingPayable;
                          const isPartial = currentAmount > 0 && currentAmount < b.remainingPayable;
                          const billPercent = b.remainingPayable > 0 ? Math.min(100, Math.round((currentAmount / b.remainingPayable) * 100)) : 0;

                          return (
                            <tr
                              key={b.poId}
                              className={`transition-colors ${isSelected ? 'bg-indigo-50/40' : 'hover:bg-slate-50/60'}`}
                            >
                              <td className="py-2.5 px-3 text-center">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => handleToggleBill(b.poId, b.remainingPayable)}
                                />
                              </td>
                              <td className="py-2.5 px-3">
                                {isEditingThis ? (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      value={tempInvoiceNo}
                                      onChange={(e) => setTempInvoiceNo(e.target.value)}
                                      placeholder="ระบุเลข Invoice"
                                      className="h-7 text-xs font-mono font-bold w-36"
                                      autoFocus
                                    />
                                    <Button
                                      size="sm"
                                      className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700"
                                      onClick={() => handleSaveInvoiceNo(b.poId)}
                                    >
                                      บันทึก
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <span className={`font-mono font-bold text-xs ${b.supplierInvoiceNo ? 'text-indigo-900' : 'text-slate-400 italic'}`}>
                                      {b.supplierInvoiceNo || 'ยังไม่ระบุเลขที่บิล'}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingPoId(b.poId);
                                        setTempInvoiceNo(b.supplierInvoiceNo || '');
                                      }}
                                      className="text-[10px] text-slate-400 hover:text-indigo-600 underline ml-1"
                                    >
                                      [แก้ไข]
                                    </button>
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-2 text-center font-mono text-slate-600 text-[11px]">
                                {b.poNumber}
                              </td>
                              <td className="py-2.5 px-2 text-center text-slate-500 text-[11px]">
                                {new Date(b.billDate).toLocaleDateString('th-TH')}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                                {formatCurrency(b.totalAmount)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600">
                                {formatCurrency(b.remainingPayable)}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {isSelected ? (
                                  <Input
                                    type="number"
                                    step="any"
                                    value={currentAmount}
                                    onChange={(e) => handleBillAmountChange(b.poId, e.target.value, b.remainingPayable)}
                                    className="h-8 text-right font-mono font-bold text-indigo-700 bg-white border-indigo-300 shadow-2xs"
                                  />
                                ) : (
                                  <span className="text-slate-400 font-mono text-xs">-</span>
                                )}
                              </td>

                              {/* ─── หลอดพลังความคืบหน้ารายบิล (Row-Level Progress Bar) ─── */}
                              <td className="py-2.5 px-3 text-center">
                                {isSelected ? (
                                  <div className="space-y-1 max-w-[130px] mx-auto">
                                    <div className="flex items-center justify-between text-[11px] font-semibold">
                                      <span className={isFull ? 'text-teal-700 font-bold' : isPartial ? 'text-indigo-700 font-bold' : 'text-slate-400'}>
                                        {isFull ? 'ครบ 100%' : `${billPercent}%`}
                                      </span>
                                      <span className="text-[10px] text-slate-500 font-mono">
                                        {isFull ? 'ครบแล้ว' : `ค้าง ${formatCurrency(b.remainingPayable - currentAmount)}`}
                                      </span>
                                    </div>

                                    {/* Soft Pastel Progress Bar */}
                                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                                      <div
                                        className={`h-full rounded-full transition-all duration-300 ${
                                          isFull
                                            ? 'bg-teal-500'
                                            : isPartial
                                            ? 'bg-indigo-500'
                                            : 'bg-slate-200'
                                        }`}
                                        style={{ width: `${Math.max(billPercent > 0 ? 5 : 0, billPercent)}%` }}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-300 text-xs">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {selectedBillIds.size > 0 && (
                        <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-200">
                          <tr>
                            <td colSpan={6} className="py-3 px-3 text-right text-slate-700">
                              รวมยอดที่เลือกชำระ ({selectedBillIds.size} บิล):
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-black text-indigo-700 text-sm">
                              {formatCurrency(totalBillsPayAmount)}
                            </td>
                            <td className="py-3 px-3 text-center font-mono text-xs text-slate-500">
                              {selectedBillIds.size} รายการ
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>

              {/* STEP 3: Match Debit Notes (ถ้ามี) */}
              {availableDebitNotes.length > 0 && (
                <div className="bg-amber-50/40 border border-amber-200/80 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-amber-600" />
                      <span>3. ประกบหักใบลดหนี้ / เครดิตสินค้าชำรุดส่งคืน (Debit Notes):</span>
                    </span>
                    <span className="text-[11px] text-amber-800 font-medium">
                      มีเครดิตที่ใช้ได้ {availableDebitNotes.length} ฉบับ
                    </span>
                  </div>

                  <div className="space-y-2">
                    {availableDebitNotes.map((dn) => {
                      const isChecked = matchedDebitNotes[dn.id] !== undefined;

                      return (
                        <div
                          key={dn.id}
                          className={`p-3.5 rounded-xl border flex items-center justify-between transition-all ${
                            isChecked ? 'bg-white border-amber-300 shadow-2xs' : 'bg-white/60 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => handleToggleDebitNote(dn.id, dn.remainingCreditAmount)}
                            />
                            <div>
                              <p className="font-mono font-bold text-xs text-slate-900">
                                ใบลดหนี้เลขที่ {dn.id}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                สินค้าส่งคืน: {dn.totalQuantity} ชิ้น • เครดิตคงเหลือ: <strong className="text-emerald-700 font-mono">{formatCurrency(dn.remainingCreditAmount)}</strong>
                              </p>
                            </div>
                          </div>

                          {isChecked && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-600 font-medium">หักเครดิต:</span>
                              <Input
                                type="number"
                                step="any"
                                value={matchedDebitNotes[dn.id]}
                                onChange={(e) => {
                                  const v = Math.max(0, Math.min(dn.remainingCreditAmount, Number(e.target.value) || 0));
                                  setMatchedDebitNotes(cur => ({ ...cur, [dn.id]: v }));
                                }}
                                className="h-8 w-28 text-right font-mono font-bold text-rose-700 border-amber-300"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STEP 4: Payment Details & Themed Summary Box */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Left: Payment Method & Channel */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3.5">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Wallet className="w-4 h-4 text-indigo-600" />
                    <span>4. ช่องทางชำระเงิน (Payment Method):</span>
                  </span>

                  <div className="grid grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('TRANSFER')}
                      className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                        paymentMethod === 'TRANSFER'
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-500/20 shadow-2xs'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>เงินโอน</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentMethod('CASH')}
                      className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                        paymentMethod === 'CASH'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20 shadow-2xs'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Banknote className="w-4 h-4" />
                      <span>เงินสด</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentMethod('CHEQUE')}
                      className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                        paymentMethod === 'CHEQUE'
                          ? 'border-amber-600 bg-amber-50 text-amber-900 ring-2 ring-amber-500/20 shadow-2xs'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Tag className="w-4 h-4" />
                      <span>เช็ค / อื่นๆ</span>
                    </button>
                  </div>

                  {paymentMethod === 'TRANSFER' && (
                    <div className="space-y-2 pt-1">
                      <div>
                        <label className="text-[11px] font-bold text-slate-600 block mb-1">
                          บัญชีธนาคารที่ใช้จ่ายเงิน:
                        </label>
                        <Input
                          value={bankAccountLabel}
                          onChange={(e) => setBankAccountLabel(e.target.value)}
                          className="h-8.5 text-xs bg-slate-50 border-slate-300 rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-slate-600 block mb-1">
                          เลขอ้างอิงสลิปโอน / หมายเลขอ้างอิง:
                        </label>
                        <Input
                          value={referenceNo}
                          onChange={(e) => setReferenceNo(e.target.value)}
                          placeholder="เช่น K-12398471"
                          className="h-8.5 text-xs font-mono bg-slate-50 border-slate-300 rounded-xl"
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 block mb-1">วันที่จ่ายเงิน:</label>
                      <Input
                        type="date"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="h-8.5 text-xs bg-slate-50 border-slate-300 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 block mb-1">ผู้จัดทำเอกสาร:</label>
                      <Input
                        value={cashierName}
                        onChange={(e) => setCashierName(e.target.value)}
                        className="h-8.5 text-xs bg-slate-50 border-slate-300 rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                {/* Right: Themed Light Consistent Summary Box (NO DARK BLOCK) */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 pb-2 border-b border-slate-100">
                      <DollarSign className="w-4 h-4 text-emerald-600" />
                      <span>5. สรุปยอดเงินและส่วนลด (Payment Summary):</span>
                    </span>

                    <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-100">
                      <span className="text-slate-600 font-medium">ยอดรวมบิลที่เลือกชำระ ({selectedBillIds.size} ใบ):</span>
                      <span className="font-mono font-bold text-slate-900 text-sm">{formatCurrency(totalBillsPayAmount)}</span>
                    </div>

                    {totalDebitDeducted > 0 && (
                      <div className="flex items-center justify-between text-xs text-rose-600 pb-2 border-b border-slate-100">
                        <span className="font-medium">หักเครดิตใบลดหนี้รวม:</span>
                        <span className="font-mono font-bold text-sm">-{formatCurrency(totalDebitDeducted)}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-100">
                      <span className="text-amber-800 font-medium flex items-center gap-1">
                        <Tag className="w-3.5 h-3.5 text-amber-600" />
                        <span>ส่วนลดท้ายบิลเจรจาการค้า:</span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-amber-700 font-bold">-</span>
                        <Input
                          type="number"
                          step="any"
                          placeholder="0.00"
                          value={discountAmount || ''}
                          onChange={(e) => setDiscountAmount(Math.max(0, Number(e.target.value) || 0))}
                          className="h-8.5 w-32 text-right font-mono font-bold text-amber-800 bg-amber-50/60 border-amber-300 text-xs rounded-xl focus:bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-slate-600 block mb-1">หมายเหตุบันทึกจ่ายเงิน (ถ้ามี):</label>
                      <Input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="เช่น จ่ายรอบบิลประจำสัปดาห์ / งวดที่ 1"
                        className="h-8.5 text-xs bg-slate-50 border-slate-300 text-slate-800 placeholder:text-slate-400 rounded-xl focus:bg-white"
                      />
                    </div>
                  </div>

                  {/* Total Net Payment Box (Consistent Pastel Emerald Highlight Box) */}
                  <div className="pt-3 border-t border-slate-200 space-y-1.5 bg-emerald-50/70 border border-emerald-200/80 p-4 rounded-xl">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                        ยอดเงินสุทธิที่ต้องจ่ายจริง:
                      </span>
                      <span className="text-2xl font-black font-mono text-emerald-700">
                        {formatCurrency(netCashOrTransferRequired)}
                      </span>
                    </div>
                    <p className="text-[11px] text-right font-medium text-emerald-800/80">
                      ({thaiBahtText(netCashOrTransferRequired)})
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ─── MODAL FOOTER WITH COMFORTABLE INWARD PADDING ─── */}
        <DialogFooter className="px-10 pt-4 pb-8 sm:pb-10 bg-slate-50 border-t border-slate-200 shrink-0 flex flex-row items-center justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="text-slate-700 bg-white hover:bg-slate-100 border-slate-300 font-bold text-xs sm:text-sm px-6 h-10 rounded-xl ml-2 shadow-2xs"
          >
            ยกเลิก
          </Button>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedSupplierId || selectedBillIds.size === 0}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm px-8 h-10 rounded-xl shadow-md mr-2 gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSubmitting ? 'กำลังบันทึก...' : 'บันทึกชำระหนี้ & พิมพ์ใบสำคัญจ่าย (A4)'}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
