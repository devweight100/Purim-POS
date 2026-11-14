import { formatCurrency } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import {
  Ban,
  CreditCard,
  User,
  RefreshCw,
  Printer,
  FileText,
  Edit3,
  RotateCcw,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  History,
} from "lucide-react";
import { LoadErrorState } from "@/components/common/LoadErrorState";
import { isCreditOrderFullyPaid, isOrderCredit, type OrderAction, type OrderRow } from "./order-shared";

interface Props {
  loading: boolean;
  loadError: string | null;
  fetchOrders: () => Promise<void>;
  paginatedOrders: OrderRow[];
  filteredCount: number;
  currentPage: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;
  changePageSize: (size: number) => void;
  totalPages: number;
  handleRowClick: (order: OrderRow) => void;
  handleOpenCreditHistory: OrderAction;
  handleOpenA4Receipt: OrderAction;
  handleOpenSlipReceipt: OrderAction;
  handleStartEditPayment: OrderAction;
  handleStartEditItems: OrderAction;
  handleStartRepeatOrder: OrderAction;
  handleStartEditNote: OrderAction;
  handleStartVoid: OrderAction;
  setReturnOrderId: (id: string | null) => void;
}

/** Orders table with print / action buttons and pagination. */
export function OrdersTable({
  loading, loadError, fetchOrders, paginatedOrders, filteredCount, currentPage, setCurrentPage, pageSize, changePageSize,
  totalPages, handleRowClick, handleOpenCreditHistory, handleOpenA4Receipt, handleOpenSlipReceipt, handleStartEditPayment,
  handleStartEditItems, handleStartRepeatOrder, handleStartEditNote, handleStartVoid, setReturnOrderId,
}: Props) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-50/90 border-b border-slate-200">
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-bold text-slate-800 text-sm py-3.5 pl-4 text-center w-16">ลำดับ</TableHead>
              <TableHead className="font-bold text-slate-800 text-sm py-3.5 text-left w-[130px]">เลขออเดอร์</TableHead>
              <TableHead className="font-bold text-slate-800 text-sm py-3.5 text-center w-[150px]">วันที่ทำรายการ</TableHead>
              <TableHead className="font-bold text-slate-800 text-sm py-3.5">ลูกค้า / ผู้ซื้อ</TableHead>
              <TableHead className="font-bold text-slate-800 text-sm py-3.5 text-right w-[100px]">รายการ</TableHead>
              <TableHead className="font-bold text-slate-800 text-sm py-3.5 text-right w-[120px]">ยอดรวมสุทธิ</TableHead>
              <TableHead className="font-bold text-slate-800 text-sm py-3.5 text-center w-[140px]">ช่องทางชำระ</TableHead>
              <TableHead className="font-bold text-slate-800 text-sm py-3.5 text-center w-[120px]">สถานะ</TableHead>
              <TableHead className="font-bold text-slate-800 text-sm py-3.5 text-center w-[250px] pr-4">
                🖨️ พิมพ์ใบเสร็จ & การจัดการ
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody className="divide-y divide-slate-100">
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                  กำลังโหลดข้อมูลออเดอร์...
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={9}>
                  <LoadErrorState message={loadError} onRetry={() => void fetchOrders()} />
                </TableCell>
              </TableRow>
            ) : paginatedOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-14 text-slate-400 text-sm">
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="w-8 h-8 text-slate-300" />
                    <span className="font-bold text-slate-600 text-sm">ไม่พบข้อมูลออเดอร์ตามเงื่อนไข</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedOrders.map((order, idx) => {
                const isVoid = order.status === "VOIDED" || order.status === "CANCELLED";
                const isCredit = isOrderCredit(order);
                const isCreditFullySettled = isCreditOrderFullyPaid(order);
                const itemsCount = order.items?.length || order.itemCount || 0;
                const total = order.totalAmount || order.total || 0;

                return (
                  <TableRow
                    key={order.id || order.orderNumber}
                    className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                    onClick={() => handleRowClick(order)}
                  >
                    {/* 1. Index (ลำดับ) */}
                    <TableCell className="py-3.5 pl-4 text-center font-mono font-bold text-slate-500 text-sm">
                      {(currentPage - 1) * pageSize + idx + 1}
                    </TableCell>

                    {/* 2. Order Number */}
                    <TableCell className="py-3.5 font-mono">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-indigo-600 text-[15px]">{order.orderNumber}</span>
                        {order.hasClaims && (
                          <span className="text-[10px] text-amber-700 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded font-bold font-sans">
                            ⚠️ เคลมแล้ว
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* 3. Date (แยก col. วันที่) */}
                    <TableCell className="py-3.5 text-center font-mono text-xs text-slate-600">
                      {new Date(order.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                    </TableCell>

                    {/* 4. Customer Name */}
                    <TableCell className="py-3.5">
                      <div className="font-bold text-slate-900 text-[15px] flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>{order.customerName || (typeof order.customer === "object" ? order.customer?.name : order.customer) || "ลูกค้าทั่วไป"}</span>
                      </div>
                    </TableCell>

                    {/* 5. Items Count */}
                    <TableCell className="py-3.5 text-right font-bold text-[15px] text-slate-700 font-mono">
                      {itemsCount} รายการ
                    </TableCell>

                    {/* 6. Total Amount */}
                    <TableCell className="py-3.5 text-right font-black text-[15px] sm:text-base text-slate-900 font-mono">
                      {formatCurrency(total)}
                    </TableCell>

                    {/* 5. Payment Channel */}
                    <TableCell className="py-3 text-center">
                      <div className="flex gap-1 justify-center flex-wrap">
                        {order.payments && order.payments.length > 0 ? (
                          order.payments.map((p, i: number) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className={`text-[10px] font-bold px-1.5 py-0.5 ${
                                p.method === "CREDIT_DEBT" || p.method === "DEBT" || p.method === "CREDIT_NOTE" || p.method === "CREDIT"
                                  ? "bg-amber-100 text-amber-900 border-amber-300"
                                  : "bg-white text-slate-800 border-slate-300"
                              }`}
                            >
                              {p.method === "CASH"
                                ? "💵 เงินสด"
                                : p.method === "QR_PROMPTPAY"
                                ? "📱 QR"
                                : p.method === "CREDIT_CARD"
                                ? "💳 บัตร"
                                : p.method === "CREDIT_DEBT" || p.method === "DEBT" || p.method === "CREDIT_NOTE" || p.method === "CREDIT"
                                ? "👤 เงินเชื่อ"
                                : p.method}
                            </Badge>
                          ))
                        ) : (
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              isCredit
                                ? "bg-amber-100 text-amber-900 border-amber-300 font-bold"
                                : "bg-white text-slate-700 border-slate-300"
                            }`}
                          >
                            {order.paymentMethod || "เงินสด"}
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    {/* 6. Status Badge (Credit bills that are fully settled show 'สำเร็จ' in green!) */}
                    <TableCell className="py-3 text-center">
                      {isVoid ? (
                        <Badge className="bg-rose-100 text-rose-700 border-rose-300 line-through font-bold text-[10.5px]">
                          ยกเลิกแล้ว
                        </Badge>
                      ) : isCredit ? (
                        isCreditFullySettled ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10.5px]">
                            สำเร็จ
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-[10.5px]">
                            เงินเชื่อ
                          </Badge>
                        )
                      ) : order.isSynced === false ? (
                        <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-[10px]">
                          ⚠️ ออฟไลน์
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10.5px]">
                          สำเร็จ
                        </Badge>
                      )}
                    </TableCell>

                    {/* 7. Action & Print Buttons */}
                    <TableCell className="py-3 pr-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        {/* If Credit Bill -> Always show the Payment History button */}
                        {isCredit ? (
                          <Button
                            size="sm"
                            onClick={(e) => handleOpenCreditHistory(order, e)}
                            className="h-8 px-2.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs gap-1"
                            title="ดูประวัติการชำระเงินเชื่อ และพิมพ์ใบเสร็จตามจริง"
                          >
                            <History className="w-3.5 h-3.5" />
                            <span>ประวัติชำระ</span>
                          </Button>
                        ) : (
                          /* Standard A4 Print Button */
                          <Button
                            size="sm"
                            onClick={(e) => handleOpenA4Receipt(order, e)}
                            className="h-8 px-2.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs gap-1"
                            title="พิมพ์ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูปแบบ (A4)"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>พิมพ์ A4</span>
                          </Button>
                        )}

                        {/* 80mm Slip Print Button */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => handleOpenSlipReceipt(order, e)}
                          className="h-8 px-2 text-xs font-semibold text-slate-700 border-slate-300 hover:bg-slate-100 rounded-xl"
                          title="พิมพ์สลิป 80mm"
                        >
                          <Printer className="w-3.5 h-3.5 mr-1" />
                          <span>80mm</span>
                        </Button>

                        {/* More Options Dropdown */}
                        <DropdownMenu>
                          <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 p-0 text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer outline-none shadow-2xs">
                            <MoreVertical className="w-4 h-4" />
                          </DropdownMenuTrigger>

                          <DropdownMenuContent align="end" className="w-56 p-1.5 rounded-2xl bg-white shadow-xl border border-slate-200 text-xs">
                            {isCredit ? (
                              <DropdownMenuItem
                                onClick={(e) => handleOpenCreditHistory(order, e)}
                                className="font-bold text-amber-800 py-2 rounded-xl cursor-pointer bg-amber-50/50 hover:bg-amber-100"
                              >
                                <History className="w-4 h-4 mr-2 text-amber-600" />
                                ประวัติชำระ & ออกใบเสร็จตามจริง
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={(e) => handleOpenA4Receipt(order, e)}
                                className="font-bold text-indigo-700 py-2 rounded-xl cursor-pointer"
                              >
                                <FileText className="w-4 h-4 mr-2" />
                                พิมพ์ใบเสร็จเต็มรูปแบบ (A4)
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuItem
                              onClick={(e) => handleOpenSlipReceipt(order, e)}
                              className="font-medium text-slate-700 py-2 rounded-xl cursor-pointer"
                            >
                              <Printer className="w-4 h-4 mr-2" />
                              พิมพ์สลิปใบเสร็จ 80mm
                            </DropdownMenuItem>

                            <DropdownMenuSeparator className="my-1" />

                            {!isVoid && (
                              <>
                                <DropdownMenuItem
                                  onClick={(e) => handleStartEditPayment(order, e)}
                                  className="font-bold text-slate-800 py-2 rounded-xl cursor-pointer hover:bg-slate-50"
                                >
                                  <CreditCard className="w-4 h-4 mr-2 text-emerald-600" />
                                  เปลี่ยนวิธีชำระเงิน
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                  onClick={(e) => handleStartEditItems(order, e)}
                                  className="font-bold text-slate-800 py-2 rounded-xl cursor-pointer hover:bg-slate-50"
                                >
                                  <Edit3 className="w-4 h-4 mr-2 text-sky-600" />
                                  ดึงไปแก้ไขในหน้าขาย (POS)
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                  onClick={(e) => handleStartRepeatOrder(order, e)}
                                  className="font-medium text-slate-700 py-2 rounded-xl cursor-pointer hover:bg-slate-50"
                                >
                                  <RotateCcw className="w-4 h-4 mr-2 text-indigo-600" />
                                  สั่งซ้ำ (ลงตะกร้า)
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                  onClick={(e) => handleStartEditNote(order, e)}
                                  className="font-medium text-slate-700 py-2 rounded-xl cursor-pointer hover:bg-slate-50"
                                >
                                  <FileText className="w-4 h-4 mr-2 text-amber-600" />
                                  แก้ไขหมายเหตุ / โน้ต
                                </DropdownMenuItem>

                                <DropdownMenuSeparator className="my-1" />

                                <DropdownMenuItem
                                  onClick={(e) => { e?.stopPropagation?.(); setReturnOrderId(order.id); }}
                                  className="font-bold text-amber-700 py-2 rounded-xl cursor-pointer hover:bg-amber-50"
                                >
                                  <RotateCcw className="w-4 h-4 mr-2" />
                                  รับคืนสินค้าบางรายการ
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                  onClick={(e) => handleStartVoid(order, e)}
                                  className="font-bold text-rose-600 py-2 rounded-xl cursor-pointer hover:bg-rose-50"
                                >
                                  <Ban className="w-4 h-4 mr-2" />
                                  ยกเลิกบิลนี้ (Void)
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ─── PAGINATION ─── */}
      <div className="p-3.5 sm:px-6 border-t border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="text-slate-500 font-medium">
          แสดงรายการที่{" "}
          <span className="font-bold text-slate-800">
            {filteredCount === 0 ? 0 : (currentPage - 1) * pageSize + 1}
          </span>{" "}
          -{" "}
          <span className="font-bold text-slate-800">
            {Math.min(currentPage * pageSize, filteredCount)}
          </span>{" "}
          จากทั้งหมด <span className="font-bold text-slate-800">{filteredCount.toLocaleString()}</span> บิล
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-slate-600">
            <span>แสดงหน้าละ:</span>
            <select
              value={pageSize}
              onChange={(e) => changePageSize(Number(e.target.value))}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2 font-bold text-slate-800 outline-none focus:border-indigo-500 shadow-2xs"
            >
              <option value={15}>15 บิล</option>
              <option value={30}>30 บิล</option>
              <option value={50}>50 บิล</option>
              <option value={100}>100 บิล</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(1)}
              className="h-8 w-8 p-0 text-slate-600"
              title="หน้าแรก"
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="h-8 w-8 p-0 text-slate-600"
              title="หน้าก่อนหน้า"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <div className="px-3 font-bold text-slate-800">
              หน้า {currentPage} / {totalPages}
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 w-8 p-0 text-slate-600"
              title="หน้าถัดไป"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
              className="h-8 w-8 p-0 text-slate-600"
              title="หน้าสุดท้าย"
            >
              <ChevronsRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
