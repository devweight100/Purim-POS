"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import {
  Search,
  DollarSign,
  ShoppingCart,
  Ban,
  CreditCard,
  User,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Printer,
  FileText,
  Edit3,
  RotateCcw,
  MoreVertical,
  Calendar,
  Layers,
  ChevronDown,
  Building2,
  QrCode,
  Banknote,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  ArrowRight,
  History,
  AlertCircle
} from "lucide-react";
import { useShiftStore } from "@/lib/store/shift-store";
import { useCartStore } from "@/lib/store/cart-store";
import { useProductStore } from "@/lib/store/product-store";
import { orders as masterMockOrders } from "@/lib/mock-data";
import { getCustomerById, rollbackCustomerSale } from "@/lib/customer-service";
import { restoreVoidOrderStock } from "@/lib/stock-service";
import { loadAllDebtRecords, getDebtRecordByOrderId } from "@/lib/debt-service";
import { DebtRecord, DebtPaymentInstallment } from "@/lib/types";
import { ReceiptA4PdfModal, ReceiptA4Data } from "@/components/pos/ReceiptA4PdfModal";
import { ReceiptPdfModal, ReceiptData } from "@/components/pos/ReceiptPdfModal";
import { DebtHistoryModal } from "@/components/debts/DebtHistoryModal";
import { DebtReceiptPdfModal } from "@/components/debts/DebtReceiptPdfModal";
import { toast } from "sonner";

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [productsMap, setProductsMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | "completed" | "voided">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Detail Dialog
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<any>(null);

  // 1. Full A4 Receipt Modal State
  const [a4ReceiptData, setA4ReceiptData] = useState<ReceiptA4Data | null>(null);
  const [isA4ReceiptOpen, setIsA4ReceiptOpen] = useState(false);

  // 2. 80mm Slip Receipt Modal State
  const [slipReceiptData, setSlipReceiptData] = useState<ReceiptData | null>(null);
  const [isSlipReceiptOpen, setIsSlipReceiptOpen] = useState(false);

  // 3. Edit Payment Method State
  const [editPaymentOrder, setEditPaymentOrder] = useState<any | null>(null);
  const [newPaymentMethod, setNewPaymentMethod] = useState<string>("CASH");
  const [isEditPaymentOpen, setIsEditPaymentOpen] = useState(false);

  // 4. Edit Note / Remarks State
  const [editNoteOrder, setEditNoteOrder] = useState<any | null>(null);
  const [newNoteValue, setNewNoteValue] = useState<string>("");
  const [isEditNoteOpen, setIsEditNoteOpen] = useState(false);

  // 5. Repeat Order Confirmation State
  const [repeatOrderTarget, setRepeatOrderTarget] = useState<any | null>(null);
  const [isRepeatOrderOpen, setIsRepeatOrderOpen] = useState(false);

  // 6. Edit Items & Re-checkout in POS Confirmation State
  const [editItemsTarget, setEditItemsTarget] = useState<any | null>(null);
  const [isEditItemsOpen, setIsEditItemsOpen] = useState(false);

  // 7. Void Order State
  const [voidTargetOrder, setVoidTargetOrder] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [isVoidOpen, setIsVoidOpen] = useState(false);

  // 8. Credit Payment History State (Uses unified DebtHistoryModal)
  const [creditHistoryOrder, setCreditHistoryOrder] = useState<any | null>(null);
  const [creditDebtRecord, setCreditDebtRecord] = useState<DebtRecord | null>(null);
  const [isCreditHistoryOpen, setIsCreditHistoryOpen] = useState(false);

  // 9. Debt Installment 80mm Receipt Modal State
  const [debtSlipModalOpen, setDebtSlipModalOpen] = useState(false);
  const [selectedDebtForSlip, setSelectedDebtForSlip] = useState<DebtRecord | null>(null);
  const [selectedInstallmentForSlip, setSelectedInstallmentForSlip] = useState<DebtPaymentInstallment | null>(null);

  const cart = useCartStore();
  const { products } = useProductStore();
  const shiftStore = useShiftStore();

  // Helper to detect if order is a Credit Sale
  const isOrderCredit = (order: any): boolean => {
    if (!order) return false;
    if (Array.isArray(order.payments) && order.payments.some((p: any) => p.method === "CREDIT_NOTE" || p.method === "CREDIT")) {
      return true;
    }
    const pm = (order.paymentMethod || "").toLowerCase();
    return pm.includes("เชื่อ") || pm.includes("credit");
  };

  // Helper to check if a credit order is fully paid
  const isCreditOrderFullyPaid = (order: any): boolean => {
    if (!isOrderCredit(order)) return true;
    const debt = getDebtRecordByOrderId(order.id || order.orderNumber);
    if (!debt) return false;
    return debt.remainingDebt <= 0 && debt.paidAmount > 0;
  };

  // Load product catalog for reliable name & unit lookups
  useEffect(() => {
    const loadCatalog = async () => {
      let prods: any[] = [];
      try {
        prods = await apiFetch("/products");
      } catch {
        prods = await api.getProducts();
      }

      if (typeof window !== "undefined") {
        try {
          const savedCustom = localStorage.getItem("custom_products");
          if (savedCustom) {
            const parsed = JSON.parse(savedCustom);
            if (Array.isArray(parsed) && parsed.length > 0) prods = parsed;
          }
        } catch {}
      }

      const map: Record<string, any> = {};
      prods.forEach((p) => {
        if (p.id) map[p.id] = p;
        if (p.sku) map[p.sku] = p;
      });
      setProductsMap(map);
    };

    loadCatalog();
  }, []);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      let fetchedBackend: any[] = [];
      try {
        let url = "/orders";
        const params = new URLSearchParams();
        if (startDate) params.append("startDate", startDate);
        if (endDate) params.append("endDate", endDate);
        if (params.toString()) {
          url += `?${params.toString()}`;
        }
        fetchedBackend = await apiFetch(url);
      } catch (e) {
        // Fallback gracefully
      }

      // 1. Get orders completed in local shift store
      const localOrders = useShiftStore.getState().completedOrders || [];

      // Merge and deduplicate
      const combinedMap = new Map<string, any>();

      // Master orders history (ORD-OFFLINE matching actual store products and member customers)
      masterMockOrders
        .filter((mOrder) => !mOrder.orderNumber?.startsWith('ORD-2026') && !mOrder.id?.startsWith('ORD-2026'))
        .forEach((mOrder) => {
          const key = mOrder.orderNumber || mOrder.id;
          if (key) {
            combinedMap.set(key, {
              ...mOrder,
              isSynced: true,
            });
          }
        });

      // Overlay local completed orders from POS checkouts
      localOrders
        .filter((o) => !o.orderNumber?.startsWith('ORD-2026') && !o.id?.startsWith('ORD-2026'))
        .forEach((o) => {
          const key = o.orderNumber || o.id;
          if (key) {
            combinedMap.set(key, {
              ...o,
              isSynced: o.isSynced ?? false,
            });
          }
        });

      if (Array.isArray(fetchedBackend) && fetchedBackend.length > 0) {
        fetchedBackend.forEach((bOrder) => {
          const key = bOrder.orderNumber || bOrder.id;
          let matchedKey = key;
          if (!combinedMap.has(key)) {
            const bTime = new Date(bOrder.createdAt).getTime();
            const bTotal = Number(bOrder.totalAmount || 0);

            for (const [lKey, lOrder] of Array.from(combinedMap.entries())) {
              const lTime = new Date(lOrder.createdAt).getTime();
              const lTotal = Number(lOrder.totalAmount || lOrder.total || 0);

              if (
                Math.abs(bTime - lTime) < 30000 &&
                Math.abs(bTotal - lTotal) < 0.01 &&
                (lOrder.items?.length || 0) === (bOrder.items?.length || 0)
              ) {
                matchedKey = lKey;
                break;
              }
            }
          }

          const existingLocal = combinedMap.get(matchedKey);
          if (matchedKey !== key) {
            combinedMap.delete(matchedKey);
          }

          const bItemsMapped = Array.isArray(bOrder.items)
            ? bOrder.items.map((it: any) => ({
                ...it,
                name: it.product?.name || it.name || productsMap[it.productId]?.name || "สินค้า",
                sku: it.product?.sku || it.sku || productsMap[it.productId]?.sku || "",
              }))
            : [];

          combinedMap.set(key, {
            ...bOrder,
            ...(existingLocal || {}),
            items: existingLocal?.items && existingLocal.items.length > 0 ? existingLocal.items : bItemsMapped,
            isSynced: true,
          });
        });
      }

      const all = Array.from(combinedMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setOrders(all);
    } catch (error) {
      toast.error("ดึงข้อมูลออเดอร์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [startDate, endDate]);

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
        const custMatch = (order.customerName || order.customer)?.toLowerCase().includes(q);
        const itemMatch = order.items?.some((i: any) => i.name?.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q));
        const noteMatch = order.note?.toLowerCase().includes(q);
        if (!numMatch && !custMatch && !itemMatch && !noteMatch) return false;
      }

      return true;
    });
  }, [orders, statusTab, search]);

  // Reset pagination when search or tab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusTab, pageSize]);

  // Paginated records
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredOrders.slice(start, start + pageSize);
  }, [filteredOrders, currentPage, pageSize]);

  // ─── Format Order to Full A4 Receipt ───
  const formatOrderToA4 = (order: any): ReceiptA4Data => {
    const customer = order.customerId ? getCustomerById(order.customerId) : null;
    return {
      orderNumber: order.orderNumber || order.id,
      createdAt: order.createdAt || new Date().toISOString(),
      customerName: order.customerName || order.customer || "ลูกค้าทั่วไป",
      customerPhone: customer?.phone || order.customerPhone,
      customerAddress: customer?.address || order.customerAddress,
      customerTaxId: customer?.taxId || order.customerTaxId,
      customerBranch: customer?.companyName ? "สำนักงานใหญ่" : undefined,
      customerCompany: customer?.companyName,
      userName: order.userName || "พนักงาน POS",
      items: (order.items || []).map((i: any) => ({
        sku: i.sku || i.code,
        name: i.name || i.productName || "สินค้า",
        quantity: i.quantity || 1,
        unitName: i.unitName || "ชิ้น",
        unitPrice: i.unitPrice || i.price || 0,
        lineTotal: i.lineTotal || i.quantity * (i.unitPrice || i.price || 0),
        discountAmount: i.discountAmount || 0,
      })),
      subtotal: order.subtotal || order.totalAmount || order.total || 0,
      billDiscountAmount: order.billDiscountAmount || 0,
      pointsDiscountAmount: order.pointsDiscountAmount || 0,
      pointsUsed: order.pointsUsed || 0,
      customerPointsEarned: order.customerPointsEarned,
      customerPointsBalance: order.customerPointsBalance,
      vatAmount: order.vatAmount || 0,
      totalAmount: order.totalAmount || order.total || 0,
      paymentMethod:
        order.payments?.length > 1
          ? "แบ่งชำระ (Split Payment)"
          : order.payments?.[0]?.method === "CASH"
          ? "เงินสด (Cash)"
          : order.payments?.[0]?.method === "QR_PROMPTPAY"
          ? "QR PromptPay"
          : order.payments?.[0]?.method === "CREDIT_CARD"
          ? "บัตรเครดิต"
          : order.payments?.[0]?.method === "CREDIT_NOTE"
          ? "เงินเชื่อ (Credit)"
          : order.paymentMethod || "เงินสด",
      payments: order.payments,
      cashReceived: order.cashReceived || order.payments?.[0]?.cashReceived,
      changeAmount: order.changeAmount || order.payments?.[0]?.changeAmount,
    };
  };

  // ─── Format Order to 80mm Slip ───
  const formatOrderToSlip = (order: any): ReceiptData => {
    return {
      orderNumber: order.orderNumber || order.id,
      createdAt: order.createdAt || new Date().toISOString(),
      customerName: order.customerName || order.customer || "ลูกค้าทั่วไป",
      userName: order.userName || "พนักงาน POS",
      items: (order.items || []).map((i: any) => ({
        name: i.name || i.productName || "สินค้า",
        quantity: i.quantity || 1,
        unitName: i.unitName || "ชิ้น",
        unitPrice: i.unitPrice || i.price || 0,
        lineTotal: i.lineTotal || i.quantity * (i.unitPrice || i.price || 0),
        discountAmount: i.discountAmount || 0,
      })),
      subtotal: order.subtotal || order.totalAmount || order.total || 0,
      billDiscountAmount: order.billDiscountAmount || 0,
      pointsDiscountAmount: order.pointsDiscountAmount || 0,
      pointsUsed: order.pointsUsed || 0,
      customerPointsEarned: order.customerPointsEarned,
      customerPointsBalance: order.customerPointsBalance,
      vatAmount: order.vatAmount || 0,
      totalAmount: order.totalAmount || order.total || 0,
      paymentMethod:
        order.payments?.length > 1
          ? "แบ่งชำระ (Split Payment)"
          : order.payments?.[0]?.method === "CASH"
          ? "เงินสด (Cash)"
          : order.payments?.[0]?.method === "QR_PROMPTPAY"
          ? "QR พร้อมเพย์"
          : order.payments?.[0]?.method === "CREDIT_CARD"
          ? "บัตรเครดิต"
          : order.payments?.[0]?.method === "CREDIT_NOTE"
          ? "เงินเชื่อ"
          : order.paymentMethod || "เงินสด",
      payments: order.payments,
      cashReceived: order.cashReceived || order.payments?.[0]?.cashReceived,
      changeAmount: order.changeAmount || order.payments?.[0]?.changeAmount,
    };
  };

  // ─── Normal A4 Print Handler ───
  const handleOpenA4Receipt = (order: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setA4ReceiptData(formatOrderToA4(order));
    setIsA4ReceiptOpen(true);
  };

  // ─── Open Credit Payment History Modal ───
  const handleOpenCreditHistory = (order: any, e?: React.MouseEvent) => {
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
      paymentMethod:
        inst.paymentMethod === "CASH"
          ? "เงินสด (Cash)"
          : inst.paymentMethod === "QR_PROMPTPAY"
          ? "QR PromptPay"
          : inst.paymentMethod === "TRANSFER"
          ? "โอนเงินผ่านธนาคาร"
          : inst.paymentMethod,
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

  const handleOpenSlipReceipt = (order: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSlipReceiptData(formatOrderToSlip(order));
    setIsSlipReceiptOpen(true);
  };

  // Populate items into cart
  const populateOrderToCart = (order: any) => {
    cart.clearCart();
    if (!order.items || order.items.length === 0) return;

    order.items.forEach((item: any) => {
      const product = products.find((p) => p.id === item.productId || p.sku === item.sku);
      if (product) {
        const unit = product.units?.find((u) => u.id === item.unitId || u.unitName === item.unitName) || product.units?.[0];
        for (let i = 0; i < (item.quantity || 1); i++) {
          cart.addItem(product, unit);
        }
        if (item.customPrice) {
          cart.setCustomPrice(product.id, item.customPrice, unit?.id);
        }
        if (item.discountValue > 0) {
          cart.setItemDiscount(product.id, item.discountType || "baht", item.discountValue, unit?.id);
        }
      }
    });

    if (order.customerId) {
      cart.setCustomer(order.customerId, order.customerName);
    }
  };

  // 1. Edit Items & Re-checkout in POS
  const handleStartEditItems = (order: any, e?: React.MouseEvent) => {
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
  const handleStartRepeatOrder = (order: any, e?: React.MouseEvent) => {
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
  const handleStartEditPayment = (order: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditPaymentOrder(order);
    const currMethod = order.payments?.[0]?.method || order.paymentMethod || "CASH";
    setNewPaymentMethod(currMethod);
    setIsEditPaymentOpen(true);
  };

  const handleConfirmEditPayment = async () => {
    if (!editPaymentOrder) return;
    const orderId = editPaymentOrder.orderNumber || editPaymentOrder.id;
    const oldMethod = editPaymentOrder.paymentMethod || editPaymentOrder.payments?.[0]?.method || "CASH";

    try {
      try {
        await apiFetch(`/orders/${editPaymentOrder.id}`, {
          method: "PATCH",
          body: JSON.stringify({ paymentMethod: newPaymentMethod }),
        });
      } catch (err) {}

      shiftStore.updateOrderPaymentMethod(
        orderId,
        oldMethod,
        [{ method: newPaymentMethod as any, amount: editPaymentOrder.totalAmount || editPaymentOrder.total || 0 }],
        editPaymentOrder.totalAmount || editPaymentOrder.total || 0
      );

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
    } catch (err) {
      toast.error("แก้ไขวิธีชำระเงินไม่สำเร็จ");
    }
  };

  // 4. Edit Note / Remarks
  const handleStartEditNote = (order: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditNoteOrder(order);
    setNewNoteValue(order.note || order.remarks || "");
    setIsEditNoteOpen(true);
  };

  const handleConfirmEditNote = async () => {
    if (!editNoteOrder) return;
    const orderId = editNoteOrder.orderNumber || editNoteOrder.id;

    try {
      try {
        await apiFetch(`/orders/${editNoteOrder.id}`, {
          method: "PATCH",
          body: JSON.stringify({ note: newNoteValue.trim() }),
        });
      } catch (err) {}

      shiftStore.updateOrderNote(orderId, newNoteValue);

      toast.success(`📝 อัปเดตหมายเหตุบิล #${orderId} เรียบร้อยแล้ว`);
      setIsEditNoteOpen(false);
      setEditNoteOrder(null);
      fetchOrders();
    } catch (err) {
      toast.error("แก้ไขหมายเหตุไม่สำเร็จ");
    }
  };

  // 5. Void Order
  const handleStartVoid = (order: any, e?: React.MouseEvent) => {
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
      try {
        await apiFetch(`/orders/${voidTargetOrder.id}/void`, {
          method: "POST",
          body: JSON.stringify({ reason: voidReason }),
        });
      } catch (err) {}

      shiftStore.voidOrder(voidTargetOrder.orderNumber || voidTargetOrder.id, voidReason);
      restoreVoidOrderStock(
        (voidTargetOrder.items || []).map((item: any) => ({
          productId: item.productId,
          quantity: item.quantity || 1,
          conversionFactor: item.conversionFactor || 1,
          name: item.name || item.productName,
          sku: item.sku,
          unitName: item.unitName,
        })),
        voidTargetOrder.orderNumber || voidTargetOrder.id,
        voidReason,
        voidTargetOrder.userName || "พนักงาน POS"
      );

      const isCreditSale = Array.isArray(voidTargetOrder.payments)
        ? voidTargetOrder.payments.some((p: any) => p.method === "CREDIT_NOTE" || p.method === "CREDIT")
        : String(voidTargetOrder.paymentMethod || "").includes("เชื่อ") || String(voidTargetOrder.paymentMethod || "").includes("เครดิต");
      rollbackCustomerSale(
        voidTargetOrder.customerId,
        Number(voidTargetOrder.totalAmount || voidTargetOrder.total || 0),
        isCreditSale,
        Number(voidTargetOrder.pointsUsed || 0)
      );

      toast.success(`✅ ยกเลิกบิล #${voidTargetOrder.orderNumber} คืนสต็อก และปรับแต้ม/หนี้สมาชิกเรียบร้อยแล้ว`);
      setIsVoidOpen(false);
      setIsDetailOpen(false);
      setVoidTargetOrder(null);
      setVoidReason("");
      fetchOrders();
    } catch (err) {
      toast.error("เกิดข้อผิดพลาดในการยกเลิกบิล");
    }
  };

  const handleRowClick = (order: any) => {
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

      {/* ─── TOP STATS CARDS (Compact Height, Larger Header Font matching debts page) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Card 1: Total Completed Orders (Inline) */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-sky-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-sky-50 text-sky-600 rounded-md border border-sky-100 shrink-0">
              <ShoppingCart className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-sky-950">ออเดอร์สำเร็จทั้งหมด:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-sky-700 tracking-tight">
              {stats.totalOrders}
            </span>
            <span className="text-xs text-slate-600 font-sans font-bold">บิล</span>
          </div>
        </div>

        {/* Card 2: Total Net Revenue (Inline) */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
              <DollarSign className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-emerald-950">ยอดขายรวมสุทธิ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-emerald-600 tracking-tight">
              {formatCurrency(stats.totalRevenue)}
            </span>
          </div>
        </div>

        {/* Card 3: Voided Orders (Inline) */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between bg-rose-50/20">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
              <Ban className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-rose-950">บิลที่ยกเลิก (Void):</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-rose-600 tracking-tight">
              {stats.voidedOrders}
            </span>
            <span className="text-xs text-rose-700 font-sans font-bold">บิล</span>
          </div>
        </div>
      </div>

      {/* ─── SEARCH & FILTER BAR ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs space-y-3">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/80">
            <button
              type="button"
              onClick={() => setStatusTab("all")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                statusTab === "all"
                  ? "bg-white text-slate-900 shadow-xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>ทั้งหมด ({stats.allCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setStatusTab("completed")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                statusTab === "completed"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>สำเร็จ ({stats.totalOrders})</span>
            </button>

            <button
              type="button"
              onClick={() => setStatusTab("voided")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                statusTab === "voided"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "text-rose-700 hover:bg-rose-50"
              }`}
            >
              <Ban className="w-3.5 h-3.5" />
              <span>ยกเลิกแล้ว ({stats.voidedOrders})</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-bold">ช่วงวันที่:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none shadow-2xs"
            />
            <span className="text-slate-400">-</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none shadow-2xs"
            />
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาตามเลขออเดอร์, ชื่อลูกค้า, หรือสินค้า..."
            className="pl-9 h-10 bg-slate-50 border-slate-300 rounded-xl focus:bg-white text-xs sm:text-sm font-medium shadow-inner"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
            >
              ล้าง
            </button>
          )}
        </div>
      </div>

      {/* ─── DATA TABLE ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/90 border-b border-slate-200">
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 pl-4 w-[160px]">เลขออเดอร์ / วันที่</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5">ลูกค้า / ผู้ซื้อ</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 text-right w-[100px]">รายการ</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 text-right w-[120px]">ยอดรวมสุทธิ</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 text-center w-[140px]">ช่องทางชำระ</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 text-center w-[120px]">สถานะ</TableHead>
                <TableHead className="font-bold text-slate-800 text-xs py-3.5 text-center w-[250px] pr-4">
                  🖨️ พิมพ์ใบเสร็จ & การจัดการ
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody className="divide-y divide-slate-100">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    กำลังโหลดข้อมูลออเดอร์...
                  </TableCell>
                </TableRow>
              ) : paginatedOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-14 text-slate-400 text-xs">
                    <div className="flex flex-col items-center gap-2">
                      <FileText className="w-8 h-8 text-slate-300" />
                      <span className="font-bold text-slate-600 text-sm">ไม่พบข้อมูลออเดอร์ตามเงื่อนไข</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedOrders.map((order) => {
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
                      {/* 1. Order Number & Date */}
                      <TableCell className="py-3 pl-4 font-mono">
                        <div className="font-bold text-indigo-600 text-xs">{order.orderNumber}</div>
                        <div className="text-[10.5px] text-slate-500 mt-0.5">
                          {new Date(order.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                        </div>
                      </TableCell>

                      {/* 2. Customer Name */}
                      <TableCell className="py-3">
                        <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span>{order.customerName || order.customer || "ลูกค้าทั่วไป"}</span>
                        </div>
                      </TableCell>

                      {/* 3. Items Count */}
                      <TableCell className="py-3 text-right font-bold text-xs text-slate-700 font-mono">
                        {itemsCount} รายการ
                      </TableCell>

                      {/* 4. Total Amount */}
                      <TableCell className="py-3 text-right font-black text-sm text-slate-900 font-mono">
                        {formatCurrency(total)}
                      </TableCell>

                      {/* 5. Payment Channel */}
                      <TableCell className="py-3 text-center">
                        <div className="flex gap-1 justify-center flex-wrap">
                          {order.payments && order.payments.length > 0 ? (
                            order.payments.map((p: any, i: number) => (
                              <Badge
                                key={i}
                                variant="outline"
                                className={`text-[10px] font-bold px-1.5 py-0.5 ${
                                  p.method === "CREDIT_NOTE" || p.method === "CREDIT"
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
                                  : p.method === "CREDIT_NOTE" || p.method === "CREDIT"
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
                                  onClick={(e) => handleOpenCreditHistory(order, e as any)}
                                  className="font-bold text-amber-800 py-2 rounded-xl cursor-pointer bg-amber-50/50 hover:bg-amber-100"
                                >
                                  <History className="w-4 h-4 mr-2 text-amber-600" />
                                  ประวัติชำระ & ออกใบเสร็จตามจริง
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={(e) => handleOpenA4Receipt(order, e as any)}
                                  className="font-bold text-indigo-700 py-2 rounded-xl cursor-pointer"
                                >
                                  <FileText className="w-4 h-4 mr-2" />
                                  พิมพ์ใบเสร็จเต็มรูปแบบ (A4)
                                </DropdownMenuItem>
                              )}

                              <DropdownMenuItem
                                onClick={(e) => handleOpenSlipReceipt(order, e as any)}
                                className="font-medium text-slate-700 py-2 rounded-xl cursor-pointer"
                              >
                                <Printer className="w-4 h-4 mr-2" />
                                พิมพ์สลิปใบเสร็จ 80mm
                              </DropdownMenuItem>

                              <DropdownMenuSeparator className="my-1" />

                              {!isVoid && (
                                <>
                                  <DropdownMenuItem
                                    onClick={(e) => handleStartEditPayment(order, e as any)}
                                    className="font-bold text-slate-800 py-2 rounded-xl cursor-pointer hover:bg-slate-50"
                                  >
                                    <CreditCard className="w-4 h-4 mr-2 text-emerald-600" />
                                    เปลี่ยนวิธีชำระเงิน
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    onClick={(e) => handleStartEditItems(order, e as any)}
                                    className="font-bold text-slate-800 py-2 rounded-xl cursor-pointer hover:bg-slate-50"
                                  >
                                    <Edit3 className="w-4 h-4 mr-2 text-sky-600" />
                                    ดึงไปแก้ไขในหน้าขาย (POS)
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    onClick={(e) => handleStartRepeatOrder(order, e as any)}
                                    className="font-medium text-slate-700 py-2 rounded-xl cursor-pointer hover:bg-slate-50"
                                  >
                                    <RotateCcw className="w-4 h-4 mr-2 text-indigo-600" />
                                    สั่งซ้ำ (ลงตะกร้า)
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    onClick={(e) => handleStartEditNote(order, e as any)}
                                    className="font-medium text-slate-700 py-2 rounded-xl cursor-pointer hover:bg-slate-50"
                                  >
                                    <FileText className="w-4 h-4 mr-2 text-amber-600" />
                                    แก้ไขหมายเหตุ / โน้ต
                                  </DropdownMenuItem>

                                  <DropdownMenuSeparator className="my-1" />

                                  <DropdownMenuItem
                                    onClick={(e) => handleStartVoid(order, e as any)}
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
              {filteredOrders.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
            </span>{" "}
            -{" "}
            <span className="font-bold text-slate-800">
              {Math.min(currentPage * pageSize, filteredOrders.length)}
            </span>{" "}
            จากทั้งหมด <span className="font-bold text-slate-800">{filteredOrders.length.toLocaleString()}</span> บิล
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-slate-600">
              <span>แสดงหน้าละ:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
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
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto p-5 sm:p-7 rounded-3xl shadow-2xl">
          <DialogHeader className="border-b border-slate-200 pb-3">
            <DialogTitle className="flex justify-between items-center mr-4">
              <span className="text-xl font-extrabold text-slate-900">
                รายละเอียดออเดอร์ {currentOrder?.orderNumber}
              </span>
              {currentOrder?.status === "VOIDED" || currentOrder?.status === "CANCELLED" ? (
                <Badge className="bg-rose-100 text-rose-700 border-rose-300 text-xs px-3 py-1 font-bold">
                  ยกเลิกแล้ว
                </Badge>
              ) : isOrderCredit(currentOrder) ? (
                isCreditOrderFullyPaid(currentOrder) ? (
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-xs px-3 py-1">
                    สำเร็จ
                  </Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-xs px-3 py-1">
                    เงินเชื่อ
                  </Badge>
                )
              ) : (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-xs px-3 py-1">
                  สำเร็จ
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {currentOrder && (
            <div className="space-y-4 py-2 text-xs">
              {/* Top Details Box */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div>
                  <span className="text-slate-500 block mb-0.5">วันที่ / เวลาขาย</span>
                  <span className="font-bold text-slate-900 text-sm">{formatDate(currentOrder.createdAt)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5">ชื่อลูกค้า</span>
                  <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-sky-600" />
                    {currentOrder.customerName || currentOrder.customer || "ลูกค้าทั่วไป"}
                  </span>
                </div>
                {currentOrder.voidReason && (
                  <div className="col-span-1 sm:col-span-2 pt-2 border-t border-slate-200">
                    <span className="text-rose-600 font-bold block mb-0.5">เหตุผลที่ยกเลิก:</span>
                    <span className="text-slate-700 bg-rose-50 p-2 rounded-xl border border-rose-200 block">
                      {currentOrder.voidReason}
                    </span>
                  </div>
                )}
              </div>

              {/* Items Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="font-bold text-slate-800 text-xs">รายการสินค้า</TableHead>
                      <TableHead className="text-center font-bold text-slate-800 text-xs">จำนวน</TableHead>
                      <TableHead className="text-right font-bold text-slate-800 text-xs">ราคา/หน่วย</TableHead>
                      <TableHead className="text-right font-bold text-slate-800 text-xs">รวม</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-100">
                    {(currentOrder.items || []).map((item: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-bold text-slate-800 text-xs">
                          {item.name || item.productName || "สินค้า"}
                        </TableCell>
                        <TableCell className="text-center font-mono font-bold text-xs">
                          {item.quantity} {item.unitName || "ชิ้น"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCurrency(item.unitPrice || item.price || 0)}
                        </TableCell>
                        <TableCell className="text-right font-bold font-mono text-xs">
                          {formatCurrency(item.lineTotal || item.quantity * (item.unitPrice || item.price || 0))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Financial Calculation Summary */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1.5">
                <div className="flex justify-between text-slate-600">
                  <span>รวมราคาสินค้า:</span>
                  <span className="font-mono font-bold">{formatCurrency(currentOrder.subtotal || currentOrder.totalAmount || 0)}</span>
                </div>
                {currentOrder.billDiscountAmount > 0 && (
                  <div className="flex justify-between text-rose-600 font-semibold">
                    <span>ส่วนลดท้ายบิล:</span>
                    <span className="font-mono">-{formatCurrency(currentOrder.billDiscountAmount)}</span>
                  </div>
                )}
                {currentOrder.pointsDiscountAmount > 0 && (
                  <div className="flex justify-between text-amber-800 font-bold">
                    <span>ส่วนลดแต้มสะสม:</span>
                    <span className="font-mono">-{formatCurrency(currentOrder.pointsDiscountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-slate-900">
                  <span className="font-bold text-sm">ยอดเงินรวมสุทธิ:</span>
                  <span className="font-black text-2xl text-indigo-700 font-mono">
                    {formatCurrency(currentOrder.totalAmount || currentOrder.total || 0)}
                  </span>
                </div>
              </div>

              {/* Action Buttons inside Modal */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200">
                <div className="flex flex-wrap gap-2">
                  {isOrderCredit(currentOrder) ? (
                    <Button
                      size="sm"
                      onClick={(e) => handleOpenCreditHistory(currentOrder, e)}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs gap-1.5"
                    >
                      <History className="w-4 h-4" />
                      <span>ประวัติชำระ & ออกใบเสร็จ</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={(e) => handleOpenA4Receipt(currentOrder, e)}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs gap-1.5"
                    >
                      <FileText className="w-4 h-4" />
                      <span>พิมพ์ใบเสร็จเต็มรูปแบบ (A4)</span>
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => handleOpenSlipReceipt(currentOrder, e)}
                    className="border-slate-300 text-slate-700 font-semibold text-xs h-9 px-3 rounded-xl gap-1.5"
                  >
                    <Printer className="w-4 h-4" />
                    <span>พิมพ์สลิป 80mm</span>
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {currentOrder.status !== "VOIDED" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => handleStartEditPayment(currentOrder, e)}
                        className="border-emerald-300 text-emerald-800 hover:bg-emerald-50 font-bold text-xs h-9 px-3 rounded-xl"
                      >
                        <CreditCard className="w-3.5 h-3.5 mr-1" />
                        เปลี่ยนวิธีชำระ
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => handleStartEditItems(currentOrder, e)}
                        className="border-sky-300 text-sky-800 hover:bg-sky-50 font-bold text-xs h-9 px-3 rounded-xl"
                      >
                        <Edit3 className="w-3.5 h-3.5 mr-1" />
                        แก้ไขในหน้าขาย
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => handleStartVoid(currentOrder, e)}
                        className="border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs h-9 px-3 rounded-xl"
                      >
                        <Ban className="w-3.5 h-3.5 mr-1" />
                        ยกเลิกบิล
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 6. Edit Payment Method Modal */}
      <Dialog open={isEditPaymentOpen} onOpenChange={setIsEditPaymentOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <CreditCard className="w-5 h-5 text-indigo-600" />
              <span>เปลี่ยนช่องทางการชำระเงิน</span>
            </DialogTitle>
          </DialogHeader>

          {editPaymentOrder && (
            <div className="space-y-4 py-2 text-xs">
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 flex justify-between">
                <div>
                  <span className="text-slate-500 block">เลขออเดอร์</span>
                  <span className="font-bold text-slate-900 font-mono">{editPaymentOrder.orderNumber}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block">ยอดรวมทั้งสิ้น</span>
                  <span className="font-black text-indigo-700 font-mono text-sm">
                    {formatCurrency(editPaymentOrder.totalAmount || editPaymentOrder.total || 0)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="font-bold text-slate-700 block">เลือกช่องทางการชำระเงินใหม่:</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "CASH", label: "💵 เงินสด (Cash)" },
                    { id: "QR_PROMPTPAY", label: "📱 QR พร้อมเพย์" },
                    { id: "TRANSFER", label: "🏦 โอนเงินผ่านธนาคาร" },
                    { id: "CREDIT_CARD", label: "💳 บัตรเครดิต" },
                  ].map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setNewPaymentMethod(method.id)}
                      className={`p-3 rounded-2xl border text-xs font-bold transition-all text-left flex items-center justify-between ${
                        newPaymentMethod === method.id
                          ? "border-indigo-600 bg-indigo-50 text-indigo-900 shadow-xs"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      <span>{method.label}</span>
                      {newPaymentMethod === method.id && <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsEditPaymentOpen(false)} className="text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmEditPayment} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 rounded-xl shadow-xs">
              บันทึกการเปลี่ยนแปลง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 7. Edit Note Dialog */}
      <Dialog open={isEditNoteOpen} onOpenChange={setIsEditNoteOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <FileText className="w-5 h-5 text-amber-600" />
              <span>แก้ไขหมายเหตุ / โน้ตบิล</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <label className="font-bold text-slate-700 block">ระบุข้อความหมายเหตุบิล:</label>
            <textarea
              value={newNoteValue}
              onChange={(e) => setNewNoteValue(e.target.value)}
              placeholder="พิมพ์หมายเหตุท้ายบิล เช่น ที่อยู่ส่งของ, โครงการ..."
              rows={3}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs text-slate-900 outline-none focus:bg-white focus:border-indigo-500 shadow-inner"
            />
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsEditNoteOpen(false)} className="text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmEditNote} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-5 rounded-xl shadow-xs">
              บันทึกหมายเหตุ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 8. Edit Items & Re-checkout Confirmation Dialog */}
      <Dialog open={isEditItemsOpen} onOpenChange={setIsEditItemsOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <Edit3 className="w-5 h-5 text-sky-600" />
              <span>ดึงบิลไปแก้ไขในหน้าขาย (POS)</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 text-xs text-slate-600 space-y-2">
            <p>
              ระบบจะทำการล้างตะกร้าปัจจุบัน และนำรายการสินค้าของบิล{" "}
              <b className="font-mono text-slate-900">{editItemsTarget?.orderNumber}</b> ไปเปิดในหน้าขาย
            </p>
            <p className="bg-sky-50 text-sky-900 p-3 rounded-xl border border-sky-200 leading-relaxed font-semibold">
              💡 คุณสามารถเพิ่ม/ลดจำนวน ปรับส่วนลด และเมื่อกดชำระเงิน ระบบจะบันทึกทับบิลเดิมให้อัตโนมัติ
            </p>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsEditItemsOpen(false)} className="text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmEditItems} className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-5 rounded-xl shadow-xs">
              ไปหน้าขายทันที
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 9. Repeat Order Confirmation Dialog */}
      <Dialog open={isRepeatOrderOpen} onOpenChange={setIsRepeatOrderOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <RotateCcw className="w-5 h-5 text-indigo-600" />
              <span>สั่งซื้อซ้ำ (Repeat Order)</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 text-xs text-slate-600 space-y-2">
            <p>
              คุณต้องการคัดลอกรายการสินค้าจากบิล{" "}
              <b className="font-mono text-slate-900">{repeatOrderTarget?.orderNumber}</b> ลงในตะกร้าหน้าขายเพื่อเปิดบิลใหม่ใช่หรือไม่?
            </p>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsRepeatOrderOpen(false)} className="text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmRepeatOrder} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 rounded-xl shadow-xs">
              คัดลอกลงตะกร้า
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 10. Void Order Dialog */}
      <Dialog open={isVoidOpen} onOpenChange={setIsVoidOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-rose-600 flex items-center gap-2 text-lg font-bold">
              <Ban className="w-5 h-5" />
              <span>ยืนยันการยกเลิกบิล (Void Order)</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-3 space-y-3 text-xs">
            <p className="text-slate-600 leading-relaxed">
              การยกเลิกบิลจะทำการคืนสต็อกสินค้าเข้าสู่ระบบอัตโนมัติ และออเดอร์นี้จะไม่ถูกนำไปคิดรวมในยอดขายสุทธิ
            </p>
            <div className="space-y-1.5">
              <label className="font-bold text-slate-700 block">ระบุเหตุผลที่ยกเลิก *</label>
              <Input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="เช่น ลูกค้าขอคืนสินค้า, คีย์รายการผิดพลาด..."
                className="bg-white border-slate-300 h-10 text-slate-900 text-xs rounded-xl shadow-inner"
              />
            </div>
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100 flex justify-between">
            <Button variant="ghost" onClick={() => setIsVoidOpen(false)} className="text-slate-600">
              ย้อนกลับ
            </Button>
            <Button onClick={handleConfirmVoid} className="bg-rose-600 hover:bg-rose-700 text-white font-bold h-10 px-5 rounded-xl shadow-sm">
              ยืนยันยกเลิกบิล
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
