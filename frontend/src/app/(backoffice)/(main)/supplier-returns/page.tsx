'use client';

import { ROW_NAV_CLASS, useRowNav } from "@/lib/use-row-nav";
import { useState, useEffect } from 'react';
import { 
  Building2, Plus, Search, Filter, FileText, Download, Printer, 
  Trash2, ShieldAlert, Package, CheckCircle2, Clock, AlertCircle, 
  Receipt, ArrowLeftRight, ChevronRight, Eye, RefreshCw, XCircle, Pencil, RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusChip } from '@/components/ui/status-chip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatCurrency, formatListDate } from '@/lib/utils';
import { toast } from 'sonner';
import { LoadErrorState, errorMessage } from '@/components/common/LoadErrorState';
import { 
  loadSuppliers,
  fetchSuppliers, 
  loadSupplierReturnNotes,
  fetchSupplierReturnNotes,
  fetchReturnableSummary,
  type ReturnableSupplierGroup,
  cancelSupplierReturnNote,
  restoreSupplierReturnNote
} from '@/lib/supplier-return-service';
import { SupplierReturnNote } from '@/lib/types';
import { CreateSupplierReturnModal } from '@/components/supplier-returns/CreateSupplierReturnModal';
import { SupplierReturnPdfModal } from '@/components/supplier-returns/SupplierReturnPdfModal';
import { ChangeReturnStatusModal } from '@/components/supplier-returns/ChangeReturnStatusModal';
import { askConfirm } from '@/lib/ask-dialog';

