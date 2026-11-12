"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, FileText } from "lucide-react";
import { useShiftStore } from "@/lib/store/shift-store";
import { ReturnItemsDialog } from "@/components/orders/ReturnItemsDialog";
import { useCartStore } from "@/lib/store/cart-store";
import { useProductStore } from "@/lib/store/product-store";
import { getCustomerById, fetchCustomers } from "@/lib/customer-service";

import { fetchAllClaimRecords } from "@/lib/claim-service";
import { getDebtRecordByOrderId } from "@/lib/debt-service";
import { ClaimRecord, DebtRecord, DebtPaymentInstallment } from "@/lib/types";
import { ReceiptA4PdfModal, ReceiptA4Data } from "@/components/pos/ReceiptA4PdfModal";
import { ReceiptPdfModal, ReceiptData } from "@/components/pos/ReceiptPdfModal";
import { orderToA4Data, orderToReceiptData, paymentMethodLabel } from "@/lib/receipt-mapper";
import { DebtHistoryModal } from "@/components/debts/DebtHistoryModal";
import { DebtReceiptPdfModal } from "@/components/debts/DebtReceiptPdfModal";
import { syncPendingOrders } from "@/lib/order-sync-service";
import { useConnectionStatus } from "@/lib/connection-status";
import { errorMessage } from "@/components/common/LoadErrorState";
import { toast } from "sonner";
import type { OrderRow, OrderRowItem } from "./_components/order-shared";
import { OrdersTable } from "./_components/OrdersTable";
import { OrdersToolbar } from "./_components/OrdersToolbar";
import { OrderDetailDialog } from "./_components/OrderDetailDialog";
import { OrderActionDialogs } from "./_components/OrderActionDialogs";

