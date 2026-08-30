'use client';

import { useState, useEffect } from 'react';
import { 
  Building2, Plus, Search, Filter, FileText, Download, Printer, 
  Trash2, ShieldAlert, Package, CheckCircle2, Clock, AlertCircle, 
  Receipt, ArrowLeftRight, ChevronRight, Eye, RefreshCw, XCircle, Pencil, RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { 
  loadSuppliers, 
  loadSupplierReturnNotes,
  getEligibleClaimsForReturn,
  loadPurchaseOrders,
  cancelSupplierReturnNote,
  restoreSupplierReturnNote
} from '@/lib/supplier-return-service';
import { SupplierReturnNote } from '@/lib/types';
import { CreateSupplierReturnModal } from '@/components/supplier-returns/CreateSupplierReturnModal';
import { SupplierReturnPdfModal } from '@/components/supplier-returns/SupplierReturnPdfModal';
import { ChangeReturnStatusModal } from '@/components/supplier-returns/ChangeReturnStatusModal';

export default function SupplierReturnsPage() {
  const [returnNotes, setReturnNotes] = useState<SupplierReturnNote[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [pendingClaims, setPendingClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedSupplierFilter, setSelectedSupplierFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [preselectedSupplierId, setPreselectedSupplierId] = useState<string | undefined>(undefined);
  const [preselectedPoId, setPreselectedPoId] = useState<string | undefined>(undefined);
  const [editingNote, setEditingNote] = useState<SupplierReturnNote | null>(null);

  const [selectedNoteForPdf, setSelectedNoteForPdf] = useState<SupplierReturnNote | null>(null);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);

  const [statusChangeNote, setStatusChangeNote] = useState<SupplierReturnNote | null>(null);
  const [isStatusChangeModalOpen, setIsStatusChangeModalOpen] = useState(false);

  const refreshData = () => {
    setLoading(true);
    try {
      const notes = loadSupplierReturnNotes();
      setReturnNotes(notes);

      const supps = loadSuppliers();
      setSuppliers(supps);

      const purchaseOrders = loadPurchaseOrders();
      setPos(purchaseOrders);

      const claims = getEligibleClaimsForReturn();
      setPendingClaims(claims);
    } catch (e) {
      console.error('Failed to load supplier returns data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  // Open create modal with optional preset
  const handleOpenCreate = (supplierId?: string, poId?: string) => {
    setEditingNote(null);
    setPreselectedSupplierId(supplierId);
    setPreselectedPoId(poId);
    setIsCreateModalOpen(true);
  };

  // Open edit modal
  const handleEditNote = (note: SupplierReturnNote) => {
    if (note.status === 'DEDUCTED') {
      toast.error('เอกสารนี้หักลดหนี้แล้ว ไม่สามารถแก้ไขได้โดยตรง (กรุณาย้อนสถานะก่อน)');
      return;
    }
    setEditingNote(note);
    setPreselectedSupplierId(note.supplierId);
    setPreselectedPoId(note.linkedPoId);
    setIsCreateModalOpen(true);
  };

  // Open Change Status Modal
  const handleOpenChangeStatus = (note: SupplierReturnNote) => {
    setStatusChangeNote(note);
    setIsStatusChangeModalOpen(true);
  };

  // Open PDF preview
  const handleViewPdf = (note: SupplierReturnNote) => {
    setSelectedNoteForPdf(note);
    setIsPdfModalOpen(true);
  };

  // Cancel return note
  const handleCancelNote = (note: SupplierReturnNote) => {
    if (!confirm(`คุณต้องการยกเลิกเอกสารส่งคืน ${note.id} หรือไม่?\n(ระบบจะคืนสต็อกสินค้าปกติและคืนสถานะรายการเคลมให้)`)) {
      return;
    }

    const res = cancelSupplierReturnNote(note.id);
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
  };

  // Restore return note from trash
  const handleRestoreNote = (note: SupplierReturnNote) => {
    if (!confirm(`คุณต้องการกู้คืนเอกสารส่งคืน ${note.id} ออกจากถังขยะหรือไม่?`)) {
      return;
    }

    const res = restoreSupplierReturnNote(note.id);
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
  };

  // Calculations for Metrics
  const totalPendingClaimsCost = pendingClaims.reduce(
    (sum, c) => sum + Number(c.totalCostValue || (c.costPrice || 50) * (c.quantity || 1)),
    0
  );

  const activeNotes = returnNotes.filter((n) => n.status !== 'CANCELLED');
  const cancelledNotes = returnNotes.filter((n) => n.status === 'CANCELLED');

  const totalAvailableCredit = activeNotes.reduce(
    (sum, n) => sum + Number(n.remainingCreditAmount || 0),
    0
  );

  const totalUnpaidPoDebt = pos
    .filter((p) => p.status !== 'CANCELLED' && p.status !== 'DRAFT')
    .reduce((sum, p) => {
      const total = Number(p.totalAmount || 0);
      const deducted = (p.deductedReturns || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
      return sum + Math.max(0, total - deducted);
    }, 0);

  // Filtered Active Notes
  const filteredNotes = activeNotes.filter((note) => {
    const matchesSearch =
      note.id.toLowerCase().includes(search.toLowerCase()) ||
      (note.supplierName || '').toLowerCase().includes(search.toLowerCase()) ||
      (note.linkedPoNumber || '').toLowerCase().includes(search.toLowerCase()) ||
      note.items.some((i) => (i.productName || '').toLowerCase().includes(search.toLowerCase()));

    const matchesSupplier =
      selectedSupplierFilter === 'ALL' || note.supplierId === selectedSupplierFilter;

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'PENDING' && (note.status === 'PENDING_DEDUCTION' || note.status === 'PARTIALLY_DEDUCTED')) ||
      (statusFilter === 'DEDUCTED' && note.status === 'DEDUCTED');

    return matchesSearch && matchesSupplier && matchesStatus;
  });

  // Filtered Cancelled Notes (Trash)
  const filteredCancelledNotes = cancelledNotes.filter((note) => {
    const matchesSearch =
      note.id.toLowerCase().includes(search.toLowerCase()) ||
      (note.supplierName || '').toLowerCase().includes(search.toLowerCase()) ||
      (note.linkedPoNumber || '').toLowerCase().includes(search.toLowerCase()) ||
      note.items.some((i) => (i.productName || '').toLowerCase().includes(search.toLowerCase()));

    const matchesSupplier =
      selectedSupplierFilter === 'ALL' || note.supplierId === selectedSupplierFilter;

    return matchesSearch && matchesSupplier;
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                ส่งเคลม & คืนสินค้าบริษัท (Supplier Returns)
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                ทำเอกสารส่งคืนสินค้าชำรุดหรือสินค้าปกติขายไม่ออกเพื่อลดหนี้ใบสั่งซื้อ (PO) แยกตามคู่ค้าผู้จำหน่าย
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={refreshData}
            className="rounded-2xl font-bold text-slate-600 border-slate-200 hover:bg-slate-50 gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">รีเฟรช</span>
          </Button>

          <Button
            type="button"
            onClick={() => handleOpenCreate()}
            className="rounded-2xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-md h-11 px-5"
          >
            <Plus className="w-5 h-5" />
            <span>สร้างใบส่งคืน / ลดหนี้บริษัท</span>
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Pending Claims */}
        <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">สินค้าชำรุดรอส่งเคลม</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-slate-900 font-mono">
              {pendingClaims.length}
            </span>
            <span className="text-xs text-slate-400 font-bold ml-1.5">รายการ</span>
          </div>
          <p className="text-[11px] text-rose-600 font-bold">
            มูลค่าต้นทุนรวม: {formatCurrency(totalPendingClaimsCost)}
          </p>
        </div>

        {/* Metric 2: Available Credit */}
        <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">เครดิตลดหนี้คงเหลือ</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-indigo-700 font-mono">
              {formatCurrency(totalAvailableCredit)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            พร้อมนำไปหักลบยอดเรียกเก็บของบริษัท
          </p>
        </div>

        {/* Metric 3: Total Return Notes */}
        <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">เอกสารส่งคืนทั้งหมด</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-slate-900 font-mono">
              {returnNotes.filter((n) => n.status !== 'CANCELLED').length}
            </span>
            <span className="text-xs text-slate-400 font-bold ml-1.5">ฉบับ</span>
          </div>
          <p className="text-[11px] text-emerald-700 font-bold">
            หักลดหนี้สำเร็จแล้ว: {returnNotes.filter((n) => n.status === 'DEDUCTED').length} ฉบับ
          </p>
        </div>

        {/* Metric 4: Unpaid PO Debt */}
        <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">หนี้ใบสั่งซื้อ PO ค้างชำระ</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="text-2xl font-black text-amber-700 font-mono">
              {formatCurrency(totalUnpaidPoDebt)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            ยอดรวมใบ PO ที่ยังไม่ได้ชำระเต็มจำนวน
          </p>
        </div>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="return_notes" className="w-full space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <TabsList className="bg-slate-100 p-1 rounded-2xl h-11">
            <TabsTrigger
              value="return_notes"
              className="rounded-xl font-bold text-xs data-[state=active]:bg-white data-[state=active]:shadow-xs px-4"
            >
              เอกสารส่งคืน & ใบลดหนี้ ({activeNotes.length})
            </TabsTrigger>
            <TabsTrigger
              value="pending_claims"
              className="rounded-xl font-bold text-xs data-[state=active]:bg-white data-[state=active]:shadow-xs px-4 gap-1.5"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              <span>รอส่งเคลมบริษัท ({pendingClaims.length})</span>
            </TabsTrigger>
            <TabsTrigger
              value="payable_pos"
              className="rounded-xl font-bold text-xs data-[state=active]:bg-white data-[state=active]:shadow-xs px-4 gap-1.5"
            >
              <Receipt className="w-3.5 h-3.5 text-amber-600" />
              <span>ใบสั่งซื้อที่มียอดค้างชำระ</span>
            </TabsTrigger>
            <TabsTrigger
              value="trash"
              className="rounded-xl font-bold text-xs data-[state=active]:bg-white data-[state=active]:text-rose-700 data-[state=active]:shadow-xs px-4 gap-1.5 text-slate-500 hover:text-rose-600"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
              <span>ถังขยะ / ยกเลิกแล้ว ({cancelledNotes.length})</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* TAB 1: RETURN NOTES */}
        <TabsContent value="return_notes" className="space-y-4 m-0">
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <Input
                type="text"
                placeholder="ค้นหาเลขที่เอกสาร, บริษัทผู้จำหน่าย, ใบสั่งซื้อ PO หรือชื่อสินค้า..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-11 text-xs bg-slate-50 border-slate-200 rounded-2xl"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                value={selectedSupplierFilter}
                onChange={(e) => setSelectedSupplierFilter(e.target.value)}
                className="h-11 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 w-full md:w-56"
              >
                <option value="ALL">🏢 ผู้จำหน่ายทั้งหมด</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-11 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 w-full md:w-40"
              >
                <option value="ALL">ทุกสถานะที่ใช้งาน</option>
                <option value="PENDING">รอหักลดหนี้</option>
                <option value="DEDUCTED">หักลดหนี้แล้ว</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
            {filteredNotes.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-3">
                <FileText className="w-12 h-12 text-slate-300 mx-auto" />
                <p className="text-base font-bold text-slate-600">ไม่พบเอกสารส่งคืนสินค้า</p>
                <p className="text-xs text-slate-400">
                  คลิกที่ปุ่ม &quot;สร้างใบส่งคืน / ลดหนี้บริษัท&quot; ด้านบนเพื่อเริ่มทำรายการ
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3.5 text-left">เลขที่เอกสาร / วันที่</th>
                      <th className="p-3.5 text-left">บริษัทผู้จำหน่าย</th>
                      <th className="p-3.5 text-left">หมวดหมู่ & รายการสินค้า</th>
                      <th className="p-3.5 text-left">อ้างอิงใบสั่งซื้อ (PO)</th>
                      <th className="p-3.5 text-right">มูลค่าส่งคืน / ขอลดหนี้</th>
                      <th className="p-3.5 text-center">สถานะ</th>
                      <th className="p-3.5 text-center w-28">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredNotes.map((note) => {
                      const defCount = note.items.filter((i) => i.itemType === 'DEFECTIVE').length;
                      const overCount = note.items.filter((i) => i.itemType === 'OVERSTOCK').length;

                      return (
                        <tr key={note.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="p-3.5">
                            <span className="font-mono font-bold text-indigo-700 text-sm block">
                              {note.id}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {new Date(note.returnDate).toLocaleDateString('th-TH', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </td>

                          <td className="p-3.5">
                            <p className="font-bold text-slate-900">{note.supplierName}</p>
                            {note.supplierPhone && (
                              <p className="text-[10.5px] text-slate-400 font-mono">{note.supplierPhone}</p>
                            )}
                          </td>

                          <td className="p-3.5">
                            <div className="flex items-center gap-1.5 mb-1">
                              {defCount > 0 && (
                                <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] font-bold">
                                  ชำรุด {defCount} รายการ
                                </Badge>
                              )}
                              {overCount > 0 && (
                                <Badge className="bg-sky-50 text-sky-700 border-sky-200 text-[10px] font-bold">
                                  สินค้าปกติ {overCount} รายการ
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-600 truncate max-w-xs">
                              {note.items.map((i) => i.productName).join(', ')}
                            </p>
                          </td>

                          <td className="p-3.5">
                            {note.linkedPoNumber ? (
                              <span className="font-mono font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                {note.linkedPoNumber}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">- ถือเป็นเครดิต -</span>
                            )}
                          </td>

                          <td className="p-3.5 text-right font-mono">
                            <span className="font-bold text-slate-900 text-sm block">
                              {formatCurrency(note.totalCreditAmount)}
                            </span>
                            {note.status === 'DEDUCTED' ? (
                              <span className="text-[10px] text-emerald-600 font-semibold">
                                ✓ หักลดหนี้ครบแล้ว
                              </span>
                            ) : note.remainingCreditAmount < note.totalCreditAmount && note.remainingCreditAmount > 0 ? (
                              <span className="text-[10px] text-sky-600 font-semibold">
                                คงเหลือ {formatCurrency(note.remainingCreditAmount)}
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-700 font-semibold">
                                รอประกบหัก
                              </span>
                            )}
                          </td>

                          <td className="p-3.5 text-center">
                            {note.status === 'DEDUCTED' ? (
                              <Badge className="bg-emerald-600 text-white font-bold">หักลดหนี้แล้ว</Badge>
                            ) : note.status === 'PARTIALLY_DEDUCTED' ? (
                              <Badge className="bg-sky-600 text-white font-bold">หักหนี้บางส่วน</Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-50 font-bold">
                                รอหักลดหนี้
                              </Badge>
                            )}
                          </td>

                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleViewPdf(note)}
                                className="h-8 px-2 rounded-xl border-slate-200 hover:border-indigo-300 hover:text-indigo-600 font-bold text-xs gap-1"
                                title="ดูเอกสาร / พิมพ์"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>ดู</span>
                              </Button>

                              {note.status !== 'DEDUCTED' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleEditNote(note)}
                                  className="h-8 px-2 rounded-xl border-slate-200 hover:border-amber-400 hover:text-amber-700 font-bold text-xs gap-1"
                                  title="แก้ไขเอกสารส่งคืน"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  <span>แก้ไข</span>
                                </Button>
                              )}

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenChangeStatus(note)}
                                className="h-8 px-2 rounded-xl border-slate-200 hover:border-sky-400 hover:text-sky-700 font-bold text-xs gap-1"
                                title="เปลี่ยน / ย้อนสถานะเอกสาร"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>ย้อนสถานะ</span>
                              </Button>

                              {note.status !== 'CANCELLED' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancelNote(note)}
                                  className="h-8 px-1.5 rounded-xl border-slate-200 hover:border-rose-300 hover:text-rose-600 transition-colors"
                                  title="ยกเลิกเอกสารนี้"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 2: PENDING CLAIMS BY SUPPLIER */}
        <TabsContent value="pending_claims" className="space-y-4 m-0">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  รายการเคลมสินค้าชำรุดที่ค้างส่งคืนบริษัทผู้จำหน่าย
                </h3>
                <p className="text-xs text-slate-500">
                  สินค้าที่ลูกค้านำมาเคลมและเลือกส่งเคลมประกัน สามารถรวมส่งคืนบริษัทเพื่อออกใบลดหนี้ได้ทันที
                </p>
              </div>
            </div>

            {pendingClaims.length === 0 ? (
              <div className="p-8 text-center text-slate-400 space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                <p className="font-bold text-slate-700">ไม่มีสินค้าชำรุดค้างส่งคืน</p>
                <p className="text-xs text-slate-400">รายการเคลมทั้งหมดถูกส่งคืนบริษัทเรียบร้อยแล้ว</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {suppliers.map((supp) => {
                  const suppClaims = pendingClaims.filter((c) => c.supplierId === supp.id);
                  if (suppClaims.length === 0) return null;

                  const totalVal = suppClaims.reduce(
                    (sum, c) => sum + Number(c.totalCostValue || (c.costPrice || 50) * (c.quantity || 1)),
                    0
                  );

                  return (
                    <div
                      key={supp.id}
                      className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-3"
                    >
                      <div>
                        <div className="flex justify-between items-start">
                          <p className="font-bold text-slate-900 text-sm truncate">{supp.name}</p>
                          <Badge className="bg-rose-100 text-rose-800 text-[10px] font-bold border-rose-200">
                            {suppClaims.length} รายการ
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          มูลค่ารวม: <strong className="text-rose-700 font-mono">{formatCurrency(totalVal)}</strong>
                        </p>
                        <ul className="text-[11px] text-slate-600 mt-2 space-y-1 divide-y divide-slate-200">
                          {suppClaims.slice(0, 3).map((c) => (
                            <li key={c.id} className="pt-1 flex justify-between">
                              <span className="truncate max-w-[160px]">• {c.productName}</span>
                              <span className="font-mono">{c.quantity} ชิ้น</span>
                            </li>
                          ))}
                          {suppClaims.length > 3 && (
                            <li className="pt-1 text-slate-400 italic text-[10px]">
                              + อีก {suppClaims.length - 3} รายการ...
                            </li>
                          )}
                        </ul>
                      </div>

                      <Button
                        type="button"
                        onClick={() => handleOpenCreate(supp.id)}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-9 text-xs rounded-xl shadow-xs gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>รวมส่งคืนบริษัทนี้ (ออกใบลดหนี้)</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 3: PAYABLE POS */}
        <TabsContent value="payable_pos" className="space-y-4 m-0">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-2xs space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                ใบสั่งซื้อ (PO) ที่มียอดค้างชำระ / รอหักลดหนี้
              </h3>
              <p className="text-xs text-slate-500">
                คลิก &quot;ทำใบลดหนี้ให้ใบสั่งซื้อนี้&quot; เพื่อเลือกสินค้าส่งคืนและหักลดยอดหนี้ของใบ PO นั้นๆ
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pos
                .filter((p) => p.status !== 'CANCELLED' && p.status !== 'DRAFT')
                .map((po) => {
                  const total = Number(po.totalAmount || 0);
                  const deducted = (po.deductedReturns || []).reduce(
                    (s: number, r: any) => s + Number(r.amount || 0),
                    0
                  );
                  const remaining = Math.max(0, total - deducted);
                  if (remaining <= 0) return null;

                  return (
                    <div
                      key={po.id}
                      className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="font-mono font-bold text-slate-900 text-sm">
                            {po.poNumber}
                          </span>
                          <Badge className="bg-amber-100 text-amber-800 text-[10px] font-bold border-amber-300">
                            ค้างชำระ {formatCurrency(remaining)}
                          </Badge>
                        </div>
                        <p className="text-xs font-bold text-slate-700">{po.supplierName || po.supplier?.name}</p>
                        <div className="text-[11px] text-slate-500 flex justify-between">
                          <span>ยอดบิลรวม: {formatCurrency(total)}</span>
                          <span>หักลดหนี้แล้ว: -{formatCurrency(deducted)}</span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          รวมสินค้า {po.items?.length || 0} รายการ
                        </p>
                      </div>

                      <Button
                        type="button"
                        onClick={() => handleOpenCreate(po.supplierId || po.supplier?.id, po.id)}
                        className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold h-9 text-xs rounded-xl shadow-xs gap-1.5"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        <span>ส่งคืนสินค้าเพื่อลดหนี้ใบ PO นี้</span>
                      </Button>
                    </div>
                  );
                })}
            </div>
          </div>
        </TabsContent>

        {/* TAB 4: TRASH / CANCELLED NOTES */}
        <TabsContent value="trash" className="space-y-4 m-0">
          <div className="bg-rose-50/60 p-4 rounded-3xl border border-rose-200 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-sm text-rose-950">ถังขยะเอกสารส่งคืน & ขอลดหนี้ที่ยกเลิกแล้ว</p>
                <p className="text-xs text-rose-800">
                  เอกสารในหน้านี้ถูกยกเลิกแล้ว ระบบได้คืนสต็อกสินค้าปกติและคืนสถานะของสินค้าเคลมกลับสู่ระบบเรียบร้อยแล้ว
                </p>
              </div>
            </div>
            <Badge variant="outline" className="bg-white border-rose-300 text-rose-800 font-bold self-start sm:self-auto">
              ทั้งหมด {cancelledNotes.length} ฉบับ
            </Badge>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
            {filteredCancelledNotes.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Trash2 className="w-10 h-10 text-slate-300 mx-auto" />
                <p className="font-bold text-slate-600">ไม่มีเอกสารในถังขยะ</p>
                <p className="text-xs text-slate-400">เมื่อมีการยกเลิกใบส่งคืน เอกสารจะถูกย้ายมาเก็บไว้ที่นี่</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3.5 text-left">เลขที่เอกสาร / วันที่</th>
                      <th className="p-3.5 text-left">บริษัทผู้จำหน่าย</th>
                      <th className="p-3.5 text-left">รายการสินค้าที่เคยส่งคืน</th>
                      <th className="p-3.5 text-left">อ้างอิงใบ PO</th>
                      <th className="p-3.5 text-right">มูลค่าที่เคยขอลดหนี้</th>
                      <th className="p-3.5 text-center">สถานะเอกสาร</th>
                      <th className="p-3.5 text-center w-36">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCancelledNotes.map((note) => (
                      <tr key={note.id} className="bg-slate-50/40 hover:bg-slate-100/50 transition-colors opacity-80 hover:opacity-100">
                        <td className="p-3.5">
                          <span className="font-mono font-bold text-slate-600 line-through block">
                            {note.id}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(note.returnDate).toLocaleDateString('th-TH')}
                          </span>
                        </td>

                        <td className="p-3.5 font-bold text-slate-700">
                          {note.supplierName}
                        </td>

                        <td className="p-3.5 text-slate-500">
                          <p className="truncate max-w-xs">{note.items.map((i) => i.productName).join(', ')}</p>
                          <span className="text-[10px] text-slate-400">รวม {note.items.length} รายการ</span>
                        </td>

                        <td className="p-3.5">
                          {note.linkedPoNumber ? (
                            <span className="font-mono text-slate-500 line-through">
                              {note.linkedPoNumber}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="p-3.5 text-right font-mono">
                          <span className="line-through text-slate-400 font-bold block text-xs">
                            {formatCurrency(note.totalCreditAmount)}
                          </span>
                          <span className="text-[10px] text-rose-600 font-bold">
                            ยกเลิกแล้ว (ไม่มีเครดิต)
                          </span>
                        </td>

                        <td className="p-3.5 text-center">
                          <Badge className="bg-rose-100 text-rose-800 border-rose-200 font-bold text-[11px]">
                            ❌ ยกเลิกเอกสารแล้ว
                          </Badge>
                        </td>

                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewPdf(note)}
                              className="h-8 px-2 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-100 font-bold text-xs gap-1"
                              title="ดูเอกสารฉบับนี้"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>ดูเอกสาร</span>
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRestoreNote(note)}
                              className="h-8 px-2 rounded-xl border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-bold text-xs gap-1"
                              title="กู้คืนเอกสารนี้กลับมาใช้งาน"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>กู้คืน</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Create / Edit Supplier Return Modal */}
      <CreateSupplierReturnModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        initialSupplierId={preselectedSupplierId}
        initialPoId={preselectedPoId}
        editingNote={editingNote}
        onSuccess={(note) => {
          refreshData();
          handleViewPdf(note);
        }}
      />

      {/* Printable PDF Preview Modal */}
      <SupplierReturnPdfModal
        open={isPdfModalOpen}
        onOpenChange={setIsPdfModalOpen}
        returnNote={selectedNoteForPdf}
      />

      {/* Change / Revert Return Note Status Modal */}
      <ChangeReturnStatusModal
        open={isStatusChangeModalOpen}
        onOpenChange={setIsStatusChangeModalOpen}
        returnNote={statusChangeNote}
        onSuccess={refreshData}
      />
    </div>
  );
}