export default function SupplierReturnsPage() {
  const [returnNotes, setReturnNotes] = useState<SupplierReturnNote[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  // claims waiting to go back to a supplier: count / value and the cards per supplier (server, every claim)
  const [pending, setPending] = useState<{ total: number; totalCostValue: number; bySupplier: Map<string, ReturnableSupplierGroup> }>(
    { total: 0, totalCostValue: 0, bySupplier: new Map() },
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  /** Loads the data; state is only updated after the request. */
  const loadData = async () => {
    try {
      const [notes, supps, summary] = await Promise.all([
        fetchSupplierReturnNotes(),
        fetchSuppliers(),
        // every claim that can still go back to a supplier, grouped by its supplier on the server
        // (supplier / cost resolved there with the rule this page used; was every claim downloaded and matched here)
        fetchReturnableSummary(),
      ]);
      setReturnNotes(notes);
      setSuppliers(supps);
      setPending({ total: summary.total, totalCostValue: summary.totalCostValue, bySupplier: new Map(summary.suppliers.map((g) => [g.supplierId, g])) });
      setLoadError(null);
    } catch (e) {
      console.error('Failed to load supplier returns data:', e);
      setReturnNotes([]);
      setSuppliers([]);
      setPending({ total: 0, totalCostValue: 0, bySupplier: new Map() });
      setLoadError(errorMessage(e, 'ติดต่อเซิร์ฟเวอร์ไม่ได้'));
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    setLoading(true);
    await loadData();
  };

  useEffect(() => {
    const run = async () => { await loadData(); };
    void run();
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
  const handleCancelNote = async (note: SupplierReturnNote) => {
    if (!(await askConfirm({ title: `คุณต้องการยกเลิกเอกสารส่งคืน ${note.id} หรือไม่?`, description: 'ระบบจะคืนสต็อกสินค้าปกติและคืนสถานะรายการเคลมให้', confirmLabel: 'ยกเลิกเอกสาร', cancelLabel: 'ไม่ยกเลิก', danger: true }))) {
      return;
    }

    const res = await cancelSupplierReturnNote(note.id);
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
  };

  // Restore return note from trash
  const handleRestoreNote = async (note: SupplierReturnNote) => {
    if (!(await askConfirm({ title: `คุณต้องการกู้คืนเอกสารส่งคืน ${note.id} ออกจากถังขยะหรือไม่?`, confirmLabel: 'กู้คืน' }))) {
      return;
    }

    const res = await restoreSupplierReturnNote(note.id);
    if (res.success) {
      toast.success(res.message);
      refreshData();
    } else {
      toast.error(res.message);
    }
  };

  // Calculations for Metrics
  const totalPendingClaimsCost = pending.totalCostValue;

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
      (note.items || []).some((i) => (i.productName || '').toLowerCase().includes(search.toLowerCase()));

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
      (note.items || []).some((i) => (i.productName || '').toLowerCase().includes(search.toLowerCase()));

    const matchesSupplier =
      selectedSupplierFilter === 'ALL' || note.supplierId === selectedSupplierFilter;

    return matchesSearch && matchesSupplier;
  });

  const noteNav = useRowNav(filteredNotes.length, (i) => handleViewPdf(filteredNotes[i]));
  return (
    <div className="page-shell">
      {loadError && <LoadErrorState message={loadError} onRetry={() => void refreshData()} retrying={loading} />}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="page-title">
            <ArrowLeftRight />
            <span>ส่งเคลม & คืนสินค้าบริษัท (Supplier Returns)</span>
          </h1>
          <p className="page-subtitle">
            ทำเอกสารส่งคืนสินค้าชำรุดหรือสินค้าปกติขายไม่ออกเพื่อลดหนี้ใบสั่งซื้อ (PO) แยกตามคู่ค้าผู้จำหน่าย
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={refreshData}
            className="border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>รีเฟรช</span>
          </Button>

          <Button
            type="button"
            onClick={() => handleOpenCreate()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>สร้างใบส่งคืน / ลดหนี้บริษัท</span>
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Metric 1: Pending Claims */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-rose-950">รอส่งเคลมบริษัท:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-rose-600 tracking-tight">
              {pending.total}
            </span>
            <span className="text-xs text-rose-700 font-sans font-bold">รายการ</span>
          </div>
        </div>

        {/* Metric 2: Available Credit */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-indigo-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-indigo-950">เครดิตลดหนี้คงเหลือ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-indigo-700 tracking-tight">
              {formatCurrency(totalAvailableCredit)}
            </span>
          </div>
        </div>

        {/* Metric 3: Total Return Notes */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-emerald-950">เอกสารส่งคืนทั้งหมด:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-emerald-700 tracking-tight">
              {returnNotes.filter((n) => n.status !== 'CANCELLED').length}
            </span>
            <span className="text-xs text-slate-600 font-sans font-bold">ฉบับ</span>
          </div>
        </div>

        {/* Metric 4: Cancelled Notes in Trash */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-slate-100 text-slate-600 rounded-md border border-slate-200 shrink-0">
              <Trash2 className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-slate-700">เอกสารในถังขยะ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg sm:text-xl font-semibold text-slate-700 tracking-tight">
              {cancelledNotes.length}
            </span>
            <span className="text-xs text-slate-500 font-sans font-bold">ฉบับ</span>
          </div>
        </div>
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
              <span>รอส่งเคลมบริษัท ({pending.total})</span>
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
                className="pl-10 sm:text-sm bg-slate-50 border-slate-200"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                value={selectedSupplierFilter}
                onChange={(e) => setSelectedSupplierFilter(e.target.value)}
                className="h-10 px-3 text-sm sm:text-sm bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 w-full md:w-56"
              >
                <option value="ALL">ผู้จำหน่ายทั้งหมด</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 px-3 text-sm sm:text-sm bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 w-full md:w-40"
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
              <div className="tbl-wrap overflow-x-auto">
                <table className="tbl w-full text-sm">
                  <thead >
                    <tr>
                      <th data-narrow="hide" className="text-center w-10">#</th>
                      <th className="text-left">เลขที่เอกสาร</th>
                      <th className="text-center">วันที่ส่งคืน</th>
                      <th className="text-left min-w-40 xl:min-w-48">บริษัทผู้จำหน่าย</th>
                      <th data-narrow="hide" className="text-center">อ้างอิง PO</th>
                      <th className="text-right">มูลค่าขอลดหนี้</th>
                      <th className="text-center">สถานะ</th>
                      <th className="text-right">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100" {...noteNav.bodyProps}>
                    {filteredNotes.map((note, idx) => {
                      return (
                        <tr key={note.id} className={`hover:bg-slate-50/70 transition-colors ${ROW_NAV_CLASS}`} {...noteNav.rowProps(idx)}>
                        <td data-narrow="hide" className="text-center doc-no whitespace-nowrap font-medium text-muted-foreground">
                          {idx + 1}
                        </td>

                        <td className="doc-no whitespace-nowrap">
                          <span className="doc-no text-fg block">
                            {note.id}
                          </span>
                        </td>

                        <td data-narrow="wrap" className="text-center doc-no whitespace-nowrap text-muted-foreground">
                          {formatListDate(note.returnDate)}
                        </td>

                        <td >
                          <p className="font-medium text-fg line-clamp-2 break-words" title={note.supplierName}>{note.supplierName}</p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                            {note.supplierPhone && (
                              <span className="text-sub text-subtle doc-no">{note.supplierPhone}</span>
                            )}
                            <span className="text-sub font-medium text-muted-foreground whitespace-nowrap">
                              รวม {note.items?.length ?? note.totalQuantity ?? 0} รายการ
                            </span>
                          </div>
                        </td>

                        <td data-narrow="hide" className="text-center whitespace-nowrap">
                          {note.linkedPoNumber ? (
                            <span className="doc-no font-medium text-warn text-sub">
                              {note.linkedPoNumber}
                            </span>
                          ) : (
                            <span className="text-subtle text-sub">ถือเป็นเครดิต</span>
                          )}
                        </td>

                        <td className="text-right tabular-nums whitespace-nowrap">
                          <span className="font-medium text-fg block">
                            {formatCurrency(note.totalCreditAmount)}
                          </span>
                          {note.status === 'DEDUCTED' ? (
                            <span className="text-sub text-ok font-medium block mt-0.5">
                              ✓ หักลดหนี้ครบแล้ว
                            </span>
                          ) : note.remainingCreditAmount < note.totalCreditAmount && note.remainingCreditAmount > 0 ? (
                            <span className="text-sub text-sky-600 font-medium block mt-0.5">
                              คงเหลือ {formatCurrency(note.remainingCreditAmount)}
                            </span>
                          ) : (
                            <span className="text-sub text-warn font-medium block mt-0.5">
                              รอประกบหัก
                            </span>
                          )}
                        </td>

                        <td className="text-center">
                          {note.status === 'DEDUCTED' ? (
                            <StatusChip tone="success">หักลดหนี้แล้ว</StatusChip>
                          ) : note.status === 'PARTIALLY_DEDUCTED' ? (
                            <StatusChip tone="info">หักหนี้บางส่วน</StatusChip>
                          ) : (
                            <StatusChip tone="warning">
                              รอหักลดหนี้
                            </StatusChip>
                          )}
                        </td>

                          <td className="w-px whitespace-nowrap">
                            <div className="flex flex-nowrap items-center justify-end gap-btn">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleViewPdf(note)}
                                className="border-slate-200 hover:border-indigo-300 hover:text-indigo-600 text-sub gap-1 shrink-0"
                                title="ดูเอกสาร / พิมพ์"
                                aria-label="ดู"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span data-act-label>ดู</span>
                              </Button>

                              {note.status !== 'DEDUCTED' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleEditNote(note)}
                                  className="border-slate-200 hover:border-amber-400 hover:text-warn text-sub gap-1 shrink-0"
                                  title="แก้ไขเอกสารส่งคืน"
                                  aria-label="แก้ไข"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  <span data-act-label>แก้ไข</span>
                                </Button>
                              )}

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenChangeStatus(note)}
                                className="h-8 w-8 p-0 border-slate-200 hover:border-sky-400 hover:text-sky-700 text-sub shrink-0"
                                title="เปลี่ยน / ย้อนสถานะเอกสาร"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </Button>

                              {note.status !== 'CANCELLED' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleCancelNote(note)}
                                  className="h-8 w-8 p-0 text-subtle hover:text-danger hover:bg-rose-50 transition-colors shrink-0"
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

            {pending.total === 0 ? (
              <div className="p-8 text-center text-slate-400 space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                <p className="font-bold text-slate-700">ไม่มีสินค้าชำรุดค้างส่งคืน</p>
                <p className="text-xs sm:text-sm text-slate-400">รายการเคลมทั้งหมดถูกส่งคืนบริษัทเรียบร้อยแล้ว</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {suppliers.map((supp) => {
                  const group = pending.bySupplier.get(supp.id);
                  if (!group || group.count === 0) return null;
                  const totalVal = group.totalCostValue;

                  return (
                    <div
                      key={supp.id}
                      className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between space-y-3"
                    >
                      <div>
                        <div className="flex justify-between items-start">
                          <p className="font-bold text-slate-900 text-sm truncate">{supp.name}</p>
                          <Badge className="bg-rose-100 text-rose-800 text-xs font-semibold border-rose-200 px-2 py-0.5">
                            {group.count} รายการ
                          </Badge>
                        </div>
                        <p className="text-xs sm:text-sm text-slate-500 mt-1">
                          มูลค่ารวม: <strong className="text-rose-700 tabular-nums text-sm">{formatCurrency(totalVal)}</strong>
                        </p>
                        <ul className="text-xs text-slate-600 mt-2.5 space-y-1 divide-y divide-slate-200">
                          {group.top.map((c) => (
                            <li key={c.id} className="pt-1.5 flex justify-between">
                              <span className="truncate max-w-[160px]">• {c.productName}</span>
                              <span className="tabular-nums font-semibold">{c.quantity} ชิ้น</span>
                            </li>
                          ))}
                          {group.count > 3 && (
                            <li className="pt-1.5 text-slate-400 italic text-xs">
                              + อีก {group.count - 3} รายการ...
                            </li>
                          )}
                        </ul>
                      </div>

                      <Button
                        type="button"
                        onClick={() => handleOpenCreate(supp.id)}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
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
              <div className="tbl-wrap overflow-x-auto">
                <table className="tbl w-full text-sm">
                  <thead >
                    <tr>
                      <th className="text-center w-10">#</th>
                      <th className="text-left">เลขที่เอกสาร</th>
                      <th className="text-center">วันที่ส่งคืน</th>
                      <th className="text-left min-w-40 xl:min-w-48">บริษัทผู้จำหน่าย</th>
                      <th className="text-center">อ้างอิง PO</th>
                      <th className="text-right">มูลค่าที่เคยขอลดหนี้</th>
                      <th className="text-center">สถานะเอกสาร</th>
                      <th className="text-right">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCancelledNotes.map((note, idx) => (
                      <tr key={note.id} className="bg-slate-50/40 hover:bg-slate-100/50 transition-colors opacity-80 hover:opacity-100">
                        <td className="text-center doc-no whitespace-nowrap font-medium text-muted-foreground">
                          {idx + 1}
                        </td>

                        <td className="doc-no whitespace-nowrap">
                          <span className="font-medium text-muted-foreground line-through block">
                            {note.id}
                          </span>
                        </td>

                        <td className="text-center doc-no whitespace-nowrap text-muted-foreground">
                          {formatListDate(note.returnDate)}
                        </td>

                        <td >
                          <p className="font-medium text-fg line-clamp-2 break-words" title={note.supplierName}>{note.supplierName}</p>
                          <span className="text-sub font-medium text-muted-foreground bg-slate-200/60 px-2 py-0.5 rounded-md mt-0.5 inline-block">
                            รวม {note.items?.length ?? note.totalQuantity ?? 0} รายการ
                          </span>
                        </td>

                        <td className="text-center">
                          {note.linkedPoNumber ? (
                            <span className="doc-no text-muted-foreground line-through">
                              {note.linkedPoNumber}
                            </span>
                          ) : (
                            <span className="text-subtle text-sub">-</span>
                          )}
                        </td>

                        <td className="text-right tabular-nums whitespace-nowrap">
                          <span className="line-through text-subtle font-medium block">
                            {formatCurrency(note.totalCreditAmount)}
                          </span>
                          <span className="text-sub text-danger font-medium block mt-0.5">
                            ยกเลิกแล้ว (ไม่มีเครดิต)
                          </span>
                        </td>

                        <td className="text-center">
                          <StatusChip tone="danger">
                            ยกเลิกเอกสารแล้ว
                          </StatusChip>
                        </td>

                        <td className="w-px whitespace-nowrap">
                          <div className="flex items-center justify-end gap-btn flex-nowrap whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewPdf(note)}
                              className="border-slate-200 text-fg hover:bg-slate-100 text-sub gap-1 shrink-0"
                              title="ดูเอกสารฉบับนี้"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>ดูเอกสาร</span>
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRestoreNote(note)}
                              className="border-emerald-300 text-ok hover:bg-emerald-50 text-sub gap-1 shrink-0"
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
        onNoteChange={() => void refreshData()}
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
