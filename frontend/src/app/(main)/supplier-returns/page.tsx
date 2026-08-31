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
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <ArrowLeftRight className="w-6 h-6 text-indigo-600 shrink-0" />
            <span>ส่งเคลม & คืนสินค้าบริษัท (Supplier Returns)</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            ทำเอกสารส่งคืนสินค้าชำรุดหรือสินค้าปกติขายไม่ออกเพื่อลดหนี้ใบสั่งซื้อ (PO) แยกตามคู่ค้าผู้จำหน่าย
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshData}
            className="border-slate-200 text-slate-700 hover:bg-slate-50 h-10 px-3.5 text-xs font-semibold shadow-2xs rounded-xl gap-1.5"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>รีเฟรช</span>
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => handleOpenCreate()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-4 rounded-xl shadow-xs gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>สร้างใบส่งคืน / ลดหนี้บริษัท</span>
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Metric 1: Pending Claims */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs sm:text-sm font-bold text-slate-500">สินค้าชำรุดรอส่งเคลม</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
              {pendingClaims.length} <span className="text-xs text-slate-500 font-normal">รายการ</span>
            </div>
            <p className="text-xs text-rose-600 font-bold mt-1">
              มูลค่าต้นทุนรวม: {formatCurrency(totalPendingClaimsCost)}
            </p>
          </CardContent>
        </Card>

        {/* Metric 2: Available Credit */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs sm:text-sm font-bold text-slate-500">เครดิตลดหนี้คงเหลือ</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-black text-indigo-700 font-mono">
              {formatCurrency(totalAvailableCredit)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              พร้อมนำไปหักลบยอดเรียกเก็บของบริษัท
            </p>
          </CardContent>
        </Card>

        {/* Metric 3: Total Return Notes */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs sm:text-sm font-bold text-slate-500">เอกสารส่งคืนทั้งหมด</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
              {returnNotes.filter((n) => n.status !== 'CANCELLED').length} <span className="text-xs text-slate-500 font-normal">ฉบับ</span>
            </div>
            <p className="text-xs text-emerald-700 font-bold mt-1">
              หักลดหนี้สำเร็จแล้ว: {returnNotes.filter((n) => n.status === 'DEDUCTED').length} ฉบับ
            </p>
          </CardContent>
        </Card>

        {/* Metric 4: Cancelled Notes in Trash */}
        <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs sm:text-sm font-bold text-slate-500">เอกสารในถังขยะ</CardTitle>
            <div className="w-8 h-8 rounded-xl bg-slate-50 text-slate-500 border border-slate-200 flex items-center justify-center">
              <Trash2 className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-black text-slate-700 font-mono">
              {cancelledNotes.length} <span className="text-xs text-slate-500 font-normal">ฉบับ</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              เอกสารส่งคืนที่ถูกยกเลิกแล้ว
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="return_notes" className="w-full space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <TabsList className="bg-slate-100 p-1 rounded-xl h-10">
            <TabsTrigger
              value="return_notes"
              className="rounded-lg font-bold text-xs sm:text-sm data-[state=active]:bg-white data-[state=active]:shadow-xs px-4"
            >
              เอกสารส่งคืน & ใบลดหนี้ ({activeNotes.length})
            </TabsTrigger>
            <TabsTrigger
              value="pending_claims"
              className="rounded-lg font-bold text-xs sm:text-sm data-[state=active]:bg-white data-[state=active]:shadow-xs px-4 gap-1.5"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              <span>รอส่งเคลมบริษัท ({pendingClaims.length})</span>
            </TabsTrigger>
            <TabsTrigger
              value="trash"
              className="rounded-lg font-bold text-xs sm:text-sm data-[state=active]:bg-white data-[state=active]:text-rose-700 data-[state=active]:shadow-xs px-4 gap-1.5 text-slate-500 hover:text-rose-600"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
              <span>ถังขยะ / ยกเลิกแล้ว ({cancelledNotes.length})</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* TAB 1: RETURN NOTES */}
        <TabsContent value="return_notes" className="space-y-4 m-0">
          {/* Filters Bar */}
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <Input
                type="text"
                placeholder="ค้นหาเลขที่เอกสาร, บริษัทผู้จำหน่าย, ใบสั่งซื้อ PO หรือชื่อสินค้า..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-10 text-xs sm:text-sm bg-slate-50 border-slate-200 rounded-xl"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                value={selectedSupplierFilter}
                onChange={(e) => setSelectedSupplierFilter(e.target.value)}
                className="h-10 px-3 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 w-full md:w-56"
              >
                <option value="ALL">🏢 ผู้จำหน่ายทั้งหมด</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 px-3 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 w-full md:w-40"
              >
                <option value="ALL">ทุกสถานะที่ใช้งาน</option>
                <option value="PENDING">รอหักลดหนี้</option>
                <option value="DEDUCTED">หักลดหนี้แล้ว</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            {filteredNotes.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-3">
                <FileText className="w-12 h-12 text-slate-300 mx-auto" />
                <p className="text-base font-bold text-slate-700">ไม่พบเอกสารส่งคืนสินค้า</p>
                <p className="text-xs sm:text-sm text-slate-400">
                  คลิกที่ปุ่ม &quot;สร้างใบส่งคืน / ลดหนี้บริษัท&quot; ด้านบนเพื่อเริ่มทำรายการ
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-xs sm:text-[13px]">
                    <tr>
                      <th className="py-3.5 px-3.5 text-left">เลขที่เอกสาร / วันที่</th>
                      <th className="py-3.5 px-3.5 text-left">บริษัทผู้จำหน่าย</th>
                      <th className="py-3.5 px-3.5 text-left">หมวดหมู่ & รายการสินค้า</th>
                      <th className="py-3.5 px-3.5 text-left">อ้างอิงใบสั่งซื้อ (PO)</th>
                      <th className="py-3.5 px-3.5 text-right">มูลค่าส่งคืน / ขอลดหนี้</th>
                      <th className="py-3.5 px-3.5 text-center">สถานะ</th>
                      <th className="py-3.5 px-3.5 text-center whitespace-nowrap">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredNotes.map((note) => {
                      const defCount = note.items.filter((i) => i.itemType === 'DEFECTIVE').length;
                      const overCount = note.items.filter((i) => i.itemType === 'OVERSTOCK').length;

                      return (
                        <tr key={note.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-3.5 font-mono">
                            <span className="font-bold text-indigo-700 text-sm block">
                              {note.id}
                            </span>
                            <span className="text-xs text-slate-500 block mt-0.5">
                              {new Date(note.returnDate).toLocaleDateString('th-TH', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </td>

                          <td className="py-3 px-3.5">
                            <p className="font-bold text-slate-900 text-sm">{note.supplierName}</p>
                            {note.supplierPhone && (
                              <p className="text-xs text-slate-400 font-mono mt-0.5">{note.supplierPhone}</p>
                            )}
                          </td>

                          <td className="py-3 px-3.5">
                            <div className="flex items-center gap-1.5 mb-1">
                              {defCount > 0 && (
                                <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-xs font-semibold px-2 py-0.5 rounded-md">
                                  ชำรุด {defCount} รายการ
                                </Badge>
                              )}
                              {overCount > 0 && (
                                <Badge className="bg-sky-50 text-sky-700 border-sky-200 text-xs font-semibold px-2 py-0.5 rounded-md">
                                  สินค้าปกติ {overCount} รายการ
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-600 truncate max-w-xs">
                              {note.items.map((i) => i.productName).join(', ')}
                            </p>
                          </td>

                          <td className="py-3 px-3.5">
                            {note.linkedPoNumber ? (
                              <span className="font-mono font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-xs sm:text-sm">
                                {note.linkedPoNumber}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">- ถือเป็นเครดิต -</span>
                            )}
                          </td>

                          <td className="py-3 px-3.5 text-right font-mono">
                            <span className="font-black text-slate-900 text-sm sm:text-base block">
                              {formatCurrency(note.totalCreditAmount)}
                            </span>
                            {note.status === 'DEDUCTED' ? (
                              <span className="text-xs text-emerald-600 font-semibold block mt-0.5">
                                ✓ หักลดหนี้ครบแล้ว
                              </span>
                            ) : note.remainingCreditAmount < note.totalCreditAmount && note.remainingCreditAmount > 0 ? (
                              <span className="text-xs text-sky-600 font-semibold block mt-0.5">
                                คงเหลือ {formatCurrency(note.remainingCreditAmount)}
                              </span>
                            ) : (
                              <span className="text-xs text-amber-700 font-semibold block mt-0.5">
                                รอประกบหัก
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-3.5 text-center">
                            {note.status === 'DEDUCTED' ? (
                              <Badge className="bg-emerald-600 text-white font-semibold text-xs px-2.5 py-0.5">หักลดหนี้แล้ว</Badge>
                            ) : note.status === 'PARTIALLY_DEDUCTED' ? (
                              <Badge className="bg-sky-600 text-white font-semibold text-xs px-2.5 py-0.5">หักหนี้บางส่วน</Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-50 font-semibold text-xs px-2.5 py-0.5">
                                รอหักลดหนี้
                              </Badge>
                            )}
                          </td>

                          <td className="py-3 px-3.5 text-center">
                            <div className="flex items-center justify-center gap-1 flex-nowrap whitespace-nowrap">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleViewPdf(note)}
                                className="h-8 px-2.5 rounded-xl border-slate-200 hover:border-indigo-300 hover:text-indigo-600 font-bold text-xs gap-1 shrink-0"
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
                                  className="h-8 px-2 rounded-xl border-slate-200 hover:border-amber-400 hover:text-amber-700 font-bold text-xs gap-1 shrink-0"
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
                                className="h-8 w-8 p-0 rounded-xl border-slate-200 hover:border-sky-400 hover:text-sky-700 font-bold text-xs shrink-0"
                                title="เปลี่ยน / ย้อนสถานะเอกสาร"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </Button>

                              {note.status !== 'CANCELLED' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleCancelNote(note)}
                                  className="h-8 w-8 p-0 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
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
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  รายการเคลมสินค้าชำรุดที่ค้างส่งคืนบริษัทผู้จำหน่าย
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  สินค้าที่ลูกค้านำมาเคลมและเลือกส่งเคลมประกัน สามารถรวมส่งคืนบริษัทเพื่อออกใบลดหนี้ได้ทันที
                </p>
              </div>
            </div>

            {pendingClaims.length === 0 ? (
              <div className="p-8 text-center text-slate-400 space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                <p className="font-bold text-slate-700">ไม่มีสินค้าชำรุดค้างส่งคืน</p>
                <p className="text-xs sm:text-sm text-slate-400">รายการเคลมทั้งหมดถูกส่งคืนบริษัทเรียบร้อยแล้ว</p>
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
                      className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between space-y-3"
                    >
                      <div>
                        <div className="flex justify-between items-start">
                          <p className="font-bold text-slate-900 text-sm truncate">{supp.name}</p>
                          <Badge className="bg-rose-100 text-rose-800 text-xs font-semibold border-rose-200 px-2 py-0.5">
                            {suppClaims.length} รายการ
                          </Badge>
                        </div>
                        <p className="text-xs sm:text-sm text-slate-500 mt-1">
                          มูลค่ารวม: <strong className="text-rose-700 font-mono text-sm">{formatCurrency(totalVal)}</strong>
                        </p>
                        <ul className="text-xs text-slate-600 mt-2.5 space-y-1 divide-y divide-slate-200">
                          {suppClaims.slice(0, 3).map((c) => (
                            <li key={c.id} className="pt-1.5 flex justify-between">
                              <span className="truncate max-w-[160px]">• {c.productName}</span>
                              <span className="font-mono font-semibold">{c.quantity} ชิ้น</span>
                            </li>
                          ))}
                          {suppClaims.length > 3 && (
                            <li className="pt-1.5 text-slate-400 italic text-xs">
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

        {/* TAB 3: TRASH / CANCELLED NOTES */}
        <TabsContent value="trash" className="space-y-4 m-0">
          <div className="bg-rose-50/70 p-4 rounded-2xl border border-rose-200 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-sm text-rose-950">ถังขยะเอกสารส่งคืน & ขอลดหนี้ที่ยกเลิกแล้ว</p>
                <p className="text-xs text-rose-800">
                  เอกสารในหน้านี้ถูกยกเลิกแล้ว ระบบได้คืนสต็อกสินค้าปกติและคืนสถานะของสินค้าเคลมกลับสู่ระบบเรียบร้อยแล้ว
                </p>
              </div>
            </div>
            <Badge variant="outline" className="bg-white border-rose-300 text-rose-800 font-bold self-start sm:self-auto text-xs">
              ทั้งหมด {cancelledNotes.length} ฉบับ
            </Badge>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            {filteredCancelledNotes.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Trash2 className="w-10 h-10 text-slate-300 mx-auto" />
                <p className="font-bold text-slate-600 text-base">ไม่มีเอกสารในถังขยะ</p>
                <p className="text-xs sm:text-sm text-slate-400">เมื่อมีการยกเลิกใบส่งคืน เอกสารจะถูกย้ายมาเก็บไว้ที่นี่</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold text-xs sm:text-[13px]">
                    <tr>
                      <th className="py-3.5 px-3.5 text-left">เลขที่เอกสาร / วันที่</th>
                      <th className="py-3.5 px-3.5 text-left">บริษัทผู้จำหน่าย</th>
                      <th className="py-3.5 px-3.5 text-left">รายการสินค้าที่เคยส่งคืน</th>
                      <th className="py-3.5 px-3.5 text-left">อ้างอิงใบ PO</th>
                      <th className="py-3.5 px-3.5 text-right">มูลค่าที่เคยขอลดหนี้</th>
                      <th className="py-3.5 px-3.5 text-center">สถานะเอกสาร</th>
                      <th className="py-3.5 px-3.5 text-center whitespace-nowrap">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCancelledNotes.map((note) => (
                      <tr key={note.id} className="bg-slate-50/40 hover:bg-slate-100/50 transition-colors opacity-80 hover:opacity-100">
                        <td className="py-3 px-3.5 font-mono">
                          <span className="font-bold text-slate-600 line-through text-sm block">
                            {note.id}
                          </span>
                          <span className="text-xs text-slate-400 block mt-0.5">
                            {new Date(note.returnDate).toLocaleDateString('th-TH')}
                          </span>
                        </td>

                        <td className="py-3 px-3.5 font-bold text-slate-700 text-sm">
                          {note.supplierName}
                        </td>

                        <td className="py-3 px-3.5 text-slate-500">
                          <p className="truncate max-w-xs text-xs sm:text-[13px]">{note.items.map((i) => i.productName).join(', ')}</p>
                          <span className="text-xs text-slate-400 block mt-0.5">รวม {note.items.length} รายการ</span>
                        </td>

                        <td className="py-3 px-3.5">
                          {note.linkedPoNumber ? (
                            <span className="font-mono text-slate-500 line-through text-xs sm:text-sm">
                              {note.linkedPoNumber}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">-</span>
                          )}
                        </td>

                        <td className="py-3 px-3.5 text-right font-mono">
                          <span className="line-through text-slate-400 font-bold block text-sm">
                            {formatCurrency(note.totalCreditAmount)}
                          </span>
                          <span className="text-xs text-rose-600 font-semibold block mt-0.5">
                            ยกเลิกแล้ว (ไม่มีเครดิต)
                          </span>
                        </td>

                        <td className="py-3 px-3.5 text-center">
                          <Badge className="bg-rose-100 text-rose-800 border-rose-200 font-semibold text-xs px-2.5 py-0.5">
                            ❌ ยกเลิกเอกสารแล้ว
                          </Badge>
                        </td>

                        <td className="py-3 px-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5 flex-nowrap whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewPdf(note)}
                              className="h-8 px-2.5 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-100 font-bold text-xs gap-1 shrink-0"
                              title="ดูเอกสารฉบับนี้"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>ดูเอกสาร</span>
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRestoreNote(note)}
                              className="h-8 px-2.5 rounded-xl border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-bold text-xs gap-1 shrink-0"
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
