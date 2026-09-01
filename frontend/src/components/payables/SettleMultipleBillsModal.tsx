'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Building2, CheckCircle2, DollarSign, FileText, 
  Receipt, ShieldAlert, Sparkles, Tag, Wallet, ArrowRight,
  HelpCircle, CreditCard, Banknote, Calendar, AlertCircle
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
    const map = new Map<string, { id: string; name: string; unpaidCount: number; totalUnpaid: number }>();
    allBills.forEach((b) => {
      if (b.status === 'CANCELLED' || b.paymentStatus === 'PAID' || b.remainingPayable <= 0) return;
      const cur = map.get(b.supplierId) || { id: b.supplierId, name: b.supplierName, unpaidCount: 0, totalUnpaid: 0 };
      cur.unpaidCount++;
      cur.totalUnpaid += b.remainingPayable;
      map.set(b.supplierId, cur);
    });
    return Array.from(map.values());
  }, [allBills]);

  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');

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

  // Initialize or change supplier
  useEffect(() => {
    if (open) {
      const targetSuppId = initialSupplierId || (preSelectedPoIds.length > 0 ? allBills.find(b => preSelectedPoIds.includes(b.poId))?.supplierId : '') || availableSuppliers[0]?.id || '';
      setSelectedSupplierId(targetSuppId);

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

  // Handle amount change for a bill
  const handleBillAmountChange = (poId: string, val: string, maxAmount: number) => {
    const num = Math.max(0, Math.min(maxAmount, Number(val) || 0));
    setBillPayAmounts((prev) => ({
      ...prev,
      [poId]: num,
    }));
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
      // update local in allBills
      const bill = allBills.find(b => b.poId === poId);
      if (bill) bill.supplierInvoiceNo = tempInvoiceNo.trim();
    }
    setEditingPoId(null);
  };

  // Totals calculations
  const totalBillsPayAmount = useMemo(() => {
    return Object.values(billPayAmounts).reduce((sum, val) => sum + (Number(val) || 0), 0);
  }, [billPayAmounts]);

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
      <DialogContent className="w-[96vw] max-w-4xl max-h-[92vh] flex flex-col bg-white border-slate-200 text-slate-900 rounded-3xl p-0 overflow-hidden shadow-2xl font-sans">
        {/* Header */}
        <DialogHeader className="px-6 py-4 bg-slate-900 text-white shrink-0 flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black text-white flex items-center gap-2">
                <span>สร้างใบชำระหนี้ / จ่ายเงินเจ้าหนี้</span>
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-400/30 font-mono text-xs">
                  Multi-Invoice Payment
                </Badge>
              </DialogTitle>
              <p className="text-xs text-slate-300">
                เลือกชำระบิลหลายใบของผู้จำหน่ายในรอบเดียว พร้อมออกใบสำคัญจ่าย A4
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* STEP 1: Select Supplier */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-indigo-600" />
                <span>1. เลือกบริษัทผู้จำหน่าย (Supplier):</span>
              </label>
              {selectedSupplierObj && (
                <span className="text-xs font-medium text-slate-500">
                  มีหนี้ค้างชำระ: <strong className="text-rose-600 font-mono">{formatCurrency(selectedSupplierObj.totalUnpaid)}</strong> ({selectedSupplierObj.unpaidCount} บิล)
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {availableSuppliers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSupplierChange(s.id)}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                    selectedSupplierId === s.id
                      ? 'border-indigo-600 bg-indigo-50/50 shadow-xs ring-2 ring-indigo-500/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <p className={`font-bold text-xs line-clamp-1 ${selectedSupplierId === s.id ? 'text-indigo-950' : 'text-slate-800'}`}>
                      {s.name}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                      ค้างชำระ {s.unpaidCount} บิล
                    </p>
                  </div>
                  <p className="text-xs font-mono font-black text-rose-700 mt-2">
                    {formatCurrency(s.totalUnpaid)}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* STEP 2: Multi-select Bills / Invoices */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span>2. เลือกบิล / Invoice ที่ต้องการชำระในรอบนี้:</span>
                </span>
                <Badge variant="outline" className="text-xs font-bold font-mono">
                  เลือกแล้ว {selectedBillIds.size} / {supplierBills.length} บิล
                </Badge>
              </div>

              {supplierBills.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleSelectAllBills}
                  className="h-7 text-xs font-semibold text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                >
                  {selectedBillIds.size === supplierBills.length ? 'ยกเลิกการเลือกทั้งหมด' : 'เลือกทั้งหมด'}
                </Button>
              )}
            </div>

            {supplierBills.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-500 text-xs">
                ไม่มีบิลค้างชำระสำหรับผู้จำหน่ายรายนี้
              </div>
            ) : (
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 w-10 text-center">
                        <Checkbox
                          checked={supplierBills.length > 0 && selectedBillIds.size === supplierBills.length}
                          onCheckedChange={handleSelectAllBills}
                        />
                      </th>
                      <th className="py-2.5 px-3">เลขที่บิลผู้จำหน่าย (Invoice No.)</th>
                      <th className="py-2.5 px-2 text-center w-28">เลขที่ PO</th>
                      <th className="py-2.5 px-2 text-center w-24">วันที่ในบิล</th>
                      <th className="py-2.5 px-3 text-right w-28">ยอดหนี้เต็ม</th>
                      <th className="py-2.5 px-3 text-right w-28">หนี้คงเหลือ</th>
                      <th className="py-2.5 px-3 text-right w-36">ยอดที่จะจ่ายครั้งนี้ (฿)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {supplierBills.map((b) => {
                      const isSelected = selectedBillIds.has(b.poId);
                      const isEditingThis = editingPoId === b.poId;

                      return (
                        <tr
                          key={b.poId}
                          className={`transition-colors ${isSelected ? 'bg-indigo-50/40' : 'hover:bg-slate-50/60'}`}
                        >
                          <td className="py-2 px-3 text-center">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => handleToggleBill(b.poId, b.remainingPayable)}
                            />
                          </td>
                          <td className="py-2 px-3">
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
                          <td className="py-2 px-2 text-center font-mono text-slate-600 text-[11px]">
                            {b.poNumber}
                          </td>
                          <td className="py-2 px-2 text-center text-slate-500 text-[11px]">
                            {new Date(b.billDate).toLocaleDateString('th-TH')}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-600">
                            {formatCurrency(b.totalAmount)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-rose-600">
                            {formatCurrency(b.remainingPayable)}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {isSelected ? (
                              <Input
                                type="number"
                                step="any"
                                value={billPayAmounts[b.poId] ?? b.remainingPayable}
                                onChange={(e) => handleBillAmountChange(b.poId, e.target.value, b.remainingPayable)}
                                className="h-8 text-right font-mono font-bold text-indigo-700 bg-white border-indigo-300"
                              />
                            ) : (
                              <span className="text-slate-400 font-mono text-xs">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {selectedBillIds.size > 0 && (
                    <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={6} className="py-2.5 px-3 text-right text-slate-700">
                          รวมยอดที่เลือกชำระ ({selectedBillIds.size} บิล):
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-black text-indigo-700 text-sm">
                          {formatCurrency(totalBillsPayAmount)}
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
            <div className="bg-amber-50/40 border border-amber-200/80 rounded-2xl p-4 space-y-3">
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
                      className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
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

          {/* STEP 4: Payment Details & Discount */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Payment Method & Channel */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-indigo-600" />
                <span>4. ช่องทางชำระเงิน (Payment Method):</span>
              </span>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('TRANSFER')}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    paymentMethod === 'TRANSFER'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>เงินโอน</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('CASH')}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    paymentMethod === 'CASH'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <Banknote className="w-3.5 h-3.5" />
                  <span>เงินสด</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('CHEQUE')}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    paymentMethod === 'CHEQUE'
                      ? 'border-amber-600 bg-amber-50 text-amber-900 ring-2 ring-amber-500/20'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <Tag className="w-3.5 h-3.5" />
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
                      className="h-8 text-xs bg-white border-slate-300"
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
                      className="h-8 text-xs font-mono bg-white border-slate-300"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">วันที่จ่ายเงิน:</label>
                  <Input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="h-8 text-xs bg-white border-slate-300"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">ผู้จัดทำเอกสาร:</label>
                  <Input
                    value={cashierName}
                    onChange={(e) => setCashierName(e.target.value)}
                    className="h-8 text-xs bg-white border-slate-300"
                  />
                </div>
              </div>
            </div>

            {/* Right: Discount & Final Summary */}
            <div className="bg-slate-900 text-white rounded-2xl p-4 flex flex-col justify-between space-y-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                  <span className="text-slate-400">ยอดรวมบิลที่เลือก ({selectedBillIds.size} ใบ):</span>
                  <span className="font-mono font-bold text-white text-sm">{formatCurrency(totalBillsPayAmount)}</span>
                </div>

                {totalDebitDeducted > 0 && (
                  <div className="flex items-center justify-between text-xs text-rose-400">
                    <span>หักใบลดหนี้รวม:</span>
                    <span className="font-mono font-bold">-{formatCurrency(totalDebitDeducted)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs">
                  <span className="text-amber-300">ส่วนลดท้ายบิลเจรจาการค้า:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-amber-400 font-bold">-</span>
                    <Input
                      type="number"
                      step="any"
                      placeholder="0.00"
                      value={discountAmount || ''}
                      onChange={(e) => setDiscountAmount(Math.max(0, Number(e.target.value) || 0))}
                      className="h-7 w-24 text-right font-mono font-bold text-amber-400 bg-slate-800 border-slate-700 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">หมายเหตุบันทึกจ่ายเงิน (ถ้ามี):</label>
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="เช่น จ่ายรอบบิลประจำสัปดาห์"
                    className="h-7 text-xs bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500"
                  />
                </div>
              </div>

              {/* Total Net Payment Box */}
              <div className="pt-3 border-t border-slate-800 space-y-1 bg-slate-950/60 p-3 rounded-xl">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    ยอดเงินสุทธิที่ต้องจ่ายจริง:
                  </span>
                  <span className="text-xl font-black font-mono text-emerald-400">
                    {formatCurrency(netCashOrTransferRequired)}
                  </span>
                </div>
                <p className="text-[11px] text-right font-medium text-slate-400">
                  ({thaiBahtText(netCashOrTransferRequired)})
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-3.5 bg-slate-100 border-t border-slate-200 shrink-0 flex flex-row items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-slate-600 hover:bg-slate-200 font-bold text-xs"
          >
            ยกเลิก
          </Button>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || selectedBillIds.size === 0}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-6 h-10 shadow-sm gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSubmitting ? 'กำลังบันทึก...' : 'บันทึกชำระหนี้ & พิมพ์ใบสำคัญจ่าย (A4)'}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
