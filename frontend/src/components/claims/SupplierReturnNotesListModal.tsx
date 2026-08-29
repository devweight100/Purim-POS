'use client';

import { useState, useEffect } from 'react';
import { 
  Building2, FileText, Printer, Search, CheckCircle2, Clock, 
  ArrowRight, ExternalLink, Calendar, DollarSign
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency, formatDate } from '@/lib/utils';
import { loadSupplierReturnNotes } from '@/lib/supplier-return-service';
import { SupplierReturnNote } from '@/lib/types';

interface SupplierReturnNotesListModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewPdf: (note: SupplierReturnNote) => void;
}

export function SupplierReturnNotesListModal({
  open,
  onOpenChange,
  onViewPdf,
}: SupplierReturnNotesListModalProps) {
  const [notes, setNotes] = useState<SupplierReturnNote[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) {
      setNotes(loadSupplierReturnNotes());
    }
  }, [open]);

  const filtered = notes.filter((n) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      n.id.toLowerCase().includes(q) ||
      n.supplierName.toLowerCase().includes(q) ||
      (n.deductions && n.deductions.some(d => d.billNumber.toLowerCase().includes(q)))
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:w-[950px] max-w-[950px] max-h-[90vh] bg-white border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-7 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <DialogHeader className="pb-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-xs">
                <FileText className="w-5 h-5" />
              </div>
              <span>ประวัติใบส่งคืนสินค้าเคลม & ใบลดหนี้ (Supplier Return Notes)</span>
            </DialogTitle>
          </div>
          <p className="text-xs text-slate-500 font-medium">
            รายการเอกสาร RTN ทั้งหมดที่เคยออกให้บริษัทคู่ค้า พร้อมสถานะการนำไปหักลบกับบิลเรียกเก็บเงิน
          </p>
        </DialogHeader>

        {/* Search */}
        <div className="pt-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาตามเลขที่ RTN, ชื่อบริษัทคู่ค้า, เลขที่บิล PO..."
              className="pl-9 h-10 text-xs bg-slate-50 border-slate-300 rounded-xl"
            />
          </div>
        </div>

        {/* List Table */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-200 border border-slate-200 rounded-2xl bg-white mt-3">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              ไม่พบประวัติเอกสารส่งคืนสินค้า
            </div>
          ) : (
            filtered.map((note) => {
              const isDeducted = note.status === 'DEDUCTED';
              const isPartially = note.status === 'PARTIALLY_DEDUCTED';

              return (
                <div
                  key={note.id}
                  className="p-4 hover:bg-slate-50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-black text-sm text-slate-900 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-lg">
                        {note.id}
                      </span>
                      <span className="text-xs text-slate-500 flex items-center gap-1 font-medium">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(note.returnDate).toLocaleDateString('th-TH')}
                      </span>
                      {isDeducted ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] font-bold">
                          ✓ หักในบิลแล้ว
                        </Badge>
                      ) : isPartially ? (
                        <Badge className="bg-sky-100 text-sky-800 border-sky-300 text-[10px] font-bold">
                          หักบางส่วน (เหลือ ฿{note.remainingCreditAmount.toLocaleString()})
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] font-bold">
                          ⏳ รอหักในรอบบิล
                        </Badge>
                      )}
                    </div>

                    <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5 pt-0.5">
                      <Building2 className="w-4 h-4 text-slate-500" />
                      <span>{note.supplierName}</span>
                      <span className="text-xs text-slate-400 font-normal">
                        ({note.items.length} รายการ · รวม {note.totalQuantity} ชิ้น)
                      </span>
                    </div>

                    {note.deductions && note.deductions.length > 0 && (
                      <div className="text-[11px] text-slate-500 pt-0.5">
                        หักลบในบิล: {note.deductions.map(d => `${d.billNumber} (-฿${d.deductedAmount.toLocaleString()})`).join(', ')}
                      </div>
                    )}
                  </div>

                  {/* Right Side: Total and Action */}
                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div className="text-right">
                      <span className="text-[11px] text-slate-400 block font-medium">ยอดขอหักลดหนี้</span>
                      <span className="text-base font-black text-rose-700 font-mono">
                        {formatCurrency(note.totalCreditAmount)}
                      </span>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onViewPdf(note)}
                      className="h-9 px-3 gap-1.5 border-slate-300 hover:bg-slate-100 text-slate-700 font-bold rounded-xl shadow-2xs"
                    >
                      <Printer className="w-4 h-4" />
                      <span>ดู/พิมพ์เอกสาร</span>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-200 flex justify-end shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 px-5 border-slate-300 text-slate-700 font-bold rounded-xl"
          >
            ปิดหน้าต่าง
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}