/** Product fields used to name order lines. */
type CatalogProduct = { id?: string; sku?: string; name?: string };

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [productsMap, setProductsMap] = useState<Record<string, CatalogProduct>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | "completed" | "voided">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Detail Dialog
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<OrderRow | null>(null);

  // 1. Full A4 Receipt Modal State
  const [a4ReceiptData, setA4ReceiptData] = useState<ReceiptA4Data | null>(null);
  const [isA4ReceiptOpen, setIsA4ReceiptOpen] = useState(false);

  // 2. 80mm Slip Receipt Modal State
  const [slipReceiptData, setSlipReceiptData] = useState<ReceiptData | null>(null);
  const [isSlipReceiptOpen, setIsSlipReceiptOpen] = useState(false);

  // 3. Edit Payment Method State
  const [editPaymentOrder, setEditPaymentOrder] = useState<OrderRow | null>(null);
  const [newPaymentMethod, setNewPaymentMethod] = useState<string>("CASH");
  const [isEditPaymentOpen, setIsEditPaymentOpen] = useState(false);

  // 4. Edit Note / Remarks State
  const [editNoteOrder, setEditNoteOrder] = useState<OrderRow | null>(null);
  const [newNoteValue, setNewNoteValue] = useState<string>("");
  const [isEditNoteOpen, setIsEditNoteOpen] = useState(false);

  // 5. Repeat Order Confirmation State
  const [repeatOrderTarget, setRepeatOrderTarget] = useState<OrderRow | null>(null);
  const [isRepeatOrderOpen, setIsRepeatOrderOpen] = useState(false);

  // 6. Edit Items & Re-checkout in POS Confirmation State
  const [editItemsTarget, setEditItemsTarget] = useState<OrderRow | null>(null);
  const [isEditItemsOpen, setIsEditItemsOpen] = useState(false);

  // 7. Void Order State
  const [voidTargetOrder, setVoidTargetOrder] = useState<OrderRow | null>(null);
  const [returnOrderId, setReturnOrderId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [isVoidOpen, setIsVoidOpen] = useState(false);

  // 8. Credit Payment History State (Uses unified DebtHistoryModal)
  const [creditHistoryOrder, setCreditHistoryOrder] = useState<OrderRow | null>(null);
  const [creditDebtRecord, setCreditDebtRecord] = useState<DebtRecord | null>(null);
  const [isCreditHistoryOpen, setIsCreditHistoryOpen] = useState(false);

  // 9. Debt Installment 80mm Receipt Modal State
  const [debtSlipModalOpen, setDebtSlipModalOpen] = useState(false);
  const [selectedDebtForSlip, setSelectedDebtForSlip] = useState<DebtRecord | null>(null);
  const [selectedInstallmentForSlip, setSelectedInstallmentForSlip] = useState<DebtPaymentInstallment | null>(null);

  const cart = useCartStore();
  const { products } = useProductStore();
  const shiftStore = useShiftStore();

  // Load product catalog for reliable name & unit lookups
  useEffect(() => {
    const loadCatalog = async () => {
      let prods: CatalogProduct[] = [];
      try {
        prods = await apiFetch("/products");
      } catch {
        try {
          prods = await api.getProducts();
        } catch {
          prods = [];
        }
      }

      const map: Record<string, CatalogProduct> = {};
      (Array.isArray(prods) ? prods : []).forEach((p) => {
        if (p.id) map[p.id] = p;
        if (p.sku) map[p.sku] = p;
      });
      setProductsMap(map);
    };

    loadCatalog();
  }, []);

  /** Load the orders; every state update happens after the request. */
  const loadOrders = async () => {
    try {
      let fetchedBackend: OrderRow[] = [];
      let allClaims: ClaimRecord[] = [];
      {
        let url = "/orders";
        const params = new URLSearchParams();
        if (startDate) params.append("startDate", startDate);
        if (endDate) params.append("endDate", endDate);
        if (params.toString()) {
          url += `?${params.toString()}`;
        }
        const [ordersRes, claimsRes] = await Promise.all([
          apiFetch(url),
          fetchAllClaimRecords().catch(() => []),
        ]);
        fetchedBackend = ordersRes?.data || (Array.isArray(ordersRes) ? ordersRes : []);
        allClaims = claimsRes || [];
      }

      const claimedOrderMap = new Set<string>();
      allClaims.forEach((c) => {
        if (c.orderId) claimedOrderMap.add(c.orderId);
        if (c.orderNumber) claimedOrderMap.add(c.orderNumber);
      });

      // Orders come from the server only (unsent offline bills live in the outbox, see the banner)
      const combinedMap = new Map<string, OrderRow>();

      if (Array.isArray(fetchedBackend) && fetchedBackend.length > 0) {
        fetchedBackend.forEach((bOrder) => {
          const key = bOrder.orderNumber || bOrder.id;

          const hasClaims =
            (Array.isArray(bOrder.claims) && bOrder.claims.length > 0) ||
            claimedOrderMap.has(key) ||
            claimedOrderMap.has(bOrder.id) ||
            claimedOrderMap.has(bOrder.orderNumber);

          const bItemsMapped: OrderRowItem[] = Array.isArray(bOrder.items)
            ? bOrder.items.map((it) => ({
                ...it,
                name: it.product?.name || it.name || productsMap[it.productId as string]?.name || "สินค้า",
                sku: it.product?.sku || it.sku || productsMap[it.productId as string]?.sku || "",
              }))
            : [];

          combinedMap.set(key, {
            ...bOrder,
            hasClaims,
            claims: bOrder.claims || [],
            items: bItemsMapped,
            isSynced: true,
          });
        });
      }

      const all = Array.from(combinedMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setOrders(all);
      setLoadError(null);
    } catch (error) {
      setOrders([]);
      setLoadError(errorMessage(error, "ดึงข้อมูลออเดอร์ไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
    await loadOrders();
  };

  // A new date range shows the spinner at once; the effect below loads it.
  const changeStartDate = (v: string) => {
    if (v !== startDate) setLoading(true);
    setStartDate(v);
  };
  const changeEndDate = (v: string) => {
    if (v !== endDate) setLoading(true);
    setEndDate(v);
  };

  useEffect(() => {
    // loading is already true here (initial state / changeStartDate / changeEndDate)
    const run = async () => { await loadOrders(); };
    void run();
    // Auto-sync offline orders in background
    syncPendingOrders(true).then((res) => {
      if (res.synced > 0) {
        fetchOrders();
      }
    });
  }, [startDate, endDate]);

  // Unsynced offline orders count (bills waiting in this device's outbox)
  const unsyncedCount = useConnectionStatus((s) => s.pending);

  // Statistics Summary
  const stats = useMemo(() => {
    let totalRevenue = 0;
    let completedCount = 0;
    let voidedCount = 0;

    orders.forEach((o) => {
      if (o.status === "VOIDED" || o.status === "CANCELLED") {
        voidedCount++;
      } else {
        completedCount++;
        totalRevenue += Number(o.totalAmount || o.total || 0);
      }
    });

    return {
      totalOrders: completedCount,
      voidedOrders: voidedCount,
      totalRevenue,
      allCount: orders.length,
    };
  }, [orders]);

  // Filtered Orders based on Search & Status Tab
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const isVoid = order.status === "VOIDED" || order.status === "CANCELLED";
      if (statusTab === "completed" && isVoid) return false;
      if (statusTab === "voided" && !isVoid) return false;

      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const numMatch = order.orderNumber?.toLowerCase().includes(q);
        const custMatch = (order.customerName || (order.customer as string | null | undefined))?.toLowerCase().includes(q);
        const itemMatch = order.items?.some((i) => i.name?.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q));
        const noteMatch = order.note?.toLowerCase().includes(q);
        if (!numMatch && !custMatch && !itemMatch && !noteMatch) return false;
      }

      return true;
    });
  }, [orders, statusTab, search]);

  // Reset pagination when search, tab or page size changes
  const changeSearch = (v: string) => {
    if (v !== search) setCurrentPage(1);
    setSearch(v);
  };
  const changeStatusTab = (v: "all" | "completed" | "voided") => {
    if (v !== statusTab) setCurrentPage(1);
    setStatusTab(v);
  };
  const changePageSize = (v: number) => {
    if (v !== pageSize) setCurrentPage(1);
    setPageSize(v);
  };

  // Paginated records
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredOrders.slice(start, start + pageSize);
  }, [filteredOrders, currentPage, pageSize]);

  // ─── Order -> printed documents (shared mapper, same as POS history / document search) ───
  // Reprints from this page are copies: A4 "สำเนา (COPY)", thermal "พิมพ์ซ้ำ".
  const formatOrderToA4 = (order: OrderRow): ReceiptA4Data =>
    orderToA4Data(order, {
      isReprint: true,
      customer: order.customerId ? getCustomerById(order.customerId) || undefined : undefined,
    });

  const formatOrderToSlip = (order: OrderRow): ReceiptData => orderToReceiptData(order, { isReprint: true });

  // ─── Normal A4 Print Handler ───
  const handleOpenA4Receipt = (order: OrderRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setA4ReceiptData(formatOrderToA4(order));
    setIsA4ReceiptOpen(true);
  };

  // ─── Open Credit Payment History Modal ───
  const handleOpenCreditHistory = (order: OrderRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const debt = getDebtRecordByOrderId(order.id || order.orderNumber);
    setCreditHistoryOrder(order);
    setCreditDebtRecord(debt);
    setIsCreditHistoryOpen(true);
  };

  // ─── Print Installment Specific A4 Receipt ───
  const handlePrintInstallmentReceiptA4 = (inst: DebtPaymentInstallment) => {
    if (!creditHistoryOrder || !creditDebtRecord) return;
    const baseA4 = formatOrderToA4(creditHistoryOrder);

    const installmentData: ReceiptA4Data = {
      ...baseA4,
      isCreditBill: true,
      isInstallmentReceipt: true,
      installmentNo: inst.installmentNo,
      installmentAmount: inst.amountPaid,
      totalOrderAmount: creditDebtRecord.totalAmount,
      accumulatedPaid: inst.previousPaid + inst.amountPaid,
      remainingDebt: inst.remainingAfter,
      installmentDate: inst.paymentDate,
      isCopy: false,
      outstandingAmount: undefined,
      cashReceived: undefined,
      changeAmount: undefined,
      paymentMethod: paymentMethodLabel(inst.paymentMethod),
      payments: [
        {
          method: inst.paymentMethod,
          amount: inst.amountPaid,
          referenceNo: inst.referenceNo || inst.accountLabel,
        },
      ],
    };

    setA4ReceiptData(installmentData);
    setIsA4ReceiptOpen(true);
  };

  // ─── Print Installment 80mm Slip Receipt ───
  const handlePrintInstallmentSlip = (inst: DebtPaymentInstallment) => {
    if (!creditDebtRecord) return;
    setSelectedDebtForSlip(creditDebtRecord);
    setSelectedInstallmentForSlip(inst);
    setDebtSlipModalOpen(true);
  };

  // ─── Print Full Paid A4 Receipt (No remaining 0 notes, identical to standard receipt) ───
  const handlePrintFullPaidCreditReceipt = () => {
    if (!creditHistoryOrder) return;
    setA4ReceiptData(formatOrderToA4(creditHistoryOrder));
    setIsA4ReceiptOpen(true);
  };

  const handleOpenSlipReceipt = (order: OrderRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSlipReceiptData(formatOrderToSlip(order));
    setIsSlipReceiptOpen(true);
  };

  // Populate items into cart
  const populateOrderToCart = (order: OrderRow) => {
    cart.clearCart();
    if (!order.items || order.items.length === 0) return;

    order.items.forEach((item) => {
      const product = products.find((p) => p.id === item.productId || p.sku === item.sku);
      if (product) {
        const unit = product.units?.find((u) => u.id === item.unitId || u.unitName === item.unitName) || product.units?.[0];
        for (let i = 0; i < (item.quantity || 1); i++) {
          cart.addItem(product, unit);
        }
        if (item.customPrice) {
          cart.setCustomPrice(product.id, item.customPrice, unit?.id);
        }
        if ((item.discountValue ?? 0) > 0) {
          cart.setItemDiscount(product.id, item.discountType || "baht", item.discountValue as number, unit?.id);
        }
      }
    });

    if (order.customerId) {
      cart.setCustomer(order.customerId, order.customerName as string | null);
    }
  };

  // 1. Edit Items & Re-checkout in POS
  const handleStartEditItems = (order: OrderRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditItemsTarget(order);
    setIsEditItemsOpen(true);
  };

  const handleConfirmEditItems = () => {
    if (editItemsTarget) {
      populateOrderToCart(editItemsTarget);
      cart.setEditingOrderId(editItemsTarget.orderNumber || editItemsTarget.id);
      setIsEditItemsOpen(false);
      setIsDetailOpen(false);
      toast.success(`✏️ ดึงบิล #${editItemsTarget.orderNumber} มาแก้ไขในหน้าขายแล้ว`);
      router.push("/pos");
    }
  };

  // 2. Repeat Order into Cart
  const handleStartRepeatOrder = (order: OrderRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRepeatOrderTarget(order);
    setIsRepeatOrderOpen(true);
  };

  const handleConfirmRepeatOrder = () => {
    if (repeatOrderTarget) {
      populateOrderToCart(repeatOrderTarget);
      setIsRepeatOrderOpen(false);
      setIsDetailOpen(false);
      toast.success(`🔄 ดึงรายการบิล #${repeatOrderTarget.orderNumber} ลงในตะกร้าแล้ว`);
      router.push("/pos");
    }
  };

  // 3. Edit Payment Method
  const handleStartEditPayment = (order: OrderRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditPaymentOrder(order);
    const currMethod = order.payments?.[0]?.method || order.paymentMethod || "CASH";
    setNewPaymentMethod(currMethod);
    setIsEditPaymentOpen(true);
  };

  const handleConfirmEditPayment = async () => {
    if (!editPaymentOrder) return;
    const orderId = editPaymentOrder.orderNumber || editPaymentOrder.id;


    try {
      await apiFetch(`/orders/${editPaymentOrder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ paymentMethod: newPaymentMethod }),
      });

      void shiftStore.fetchCurrentShift();

      const methodNames: Record<string, string> = {
        CASH: "เงินสด (Cash)",
        QR_PROMPTPAY: "QR PromptPay",
        CREDIT_CARD: "บัตรเครดิต",
        TRANSFER: "โอนเงินผ่านธนาคาร",
        CREDIT_NOTE: "เงินเชื่อ (Credit)",
      };

      toast.success(`✅ เปลี่ยนวิธีชำระเงินบิล #${orderId} เป็น "${methodNames[newPaymentMethod] || newPaymentMethod}" เรียบร้อยแล้ว`);
      setIsEditPaymentOpen(false);
      setEditPaymentOrder(null);
      fetchOrders();
    } catch {
      toast.error("แก้ไขวิธีชำระเงินไม่สำเร็จ");
    }
  };

  // 4. Edit Note / Remarks
  const handleStartEditNote = (order: OrderRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditNoteOrder(order);
    setNewNoteValue(order.note || order.remarks || "");
    setIsEditNoteOpen(true);
  };

  const handleConfirmEditNote = async () => {
    if (!editNoteOrder) return;
    const orderId = editNoteOrder.orderNumber || editNoteOrder.id;

    try {
      await apiFetch(`/orders/${editNoteOrder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ note: newNoteValue.trim() }),
      });


      toast.success(`📝 อัปเดตหมายเหตุบิล #${orderId} เรียบร้อยแล้ว`);
      setIsEditNoteOpen(false);
      setEditNoteOrder(null);
      fetchOrders();
    } catch {
      toast.error("แก้ไขหมายเหตุไม่สำเร็จ");
    }
  };

  // 5. Void Order
  const handleStartVoid = (order: OrderRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setVoidTargetOrder(order);
    setVoidReason("");
    setIsVoidOpen(true);
  };

  const handleConfirmVoid = async () => {
    if (!voidTargetOrder) return;
    if (!voidReason.trim()) {
      toast.error("กรุณาระบุเหตุผลการยกเลิกบิล");
      return;
    }

    try {
      await apiFetch(`/orders/${voidTargetOrder.id}/void`, {
        method: "POST",
        body: JSON.stringify({ reason: voidReason }),
      });

      void shiftStore.fetchCurrentShift();
      // the server returned the stock in the void transaction
      void useProductStore.getState().fetchProducts();

      // the server already reversed points / credit debt; refresh the customer list from it
      void fetchCustomers().catch(() => undefined);

      toast.success(`✅ ยกเลิกบิล #${voidTargetOrder.orderNumber} คืนสต็อก และปรับแต้ม/หนี้สมาชิกเรียบร้อยแล้ว`);
      setIsVoidOpen(false);
      setIsDetailOpen(false);
      setVoidTargetOrder(null);
      setVoidReason("");
      fetchOrders();
    } catch {
      toast.error("เกิดข้อผิดพลาดในการยกเลิกบิล");
    }
  };

  const handleRowClick = (order: OrderRow) => {
    setCurrentOrder(order);
    setIsDetailOpen(true);
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7 font-sans">
      {/* ─── PAGE HEADER ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <FileText className="w-6 h-6 text-indigo-600 shrink-0" />
            <span>รายการออเดอร์และใบเสร็จ (Orders & Tax Invoices)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ดูประวัติการขาย พิมพ์ใบเสร็จรับเงิน A4 / สลิป 80mm ออกใบเสร็จเงินเชื่อตามจริง และจัดการบิล
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOrders}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 h-9 px-3 text-xs font-semibold shadow-2xs"
            title="รีเฟรชข้อมูลออเดอร์"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            รีเฟรช
          </Button>
        </div>
      </div>

      {/* ─── OFFLINE UNSYNCED ORDERS BANNER ─── */}
      {unsyncedCount > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-300/80 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-bold text-amber-950 flex items-center gap-2">
                <span>พบบิลที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์</span>
                <Badge className="bg-amber-600 text-white font-mono text-xs">{unsyncedCount} บิล</Badge>
              </p>
              <p className="text-xs text-amber-800/90 mt-0.5">
                บิลถูกบันทึกไว้ในเครื่องนี้อย่างปลอดภัย สามารถกดปุ่มเพื่อส่งบิลขึ้นฐานข้อมูลส่วนกลางได้ทันที
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              setIsSyncingAll(true);
              try {
                const res = await syncPendingOrders();
                if (res.synced > 0) {
                  await fetchOrders();
                }
              } finally {
                setIsSyncingAll(false);
              }
            }}
            disabled={isSyncingAll}
            className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-9 px-4 rounded-xl shadow-xs shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isSyncingAll ? "animate-spin" : ""}`} />
            {isSyncingAll ? "กำลังซิงค์บิล..." : "🔄 ซิงค์ขึ้นเซิร์ฟเวอร์ทันที"}
          </Button>
        </div>
      )}

      <OrdersToolbar
        stats={stats}
        statusTab={statusTab}
        changeStatusTab={changeStatusTab}
        startDate={startDate}
        changeStartDate={changeStartDate}
        endDate={endDate}
        changeEndDate={changeEndDate}
        search={search}
        changeSearch={changeSearch}
      />

      {/* ─── DATA TABLE ─── */}
      <OrdersTable
        loading={loading}
        loadError={loadError}
        fetchOrders={fetchOrders}
        paginatedOrders={paginatedOrders}
        filteredOrders={filteredOrders}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        pageSize={pageSize}
        changePageSize={changePageSize}
        totalPages={totalPages}
        handleRowClick={handleRowClick}
        handleOpenCreditHistory={handleOpenCreditHistory}
        handleOpenA4Receipt={handleOpenA4Receipt}
        handleOpenSlipReceipt={handleOpenSlipReceipt}
        handleStartEditPayment={handleStartEditPayment}
        handleStartEditItems={handleStartEditItems}
        handleStartRepeatOrder={handleStartRepeatOrder}
        handleStartEditNote={handleStartEditNote}
        handleStartVoid={handleStartVoid}
        setReturnOrderId={setReturnOrderId}
      />

      {/* ─── MODALS & DIALOGS ─── */}

      {/* 1. Full A4 Receipt / Tax Invoice Modal */}
      <ReceiptA4PdfModal
        open={isA4ReceiptOpen}
        onOpenChange={setIsA4ReceiptOpen}
        data={a4ReceiptData}
      />

      {/* 2. 80mm Slip Thermal Receipt Modal */}
      <ReceiptPdfModal
        open={isSlipReceiptOpen}
        onOpenChange={setIsSlipReceiptOpen}
        data={slipReceiptData}
      />

      {/* 3. Debt Payment History Modal (Exact same UI as /debts page, with Print A4 added) */}
      <DebtHistoryModal
        open={isCreditHistoryOpen}
        onOpenChange={setIsCreditHistoryOpen}
        debtRecord={creditDebtRecord}
        onSelectInstallmentA4={(inst) => handlePrintInstallmentReceiptA4(inst)}
        onSelectInstallment={(inst) => handlePrintInstallmentSlip(inst)}
        onPrintFullA4={handlePrintFullPaidCreditReceipt}
      />

      {/* 4. Debt Installment 80mm Slip Receipt Modal */}
      <DebtReceiptPdfModal
        open={debtSlipModalOpen}
        onOpenChange={setDebtSlipModalOpen}
        debtRecord={selectedDebtForSlip}
        installment={selectedInstallmentForSlip}
      />

      {/* 5. Order Detail Dialog */}
      <OrderDetailDialog
        isDetailOpen={isDetailOpen}
        setIsDetailOpen={setIsDetailOpen}
        currentOrder={currentOrder}
        handleOpenCreditHistory={handleOpenCreditHistory}
        handleOpenA4Receipt={handleOpenA4Receipt}
        handleOpenSlipReceipt={handleOpenSlipReceipt}
        handleStartEditPayment={handleStartEditPayment}
        handleStartEditItems={handleStartEditItems}
        handleStartVoid={handleStartVoid}
        setReturnOrderId={setReturnOrderId}
      />

      {/* 6.-10. Edit payment / note, edit in POS, repeat order, void */}
      <OrderActionDialogs
        isEditPaymentOpen={isEditPaymentOpen}
        setIsEditPaymentOpen={setIsEditPaymentOpen}
        editPaymentOrder={editPaymentOrder}
        newPaymentMethod={newPaymentMethod}
        setNewPaymentMethod={setNewPaymentMethod}
        handleConfirmEditPayment={handleConfirmEditPayment}
        isEditNoteOpen={isEditNoteOpen}
        setIsEditNoteOpen={setIsEditNoteOpen}
        newNoteValue={newNoteValue}
        setNewNoteValue={setNewNoteValue}
        handleConfirmEditNote={handleConfirmEditNote}
        isEditItemsOpen={isEditItemsOpen}
        setIsEditItemsOpen={setIsEditItemsOpen}
        editItemsTarget={editItemsTarget}
        handleConfirmEditItems={handleConfirmEditItems}
        isRepeatOrderOpen={isRepeatOrderOpen}
        setIsRepeatOrderOpen={setIsRepeatOrderOpen}
        repeatOrderTarget={repeatOrderTarget}
        handleConfirmRepeatOrder={handleConfirmRepeatOrder}
        isVoidOpen={isVoidOpen}
        setIsVoidOpen={setIsVoidOpen}
        voidReason={voidReason}
        setVoidReason={setVoidReason}
        handleConfirmVoid={handleConfirmVoid}
      />
      <ReturnItemsDialog orderId={returnOrderId} onClose={() => setReturnOrderId(null)} onDone={() => { void fetchOrders?.(); }} />
    </div>
  );
}

