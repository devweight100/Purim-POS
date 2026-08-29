'use client';

import { useState, useEffect } from 'react';
import { 
  Building2, CheckCircle2, FileText, Plus, Trash2, 
  ArrowRight, ShieldAlert, Package, Phone, User, Info, DollarSign
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { 
  getPendingReturnsGroupedBySupplier, 
  createSupplierReturnNote,
  loadSuppliers,
  PendingSupplierGroup
} from '@/lib/supplier-return-service';
import { ClaimRecord, SupplierReturnNote } from '@/lib/types';

interface CreateSupplierReturnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (returnNote: SupplierReturnNote) => void;
}

export function CreateSupplierReturnModal({
  open,
  onOpenChange,
  onSuccess,
}: CreateSupplierReturnModalProps) {
  const [supplierGroups, setSupplierGroups] = useState<PendingSupplierGroup[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(new Set());
  const [unitCosts, setUnitCosts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = () => {
    const groups = getPendingReturnsGroupedBySupplier();
    setSupplierGroups(groups);
    if (groups.length > 0 && !selectedSupplierId) {
      setSelectedSupplierId(groups[0].supplierId);
    }
  };

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open]);

  const currentGroup = supplierGroups.find((g) => g.supplierId === selectedSupplierId);

  // Initialize selected claim IDs & unit costs when supplier changes
  useEffect(() => {
    if (currentGroup) {
      const allIds = new Set(currentGroup.claims.map((c) => c.id));
      setSelectedClaimIds(allIds);

      const costs: Record<string, number> = {};
      currentGroup.claims.forEach((c) => {
        costs[c.id] = c.costPrice || 50;
      });
      setUnitCosts(costs);
    } else {
      setSelectedClaimIds(new Set());
      setUnitCosts({});
    }
  }, [selectedSupplierId, currentGroup]);

  const toggleClaimSelect = (claimId: string) => {
    setSelectedClaimIds((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) {
        next.delete(claimId);
      } else {
        next.add(claimId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!currentGroup) return;
    if (selectedClaimIds.size === currentGroup.claims.length) {
      setSelectedClaimIds(new Set());
    } else {
      setSelectedClaimIds(new Set(currentGroup.claims.map((c) => c.id)));
    }
  };

  const handleUnitCostChange = (claimId: string, val: string) => {
    const num = parseFloat(val);
    setUnitCosts((prev) => ({
      ...prev,
      [claimId]: isNaN(num) ? 0 : Math.max(0, num),
    }));
  };

  // Calculate totals for selected items
  const selectedClaims = currentGroup?.claims.filter((c) => selectedClaimIds.has(c.id)) || [];
  const totalSelectedQty = selectedClaims.reduce((sum, c) => sum + (c.quantity || 1), 0);
  const totalSelectedCreditAmount = selectedClaims.reduce((sum, c) => {
    const cost = unitCosts[c.id] ?? (c.costPrice || 50);
    return sum + cost * (c.quantity || 1);
  }, 0);

  const handleSubmit = () => {
    if (!currentGroup) {
      toast.error('กรุณาเลือกบริษัทคู่ค้า');
      return;
    }
    if (selectedClaimIds.size === 0) {
      toast.error('กรุณาเลือกรายการสินค้าเคลมที่ต้องการส่งคืนอย่างน้อย 1 รายการ');
      return;
    }

    setIsSubmitting(true);
    try {
      const claimItems = selectedClaims.map((c) => ({
        claimId: c.id,
        unitCost: unitCosts[c.id] ?? c.costPrice ?? 50,
      }));

      const newReturnNote = createSupplierReturnNote({
        supplierId: currentGroup.supplierId,
        supplierName: currentGroup.supplierName,
        supplierContact: currentGroup.supplierContact,
        supplierPhone: currentGroup.supplierPhone,
        claimItems,
        notes: notes.trim() || undefined,
        createdBy: 'เจ้าหน้าที่ฝ่ายเคลม',
      });

      toast.success(`✅ ออกใบส่งคืนสินค้า ${newReturnNote.id} สำเร็จ! มูลค่าหักลดหนี้ ฿${newReturnNote.totalCreditAmount.toLocaleString()}`);
      onSuccess(newReturnNote);
      onOpenChange(false);
    } catch (err) {
      console.error('Error creating return note:', err);
      toast.error('เกิดข้อผิดพลาดในการออกเอกสาร');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:w-[950px] max-w-[950px] max-h-[92vh] bg-white border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-7 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <DialogHeader className="pb-3 border-b border-slate-200 shrink-0">
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-xs">
              <FileText className="w-5 h-5" />
            </div>
            <span>ออกเอกสารส่งคืนสินค้าเคลม / ใบลดหนี้ซัพพลายเออร์ (Supplier Return & Debit Note)</span>
          </DialogTitle>
          <p className="text-xs text-slate-500 font-medium">
            รวบรวมของเสียที่รับเคลมจากลูกค้าเพื่อส่งคืนบริษัทผู้จำหน่าย พร้อมคำนวณมูลค่าตามราคาทุนสำหรับนำไปหักลบกับบิลเรียกเก็บเงิน
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-3 space-y-4 pr-1">
          {supplierGroups.length === 0 ? (
            <div className="py-16 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 space-y-2">
              <Package className="w-10 h-10 text-slate-400 mx-auto" />
              <p className="font-bold text-slate-700">ไม่มีรายการสินค้าเคลมที่รอส่งคืนบริษัท</p>
              <p className="text-xs text-slate-400">
                เมื่อมีลูกค้ามาเคลมสินค้าและบันทึกในระบบ รายการของเสียจะปรากฏที่นี่เพื่อรวบรวมส่งคืนบริษัท
              </p>
            </div>
          ) : (
            <>
              {/* 1. Supplier Selector Pills */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  เลือกบริษัทคู่ค้า / ผู้จำหน่ายที่ต้องการส่งคืน:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {supplierGroups.map((g) => (
                    <button
                      key={g.supplierId}
                      type="button"
                      onClick={() => setSelectedSupplierId(g.supplierId)}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        selectedSupplierId === g.supplierId
                          ? 'border-rose-500 bg-rose-50/70 ring-2 ring-rose-400/30 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-extrabold text-sm text-slate-900 truncate">
                          {g.supplierName}
                        </span>
                        <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-[10px] font-black shrink-0">
                          {g.pendingCount} รายการ
                        </Badge>
                      </div>
                      <div className="text-xs text-slate-500 flex justify-between">
                        <span>จำนวน: <b>{g.totalItemsQuantity} ชิ้น</b></span>
                        <span className="font-black text-rose-700 font-mono">
                          {formatCurrency(g.totalCostValue)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Items List for Selected Supplier */}
              {currentGroup && (
                <div className="space-y-2 border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-slate-900">
                        รายการของเคลมรอส่งคืน: {currentGroup.supplierName}
                      </span>
                      <span className="text-xs text-slate-500">
                        (เลือก {selectedClaimIds.size}/{currentGroup.claims.length} รายการ)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="text-xs font-bold text-indigo-600 hover:underline cursor-pointer"
                    >
                      {selectedClaimIds.size === currentGroup.claims.length ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกทั้งหมด'}
                    </button>
                  </div>

                  <div className="divide-y divide-slate-200 max-h-64 overflow-y-auto space-y-1 pr-1">
                    {currentGroup.claims.map((claim) => {
                      const isChecked = selectedClaimIds.has(claim.id);
                      const currentCost = unitCosts[claim.id] ?? claim.costPrice ?? 50;
                      const lineTotalCost = currentCost * (claim.quantity || 1);

                      return (
                        <div
                          key={claim.id}
                          className={`p-2.5 rounded-xl transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            isChecked ? 'bg-white shadow-2xs border border-slate-200' : 'opacity-60 bg-transparent'
                          }`}
                        >
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleClaimSelect(claim.id)}
                              className="w-4 h-4 text-rose-600 rounded border-slate-300 mt-1 cursor-pointer"
                            />
                            <div className="min-w-0 flex-1 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-sm truncate">
                                  {claim.productName}
                                </span>
                                <span className="font-mono text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {claim.id}
                                </span>
                              </div>
                              <div className="text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                                <span className="text-rose-700 font-medium">สาเหตุ: {claim.defectReason}</span>
                                <span>· บิลขาย: {claim.orderNumber}</span>
                                <span>· ลูกค้า: {claim.customerName}</span>
                              </div>
                            </div>
                          </div>

                          {/* Quantity & Unit Cost Input */}
                          <div className="flex items-center gap-3 shrink-0 pl-7 sm:pl-0">
                            <div className="text-right">
                              <span className="text-[11px] text-slate-400 block">จำนวน</span>
                              <b className="text-slate-900 text-xs">{claim.quantity} {claim.unitName}</b>
                            </div>

                            <div className="text-right w-24">
                              <span className="text-[11px] text-slate-400 block">ราคาทุน/หน่วย</span>
                              <div className="relative">
                                <Input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={unitCosts[claim.id] ?? claim.costPrice ?? 50}
                                  onChange={(e) => handleUnitCostChange(claim.id, e.target.value)}
                                  className="h-7 text-xs font-bold text-right pr-2 py-0"
                                  disabled={!isChecked}
                                />
                              </div>
                            </div>

                            <div className="text-right min-w-[90px]">
                              <span className="text-[11px] text-slate-400 block">มูลค่ารวม</span>
                              <span className="font-black text-rose-700 text-sm font-mono block">
                                {formatCurrency(lineTotalCost)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. Notes */}
              <div className="space-y-1 text-xs">
                <label className="font-bold text-slate-700">หมายเหตุเอกสารส่งคืน (ถ้ามี):</label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="เช่น กล่องส่งคืนที่ 1/2, ฝากเซลล์คุณวิชัยรับของกลับ, หรือระบุเลขพัสดุ"
                  className="h-9 text-xs"
                />
              </div>

              {/* 4. Financial Deduction Summary */}
              <div className="p-4 bg-rose-50/80 border-2 border-rose-200 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-rose-900 block">
                    ยอดเงินที่จะนำไปหักลดหนี้ในบิลบริษัท (Total Debit Amount):
                  </span>
                  <p className="text-[11px] text-slate-600">
                    * เมื่อออกเอกสารแล้ว ยอดนี้จะสามารถนำไปเลือกหักลบกับบิลเรียกเก็บเงิน/ใบสั่งซื้อ (PO) ของบริษัทนี้ได้ทันที
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs text-slate-500 font-bold mr-2">
                    รวม {totalSelectedQty} ชิ้น
                  </span>
                  <span className="text-2xl font-black text-rose-700 font-mono">
                    {formatCurrency(totalSelectedCreditAmount)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="pt-3 border-t border-slate-200 flex justify-between items-center shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 px-5 border-slate-300 text-slate-700 font-bold rounded-xl"
          >
            ยกเลิก
          </Button>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || supplierGroups.length === 0 || selectedClaimIds.size === 0}
            className="h-10 px-6 bg-rose-600 hover:bg-rose-700 text-white font-black text-sm rounded-xl shadow-md gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>ยืนยันออกใบส่งคืนและพิมพ์เอกสาร (RTN)</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}