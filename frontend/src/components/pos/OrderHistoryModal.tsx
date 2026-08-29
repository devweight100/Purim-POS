import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useShiftStore } from '@/lib/store/shift-store';
import { useCartStore } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';
import { rollbackCustomerSale } from '@/lib/customer-service';
import { restoreVoidOrderStock } from '@/lib/stock-service';
import { ReceiptPdfModal, ReceiptData } from './ReceiptPdfModal';
import { PaymentModal } from './PaymentModal';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Clock, Search, Calendar, ChevronDown, FileText, 
  RotateCcw, Ban, CheckCircle2, AlertTriangle, TrendingUp,
  Package, CreditCard, Edit3
} from 'lucide-react';
import { toast } from 'sonner';

interface OrderHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPaymentModal?: () => void;
}

export function OrderHistoryModal({ open, onOpenChange, onOpenPaymentModal }: OrderHistoryModalProps) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'completed' | 'cancelled'>('completed');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<'today' | '7days' | 'this_month' | 'all'>('today');

  // Pagination state
  const [pageSize, setPageSize] = useState(8);
  const [currentPage, setCurrentPage] = useState(1);

  // PDF Receipt Modal state
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptData | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  // 1. View Items Breakdown Modal State
  const [viewItemsOrder, setViewItemsOrder] = useState<any | null>(null);

  // 2. Repeat Order Confirmation State (Warning before clearing cart)
  const [repeatConfirmOrder, setRepeatConfirmOrder] = useState<any | null>(null);

  // 3. Edit Payment Method State
  const [editPaymentOrder, setEditPaymentOrder] = useState<any | null>(null);
  const [newPaymentMethod, setNewPaymentMethod] = useState<string>('CASH');

  // 4. Edit Line Items & Re-checkout Confirmation State
  const [editItemsTargetOrder, setEditItemsTargetOrder] = useState<any | null>(null);

  // Void confirmation state
  const [voidTargetOrder, setVoidTargetOrder] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const cart = useCartStore();
  const { products } = useProductStore();
  const shiftStore = useShiftStore();

  const fetchOrders = async () => {
    setLoading(true);
    try {
      let fetchedBackend: any[] = [];
      try {
        fetchedBackend = await apiFetch('/orders');
      } catch (e) {
        // Fallback gracefully if backend is offline
      }

      const localOrders = useShiftStore.getState().completedOrders || [];
      const combinedMap = new Map<string, any>();

      // Load local shift store orders first
      localOrders.forEach((o) => {
        const key = o.orderNumber || o.id;
        if (key) combinedMap.set(key, o);
      });

      // Merge backend orders
      fetchedBackend.forEach((o) => {
        const key = o.orderNumber || o.id;
        if (key) {
          const existing = combinedMap.get(key);
          combinedMap.set(key, { ...existing, ...o });
        }
      });

      const list = Array.from(combinedMap.values()).sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      setOrders(list);
    } catch (err) {
      toast.error('ดึงข้อมูลประวัติการขายไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchOrders();
      setCurrentPage(1);
    }
  }, [open]);

  // Filter orders by date range and search query (without tab filter)
  const dateFilteredOrders = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    return orders.filter((order) => {
      // 1. Date Range Filter
      const orderTime = new Date(order.createdAt).getTime();
      if (dateRange === 'today' && orderTime < todayStart) return false;
      if (dateRange === '7days' && orderTime < todayStart - 7 * 24 * 60 * 60 * 1000) return false;
      if (dateRange === 'this_month') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        if (orderTime < monthStart) return false;
      }

      // 2. Search Filter
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const numMatch = order.orderNumber?.toLowerCase().includes(q);
        const custMatch = order.customerName?.toLowerCase().includes(q);
        const itemMatch = order.items?.some((i: any) => i.name?.toLowerCase().includes(q));
        if (!numMatch && !custMatch && !itemMatch) return false;
      }

      return true;
    });
  }, [orders, dateRange, search]);

  // Counts based strictly on dateFilteredOrders
  const completedCount = useMemo(() => {
    return dateFilteredOrders.filter((o) => o.status !== 'CANCELLED' && o.status !== 'VOIDED').length;
  }, [dateFilteredOrders]);

  const cancelledCount = useMemo(() => {
    return dateFilteredOrders.filter((o) => o.status === 'CANCELLED' || o.status === 'VOIDED').length;
  }, [dateFilteredOrders]);

  // Filter orders by tab
  const filteredOrders = useMemo(() => {
    return dateFilteredOrders.filter((order) => {
      const isCancelled = order.status === 'CANCELLED' || order.status === 'VOIDED';
      if (activeTab === 'completed' && isCancelled) return false;
      if (activeTab === 'cancelled' && !isCancelled) return false;
      return true;
    });
  }, [dateFilteredOrders, activeTab]);

  // Summary stats
  const totalSalesAmount = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  }, [filteredOrders]);

  // Paginated orders
  const totalPages = Math.ceil(filteredOrders.length / pageSize) || 1;
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredOrders.slice(start, start + pageSize);
  }, [filteredOrders, currentPage, pageSize]);

  // Handle viewing receipt PDF
  const handleViewReceipt = (order: any) => {
    const receiptData: ReceiptData = {
      orderNumber: order.orderNumber || order.id,
      createdAt: order.createdAt,
      customerName: order.customerName || 'ลูกค้าทั่วไป',
      userName: order.userName || 'พนักงาน POS',
      items: (order.items || []).map((i: any) => ({
        name: i.name || i.productName || 'สินค้า',
        quantity: i.quantity || 1,
        unitName: i.unitName || 'ชิ้น',
        unitPrice: i.unitPrice || i.price || 0,
        lineTotal: i.lineTotal || (i.quantity * (i.unitPrice || i.price || 0)),
        itemNote: i.itemNote || i.note
      })),
      subtotal: order.subtotal || order.totalAmount || 0,
      billDiscountAmount: order.billDiscountAmount || 0,
      vatAmount: order.vatAmount || 0,
      totalAmount: order.totalAmount || 0,
      paymentMethod: order.payments?.length > 1 ? 'แบ่งชำระ (Split Payment)' : 
                    order.payments?.[0]?.method === 'CASH' ? 'เงินสด' : 
                    order.payments?.[0]?.method === 'QR_PROMPTPAY' ? 'คิวอาร์ (พร้อมเพย์)' : 
                    order.payments?.[0]?.method === 'CREDIT_CARD' ? 'บัตรเครดิต' : 
                    order.paymentMethod || 'โอน',
      payments: order.payments,
      cashReceived: order.payments?.[0]?.cashReceived || order.cashReceived,
      changeAmount: order.payments?.[0]?.changeAmount || order.changeAmount,
      note: order.note || order.remarks || undefined
    };

    setSelectedReceipt(receiptData);
    setIsReceiptOpen(true);
  };

  // Populate items into cart for Repeat Order or Edit Order
  const populateOrderToCart = (order: any) => {
    cart.clearCart();
    if (!order.items || order.items.length === 0) return;

    let addedCount = 0;
    order.items.forEach((item: any) => {
      const product = products.find(p => p.id === item.productId || p.sku === item.sku);
      if (product) {
        const unit = product.units.find(u => u.id === item.unitId || u.unitName === item.unitName) || product.units[0];
        for (let i = 0; i < item.quantity; i++) {
          cart.addItem(product, unit);
        }
        if (item.customPrice) {
          cart.setCustomPrice(product.id, item.customPrice, unit.id);
        }
        if (item.discountValue > 0) {
          cart.setItemDiscount(product.id, item.discountType || 'baht', item.discountValue, unit.id);
        }
        if (item.itemNote || item.note) {
          cart.setItemNote(product.id, item.itemNote || item.note, unit.id);
        }
        addedCount++;
      }
    });

    if (order.customerId) {
      cart.setCustomer(order.customerId, order.customerName);
    }
  };

  // Handle Repeat Order click (Check if cart has items first!)
  const handleRepeatOrderClick = (order: any) => {
    if (cart.items.length > 0) {
      setRepeatConfirmOrder(order);
    } else {
      populateOrderToCart(order);
      onOpenChange(false);
      toast.success(`📌 ดึงรายการบิล #${order.orderNumber} ลงในตะกร้าแล้ว!`);
    }
  };

  // Confirm Repeat Order with Cart Clearing
  const handleConfirmRepeatOrder = () => {
    if (repeatConfirmOrder) {
      populateOrderToCart(repeatConfirmOrder);
      toast.success(`📌 ล้างตะกร้าเดิม และดึงรายการบิล #${repeatConfirmOrder.orderNumber} เรียบร้อยแล้ว!`);
      setRepeatConfirmOrder(null);
      onOpenChange(false);
    }
  };

  // Confirm Edit Order (Load to cart + Set editingOrderId)
  const handleConfirmEditItems = () => {
    if (editItemsTargetOrder) {
      populateOrderToCart(editItemsTargetOrder);
      cart.setEditingOrderId(editItemsTargetOrder.orderNumber || editItemsTargetOrder.id);
      toast.success(`✏️ ดึงบิล #${editItemsTargetOrder.orderNumber} มาแก้ไขแล้ว เมื่อกดชำระเงินจะทับบิลเดิมให้อัตโนมัติ`);
      setEditItemsTargetOrder(null);
      onOpenChange(false);
    }
  };

  // Confirm Edit Payment Method
  const handleConfirmEditPayment = async () => {
    if (!editPaymentOrder) return;
    const orderId = editPaymentOrder.orderNumber || editPaymentOrder.id;
    const oldMethod = editPaymentOrder.paymentMethod || editPaymentOrder.payments?.[0]?.method || 'CASH';

    try {
      // 1. Call Backend Update API if available
      try {
        await apiFetch(`/orders/${editPaymentOrder.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ paymentMethod: newPaymentMethod })
        });
      } catch (err) {}

      // 2. Update Shift Store Sales Accounting & Order
      shiftStore.updateOrderPaymentMethod(
        orderId, 
        oldMethod, 
        [{ method: newPaymentMethod as any, amount: editPaymentOrder.totalAmount || 0 }], 
        editPaymentOrder.totalAmount || 0
      );

      const methodNames: Record<string, string> = {
        'CASH': 'เงินสด',
        'QR_PROMPTPAY': 'คิวอาร์ (พร้อมเพย์)',
        'CREDIT_CARD': 'บัตรเครดิต',
        'TRANSFER': 'โอนเงิน'
      };

      toast.success(`✅ เปลี่ยนวิธีชำระเงินบิล #${orderId} เป็น "${methodNames[newPaymentMethod] || newPaymentMethod}" เรียบร้อยแล้ว`);
      setEditPaymentOrder(null);
      fetchOrders();
    } catch (err) {
      toast.error('แก้ไขวิธีชำระเงินไม่สำเร็จ');
    }
  };

  // Handle void order (ยกเลิกบิล & คืนเงินออกจากระบบ)
  const handleConfirmVoid = async () => {
    if (!voidTargetOrder) return;
    if (!voidReason.trim()) {
      toast.error('กรุณาระบุเหตุผลการยกเลิกบิล');
      return;
    }

    try {
      try {
        await apiFetch(`/orders/${voidTargetOrder.id}/void`, {
          method: 'POST',
          body: JSON.stringify({ reason: voidReason })
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
        voidTargetOrder.userName || 'พนักงาน POS'
      );

      const isCreditSale = Array.isArray(voidTargetOrder.payments)
        ? voidTargetOrder.payments.some((p: any) => p.method === 'CREDIT_NOTE' || p.method === 'CREDIT')
        : String(voidTargetOrder.paymentMethod || '').includes('เชื่อ') || String(voidTargetOrder.paymentMethod || '').includes('เครดิต');
      rollbackCustomerSale(
        voidTargetOrder.customerId,
        Number(voidTargetOrder.totalAmount || voidTargetOrder.total || 0),
        isCreditSale,
        Number(voidTargetOrder.pointsUsed || 0)
      );

      toast.success(`✅ ยกเลิกบิล #${voidTargetOrder.orderNumber} คืนสต๊อก และปรับแต้ม/หนี้สมาชิกเรียบร้อยแล้ว`);
      setVoidTargetOrder(null);
      setVoidReason('');
      fetchOrders();
    } catch (err) {
      toast.error('เกิดข้อผิดพลาดในการยกเลิกบิล');
    }
  };

  const getPaymentBadge = (methodStr?: string, payments?: any[]) => {
    if (payments && payments.length > 1) {
      const details = payments.map(p => {
        const name = p.method === 'CASH' ? 'เงินสด' : p.method === 'QR_PROMPTPAY' ? 'QR' : 'โอน';
        return `${name} ${formatCurrency(p.amount)}`;
      }).join(' + ');
      return (
        <Badge className="bg-indigo-100 text-indigo-900 border border-indigo-300 font-bold hover:bg-indigo-100" title={details}>
          🔀 แบ่งชำระ ({payments.length} ช่องทาง)
        </Badge>
      );
    }

    const m = payments?.[0]?.method || methodStr || '';
    if (m === 'CASH' || m === 'เงินสด') {
      return <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold hover:bg-emerald-100">เงินสด</Badge>;
    }
    if (m === 'QR_PROMPTPAY' || m?.includes('คิวอาร์') || m?.includes('พร้อมเพย์')) {
      return <Badge className="bg-sky-100 text-sky-800 border border-sky-300 font-bold hover:bg-sky-100">คิวอาร์ (พร้อมเพย์)</Badge>;
    }
    if (m === 'CREDIT_CARD' || m?.includes('บัตร')) {
      return <Badge className="bg-purple-100 text-purple-800 border border-purple-300 font-bold hover:bg-purple-100">บัตรเครดิต</Badge>;
    }
    if (m === 'SPLIT' || m?.includes('แบ่ง')) {
      return <Badge className="bg-indigo-100 text-indigo-900 border border-indigo-300 font-bold hover:bg-indigo-100">🔀 แบ่งชำระ</Badge>;
    }
    return <Badge className="bg-amber-100 text-amber-800 border border-amber-300 font-bold hover:bg-amber-100">โอนเงิน</Badge>;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] max-w-5xl bg-white border-slate-200 text-slate-900 rounded-3xl p-6 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <DialogHeader className="flex flex-row items-center justify-between border-b border-slate-200 pb-4 shrink-0">
            <DialogTitle className="text-2xl font-black text-slate-900 flex items-center gap-2.5">
              <Clock className="w-7 h-7 text-amber-500" />
              <span>ประวัติการขาย</span>
            </DialogTitle>
          </DialogHeader>

          {/* Filter Bar (POSPOS Style) */}
          <div className="py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 shrink-0">
            {/* Tabs */}
            <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200">
              <button
                type="button"
                onClick={() => { setActiveTab('completed'); setCurrentPage(1); }}
                className={`px-4 py-1.5 text-sm font-extrabold rounded-xl transition-all ${
                  activeTab === 'completed' 
                    ? 'bg-emerald-600 text-white shadow-sm' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                สำเร็จ ({completedCount})
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('cancelled'); setCurrentPage(1); }}
                className={`px-4 py-1.5 text-sm font-extrabold rounded-xl transition-all ${
                  activeTab === 'cancelled' 
                    ? 'bg-rose-600 text-white shadow-sm' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ยกเลิก ({cancelledCount})
              </button>
            </div>

            {/* Search Box */}
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                placeholder="ค้นหาเลขที่บิล, ชื่อลูกค้า..."
                className="pl-10 h-10 bg-slate-50 border-slate-300 text-sm font-semibold rounded-xl focus:border-amber-500 focus:bg-white"
              />
            </div>

            {/* Date Range Dropdown */}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400 hidden sm:block" />
              <select
                value={dateRange}
                onChange={(e) => { setDateRange(e.target.value as any); setCurrentPage(1); }}
                className="h-10 bg-slate-50 border border-slate-300 text-slate-800 text-sm font-bold rounded-xl px-3 outline-none cursor-pointer hover:bg-slate-100"
              >
                <option value="today">วันนี้</option>
                <option value="7days">7 วันล่าสุด</option>
                <option value="this_month">เดือนนี้</option>
                <option value="all">ทั้งหมด</option>
              </select>

              {/* Summary Sales Badge */}
              <div className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-default">
                <TrendingUp className="w-4 h-4" />
                <span>รวม {filteredOrders.length} บิล ({formatCurrency(totalSalesAmount)})</span>
              </div>
            </div>
          </div>

          {/* Orders Table */}
          <div className="flex-1 overflow-y-auto min-h-[300px] py-2">
            {loading ? (
              <div className="py-20 text-center text-slate-400 font-bold">กำลังโหลดข้อมูลประวัติการขาย...</div>
            ) : paginatedOrders.length === 0 ? (
              <div className="py-20 text-center text-slate-400 font-semibold space-y-2">
                <Clock className="w-12 h-12 mx-auto opacity-30" />
                <p>ไม่พบรายการประวัติการขายที่ตรงกับเงื่อนไข</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-bold bg-slate-50/80 sticky top-0">
                    <th className="py-3 px-3">ใบเสร็จ</th>
                    <th className="py-3 px-3">ลูกค้า</th>
                    <th className="py-3 px-3 text-center">รายการ</th>
                    <th className="py-3 px-3">วันที่/เวลา</th>
                    <th className="py-3 px-3">ชำระเงิน</th>
                    <th className="py-3 px-3 text-right">รวมทั้งสิ้น</th>
                    <th className="py-3 px-3 text-center">เครื่องมือ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {paginatedOrders.map((order) => {
                    const isCancelled = order.status === 'CANCELLED' || order.status === 'VOIDED';
                    const itemCount = order.items?.reduce((s: number, i: any) => s + (i.quantity || 1), 0) || order.items?.length || 0;

                    return (
                      <tr 
                        key={order.id || order.orderNumber} 
                        className={`hover:bg-slate-50/80 transition-colors ${isCancelled ? 'bg-rose-50/40 text-slate-400' : ''}`}
                      >
                        {/* Receipt # */}
                        <td className="py-3.5 px-3 font-bold text-sky-700">
                          #{order.orderNumber || order.id}
                          {isCancelled && (
                            <span className="ml-2 text-[10px] text-rose-600 bg-rose-100 border border-rose-200 px-1.5 py-0.5 rounded font-bold">
                              ยกเลิกแล้ว
                            </span>
                          )}
                        </td>

                        {/* Customer */}
                        <td className="py-3.5 px-3 font-bold text-slate-800">
                          {order.customerName || 'ลูกค้าทั่วไป (Walk-in)'}
                        </td>

                        {/* Item Count */}
                        <td className="py-3.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setViewItemsOrder(order)}
                            className="font-extrabold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                            title="คลิกเพื่อดูายการสินค้า"
                          >
                            {itemCount} รายการ
                          </button>
                        </td>

                        {/* Date & Time */}
                        <td className="py-3.5 px-3 text-slate-600 font-semibold whitespace-nowrap">
                          {new Date(order.createdAt).toLocaleString('th-TH', { 
                            dateStyle: 'short', 
                            timeStyle: 'short' 
                          })}
                        </td>

                        {/* Payment Method */}
                        <td className="py-3.5 px-3">
                          {getPaymentBadge(order.paymentMethod, order.payments)}
                        </td>

                        {/* Total Amount */}
                        <td className={`py-3.5 px-3 text-right font-black text-base ${isCancelled ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                          {formatCurrency(order.totalAmount || 0)}
                        </td>

                        {/* Action Tools Dropdown */}
                        <td className="py-3.5 px-3 text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger className="h-8 bg-sky-500 hover:bg-sky-600 text-white font-bold border-none text-xs rounded-lg px-2.5 shadow-sm inline-flex items-center outline-none cursor-pointer">
                              เครื่องมือ <ChevronDown className="w-3.5 h-3.5 ml-1" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52 bg-white border-slate-200 font-semibold p-1 rounded-xl shadow-xl space-y-0.5">
                              {/* 1. View Items Breakdown */}
                              <DropdownMenuItem 
                                onClick={() => setViewItemsOrder(order)}
                                className="cursor-pointer py-2 px-3 text-slate-700 hover:bg-slate-100 rounded-lg flex items-center gap-2"
                              >
                                <Package className="w-4 h-4 text-emerald-600" />
                                <span>ดูรายการสินค้า</span>
                              </DropdownMenuItem>

                              {/* 2. View Receipt PDF */}
                              <DropdownMenuItem 
                                onClick={() => handleViewReceipt(order)}
                                className="cursor-pointer py-2 px-3 text-slate-700 hover:bg-slate-100 rounded-lg flex items-center gap-2"
                              >
                                <FileText className="w-4 h-4 text-sky-600" />
                                <span>ดูใบเสร็จ</span>
                              </DropdownMenuItem>

                              {/* 3. Repeat Order */}
                              {!isCancelled && (
                                <DropdownMenuItem 
                                  onClick={() => handleRepeatOrderClick(order)}
                                  className="cursor-pointer py-2 px-3 text-slate-700 hover:bg-amber-50 hover:text-amber-800 rounded-lg flex items-center gap-2"
                                >
                                  <RotateCcw className="w-4 h-4 text-amber-600" />
                                  <span>ออเดอร์ซ้ำอีกครั้ง</span>
                                </DropdownMenuItem>
                              )}

                              {/* 4. Edit Payment Method */}
                              {!isCancelled && (
                                <DropdownMenuItem 
                                  onClick={() => setEditPaymentOrder(order)}
                                  className="cursor-pointer py-2 px-3 text-slate-700 hover:bg-purple-50 hover:text-purple-800 rounded-lg flex items-center gap-2"
                                >
                                  <CreditCard className="w-4 h-4 text-purple-600" />
                                  <span>แก้ไขวิธีชำระเงิน</span>
                                </DropdownMenuItem>
                              )}

                              {/* 5. Edit Order & Re-checkout */}
                              {!isCancelled && (
                                <DropdownMenuItem 
                                  onClick={() => setEditItemsTargetOrder(order)}
                                  className="cursor-pointer py-2 px-3 text-slate-700 hover:bg-indigo-50 hover:text-indigo-800 rounded-lg flex items-center gap-2"
                                >
                                  <Edit3 className="w-4 h-4 text-indigo-600" />
                                  <span>แก้ไขรายการสินค้า</span>
                                </DropdownMenuItem>
                              )}

                              {/* 6. Void Order & Refund */}
                              {!isCancelled && (
                                <DropdownMenuItem 
                                  onClick={() => { setVoidTargetOrder(order); setVoidReason(''); }}
                                  className="cursor-pointer py-2 px-3 text-rose-600 hover:bg-rose-50 rounded-lg flex items-center gap-2 border-t border-slate-100"
                                >
                                  <Ban className="w-4 h-4 text-rose-600" />
                                  <span>ยกเลิกบิล (คืนเงิน)</span>
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Bottom Pagination Bar */}
          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold shrink-0">
            <div className="flex items-center gap-2 text-slate-600">
              <span>แสดง</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                className="h-8 bg-slate-100 border border-slate-300 rounded-lg px-2 outline-none font-bold cursor-pointer"
              >
                <option value={8}>8</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
              </select>
              <span>รายการ / หน้า (ทั้งหมด {filteredOrders.length} รายการ)</span>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
                className="h-8 px-2 text-xs border-slate-300"
              >
                หน้าแรก
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="h-8 px-2.5 text-xs border-slate-300"
              >
                ← ก่อนหน้า
              </Button>
              <span className="px-3 text-slate-700 font-extrabold">
                {currentPage} จาก {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className="h-8 px-2.5 text-xs border-slate-300"
              >
                ถัดไป →
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="h-8 px-2 text-xs border-slate-300"
              >
                สุดท้าย
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* PDF Receipt Preview Modal */}
      {selectedReceipt && (
        <ReceiptPdfModal
          open={isReceiptOpen}
          onOpenChange={setIsReceiptOpen}
          data={selectedReceipt}
        />
      )}

      {/* 1. View Items Breakdown Modal ("ดูรายการสินค้า") */}
      <Dialog open={!!viewItemsOrder} onOpenChange={(open) => !open && setViewItemsOrder(null)}>
        <DialogContent className="w-[90vw] max-w-2xl bg-white border-slate-200 text-slate-900 rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
              <Package className="w-6 h-6 text-sky-600" />
              <span>รายการสินค้าในบิล #{viewItemsOrder?.orderNumber || viewItemsOrder?.id}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-3 space-y-4">
            <div className="flex flex-wrap justify-between text-xs font-semibold bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>ลูกค้า: <span className="font-bold text-slate-900">{viewItemsOrder?.customerName || 'ลูกค้าทั่วไป'}</span></div>
              <div>วันที่: <span className="font-bold text-slate-900">{viewItemsOrder?.createdAt ? new Date(viewItemsOrder.createdAt).toLocaleString('th-TH') : ''}</span></div>
              <div>วิธีชำระ: {getPaymentBadge(viewItemsOrder?.paymentMethod, viewItemsOrder?.payments)}</div>
            </div>

            {/* Table */}
            <div className="max-h-[350px] overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-100 text-slate-600 font-bold sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">ชื่อสินค้า</th>
                    <th className="py-2.5 px-3 text-center">จำนวน</th>
                    <th className="py-2.5 px-3 text-right">ราคา/หน่วย</th>
                    <th className="py-2.5 px-3 text-right">รวม (฿)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {(viewItemsOrder?.items || []).map((item: any, idx: number) => {
                    const price = item.unitPrice || item.price || 0;
                    const total = item.lineTotal || (item.quantity * price);
                    return (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 text-slate-400 font-bold">{idx + 1}.</td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{item.name || item.productName}</div>
                          {item.itemNote && (
                            <div className="text-[10px] text-amber-700 italic">📝 {item.itemNote}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-extrabold text-slate-800">
                          {item.quantity} {item.unitName}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-slate-700">
                          {formatCurrency(price)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-black text-slate-900">
                          {formatCurrency(total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center bg-slate-900 text-white p-4 rounded-xl text-base font-extrabold">
              <span>ยอดรวมทั้งสิ้น</span>
              <span className="text-xl text-emerald-400">{formatCurrency(viewItemsOrder?.totalAmount || 0)}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 2. Repeat Order Confirmation Modal (Warning before clearing cart) */}
      <Dialog open={!!repeatConfirmOrder} onOpenChange={(open) => !open && setRepeatConfirmOrder(null)}>
        <DialogContent className="w-[90vw] max-w-md bg-white border-slate-200 text-slate-900 rounded-2xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-amber-600 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <span>ยืนยันล้างตะกร้าเพื่อดึงออเดอร์ซ้ำ</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-3 space-y-3">
            <p className="text-sm text-slate-700 leading-relaxed">
              ในตะกร้าสินค้าปัจจุบันมีรายการค้างอยู่ <strong className="text-rose-600">{cart.items.length} รายการ</strong> 
            </p>
            <p className="text-xs text-slate-600 bg-amber-50 p-3 border border-amber-200 rounded-xl">
              คุณต้องการ <strong>ล้างตะกร้าสินค้าเดิม</strong> แล้วดึงรายการสินค้าจากบิล <strong className="text-slate-900">#{repeatConfirmOrder?.orderNumber}</strong> มาแทนหรือไม่?
            </p>

            <div className="flex gap-3 pt-3">
              <Button
                variant="outline"
                className="flex-1 h-11 border-slate-300 text-slate-700 font-bold"
                onClick={() => setRepeatConfirmOrder(null)}
              >
                ยกเลิก
              </Button>
              <Button
                className="flex-1 h-11 bg-amber-500 hover:bg-amber-600 text-white font-bold text-base shadow-md"
                onClick={handleConfirmRepeatOrder}
              >
                ล้างตะกร้า & ดึงรายการ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 3. Edit Payment Method Modal (Standard PaymentModal without touching cart!) */}
      {editPaymentOrder && (
        <PaymentModal
          open={!!editPaymentOrder}
          onOpenChange={(open) => !open && setEditPaymentOrder(null)}
          orderToEditPayment={editPaymentOrder}
          onPaymentEditSuccess={() => {
            fetchOrders();
            setEditPaymentOrder(null);
          }}
        />
      )}

      {/* 4. Edit Order Confirmation Modal */}
      <Dialog open={!!editItemsTargetOrder} onOpenChange={(open) => !open && setEditItemsTargetOrder(null)}>
        <DialogContent className="w-[90vw] max-w-md bg-white border-slate-200 text-slate-900 rounded-2xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-indigo-700 flex items-center gap-2">
              <Edit3 className="w-6 h-6 text-indigo-600" />
              <span>ยืนยันแก้ไขรายการสินค้า</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-3 space-y-3">
            <p className="text-sm text-slate-700 leading-relaxed">
              คุณกำลังจะแก้ไขรายการในบิล <strong className="text-slate-900">#{editItemsTargetOrder?.orderNumber}</strong>
            </p>
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-900 font-medium space-y-1">
              <p>✏️ ระบบจะดึงรายการสินค้าจากบิลนี้ไปไว้ที่หน้าจอขายให้คุณปรับเพิ่ม/ลดได้ทันที</p>
              <p className="font-bold text-indigo-950">💳 เมื่อคุณกดชำระเงินใหม่ ระบบจะยกเลิกบิลเดิมและลงบันทึกชำระเงินใหม่แทนบิลเดิมให้อัตโนมัติ!</p>
            </div>

            <div className="flex gap-3 pt-3">
              <Button
                variant="outline"
                className="flex-1 h-11 border-slate-300 text-slate-700 font-bold"
                onClick={() => setEditItemsTargetOrder(null)}
              >
                ยกเลิก
              </Button>
              <Button
                className="flex-1 h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base shadow-md"
                onClick={handleConfirmEditItems}
              >
                ดึงรายการมาแก้ไข
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Void Order Confirmation Modal */}
      <Dialog open={!!voidTargetOrder} onOpenChange={(open) => !open && setVoidTargetOrder(null)}>
        <DialogContent className="w-[90vw] max-w-md bg-white border-slate-200 text-slate-900 rounded-2xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-rose-600 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-rose-600" />
              <span>ยืนยันยกเลิกบิลและคืนเงิน</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-3 space-y-3">
            <p className="text-sm text-slate-700 leading-relaxed">
              คุณกำลังจะยกเลิกบิล <strong className="text-slate-900">#{voidTargetOrder?.orderNumber}</strong> ยอดรวม <strong className="text-rose-600">{formatCurrency(voidTargetOrder?.totalAmount || 0)}</strong>
            </p>
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800 font-medium">
              ⚠️ การยกเลิกบิลจะทำการ <strong>หักลดยอดขายออกจากระบบกะปัจจุบัน</strong> ตามช่องทางการชำระเงินเดิมโดยอัตโนมัติ
            </div>

            <div className="space-y-1 pt-1">
              <label className="text-xs font-bold text-slate-700">เหตุผลการยกเลิกบิล:</label>
              <Input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="เช่น ลูกค้าขอคืนสินค้า, คีย์บิลผิด..."
                className="h-11 border-slate-300 rounded-xl font-medium focus:border-rose-500"
                autoFocus
              />
            </div>

            <div className="flex gap-3 pt-3">
              <Button
                variant="outline"
                className="flex-1 h-11 border-slate-300 text-slate-700 font-bold"
                onClick={() => setVoidTargetOrder(null)}
              >
                ยกเลิก
              </Button>
              <Button
                className="flex-1 h-11 bg-rose-600 hover:bg-rose-700 text-white font-bold text-base shadow-md"
                onClick={handleConfirmVoid}
              >
                ยืนยันคืนเงิน & ยกเลิกบิล
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
