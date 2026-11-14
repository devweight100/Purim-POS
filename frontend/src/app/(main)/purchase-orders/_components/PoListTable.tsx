import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, CheckCircle, PackageOpen, Pencil, Ban, RotateCcw } from 'lucide-react';
import { LoadErrorState } from '@/components/common/LoadErrorState';
import type { PurchaseOrder } from './po-shared';
import { poStatusBadge } from './PoStatusBadge';

type PoAction = (po: PurchaseOrder, e?: React.MouseEvent) => void;

interface Props {
  /** POs per status over every PO (server counts), ALL = total */
  statusCounts: Record<string, number>;
  page: number;
  setPage: (page: number) => void;
  total: number;
  pageSize: number;
  filteredPOs: PurchaseOrder[];
  loading: boolean;
  loadError: string | null;
  setStatusFilter: (status: string) => void;
  fetchPOs: () => Promise<void>;
  handleViewDetail: (id: string, mode?: 'detail' | 'pdf') => void;
  openEditDialog: PoAction;
  openIssueConfirmDialog: PoAction;
  openReceiveDialog: PoAction;
  openStatusChangeDialog: PoAction;
  openCancelDialog: PoAction;
}

/** Status tabs + table of purchase orders. */
export function PoListTable({
  statusCounts, page, setPage, total, pageSize, filteredPOs, loading, loadError, setStatusFilter, fetchPOs, handleViewDetail,
  openEditDialog, openIssueConfirmDialog, openReceiveDialog, openStatusChangeDialog, openCancelDialog,
}: Props) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
        <Tabs defaultValue="ALL" onValueChange={setStatusFilter}>
          <TabsList className="bg-slate-100 border border-slate-200">
            <TabsTrigger value="ALL" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">ทั้งหมด ({statusCounts.ALL || 0})</TabsTrigger>
            <TabsTrigger value="DRAFT" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
              DRAFT ({statusCounts.DRAFT || 0})
            </TabsTrigger>
            <TabsTrigger value="ISSUED" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
              ISSUED ({statusCounts.ISSUED || 0})
            </TabsTrigger>
            <TabsTrigger value="PARTIALLY_RECEIVED" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
              PARTIAL ({statusCounts.PARTIALLY_RECEIVED || 0})
            </TabsTrigger>
            <TabsTrigger value="COMPLETED" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
              COMPLETED ({statusCounts.COMPLETED || 0})
            </TabsTrigger>
            <TabsTrigger value="CANCELLED" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
              CANCELLED ({statusCounts.CANCELLED || 0})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-50 border-b border-slate-200">
            <TableRow className="border-slate-200 hover:bg-transparent">
              <TableHead className="text-slate-700 font-bold text-sm text-center w-16">ลำดับ</TableHead>
              <TableHead className="text-slate-700 font-bold text-sm w-36">เลข PO</TableHead>
              <TableHead className="text-slate-700 font-bold text-sm">ผู้จำหน่าย</TableHead>
              <TableHead className="text-slate-700 font-bold text-sm text-center w-36">วันที่สร้าง</TableHead>
              <TableHead className="text-slate-700 font-bold text-sm text-right">ยอดรวมสุทธิ</TableHead>
              <TableHead className="text-slate-700 font-bold text-sm text-center">สถานะ</TableHead>
              <TableHead className="text-slate-700 font-bold text-sm text-center">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-32 text-slate-500 text-sm">
                  กำลังโหลดข้อมูล...
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <LoadErrorState message={loadError} onRetry={() => void fetchPOs()} />
                </TableCell>
              </TableRow>
            ) : filteredPOs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-32 text-slate-500 text-sm">
                  ไม่พบข้อมูลใบสั่งซื้อ
                </TableCell>
              </TableRow>
            ) : (
              filteredPOs.map((po, idx) => (
                <TableRow key={po.id} className="border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => handleViewDetail(po.id)}>
                  <TableCell className="py-3.5 px-3.5 text-center font-mono font-bold text-slate-500 text-sm">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="font-bold text-slate-900 text-[15px] font-mono">{po.poNumber}</TableCell>
                  <TableCell className="text-slate-900 font-bold text-[15px]">{po.supplier?.name || po.supplierName || "-"}</TableCell>
                  <TableCell className="text-slate-600 text-center font-mono text-xs">{formatDate(po.createdAt)}</TableCell>
                  <TableCell className="text-right text-slate-900 font-black text-[15px] sm:text-base font-mono">
                    <div>{formatCurrency(po.totalAmount)}</div>
                    {po.deductedReturns && po.deductedReturns.length > 0 && (
                      <div className="text-[10.5px] text-emerald-700 font-normal mt-0.5">
                        <span className="bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded font-bold">
                          หักเคลม -{formatCurrency(po.deductedReturns.reduce((s: number, r) => s + Number(r.amount || 0), 0))}
                        </span>
                        <span className="font-black block text-slate-900 font-mono mt-0.5">
                          จ่ายจริง {formatCurrency(po.netAmountPayable ?? (po.totalAmount - po.deductedReturns.reduce((s: number, r) => s + Number(r.amount || 0), 0)))}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{poStatusBadge(po.status)}</TableCell>
                  <TableCell className="text-center">
                    <div className="flex gap-1.5 justify-center items-center">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-slate-500 hover:text-sky-600 hover:bg-sky-50" 
                        title="ดู/พิมพ์ใบสั่งซื้อ PDF" 
                        onClick={(e) => { e.stopPropagation(); handleViewDetail(po.id, 'pdf'); }}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {po.status === 'DRAFT' && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-500 hover:text-amber-600 hover:bg-amber-50" 
                          title="แก้ไขใบสั่งซื้อ" 
                          onClick={(e) => openEditDialog(po, e)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {po.status === 'DRAFT' && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50" 
                          title="ออกใบสั่งซื้อ (Issue)" 
                          onClick={(e) => openIssueConfirmDialog(po, e)}
                        >
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                      )}
                      {(po.status === 'ISSUED' || po.status === 'PARTIALLY_RECEIVED') && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-500 hover:text-amber-600 hover:bg-amber-50" 
                          title="รับสินค้าเข้าคลัง (GRN)" 
                          onClick={(e) => openReceiveDialog(po, e)}
                        >
                          <PackageOpen className="w-4 h-4" />
                        </Button>
                      )}
                      {/* Status Change / Rollback Action Button */}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50" 
                        title="เปลี่ยน / ย้อนสถานะใบสั่งซื้อ" 
                        onClick={(e) => openStatusChangeDialog(po, e)}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                      {po.status !== 'CANCELLED' && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-500 hover:text-rose-600 hover:bg-rose-50" 
                          title="ยกเลิกใบสั่งซื้อ" 
                          onClick={(e) => openCancelDialog(po, e)}
                        >
                          <Ban className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {total > pageSize && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="text-xs text-slate-500 font-medium">
            แสดง <b className="text-slate-800">{(page - 1) * pageSize + 1}</b> - <b className="text-slate-800">{Math.min(page * pageSize, total)}</b> จาก <b className="text-slate-800">{total.toLocaleString()}</b> ใบ
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))} className="h-8 px-3 text-xs">‹ ก่อนหน้า</Button>
            <span className="px-2 text-xs font-bold text-slate-700">หน้า {page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
            <Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)} className="h-8 px-3 text-xs">ถัดไป ›</Button>
          </div>
        </div>
      )}
    </div>
  );
}
