"use client";

import { useEffect, useState } from "react";
import { apiFetch, api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, DollarSign, ShoppingCart, Ban, CreditCard, User } from "lucide-react";
import { useShiftStore } from "@/lib/store/shift-store";
import { toast } from "sonner";

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [productsMap, setProductsMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Summary stats
  const [summary, setSummary] = useState({ totalOrders: 0, totalRevenue: 0 });

  // Detail Dialog
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<any>(null);
  
  // Void Dialog
  const [isVoidOpen, setIsVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  // Load product catalog for reliable name & unit lookups
  useEffect(() => {
    const loadCatalog = async () => {
      let prods: any[] = [];
      try {
        prods = await apiFetch('/products');
      } catch {
        prods = await api.getProducts();
      }

      if (typeof window !== 'undefined') {
        try {
          const savedCustom = localStorage.getItem('custom_products');
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
        // Backend offline or error -> fallback gracefully
      }

      // Get orders completed in local shift store
      const localOrders = useShiftStore.getState().completedOrders || [];

      // Merge and deduplicate by orderNumber or id
      const combinedMap = new Map<string, any>();
      
      localOrders.forEach((o) => {
        if (o.orderNumber || o.id) combinedMap.set(o.orderNumber || o.id, o);
      });

      if (Array.isArray(fetchedBackend)) {
        fetchedBackend.forEach((o) => {
          if (o.orderNumber || o.id) combinedMap.set(o.orderNumber || o.id, o);
        });
      }

      // If map is empty, pull sample mock orders
      if (combinedMap.size === 0) {
        const mockOrders = await api.getOrders();
        mockOrders.forEach((o: any) => combinedMap.set(o.orderNumber || o.id, o));
      }

      const all = Array.from(combinedMap.values()).sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setOrders(all);
      
      // Summary calculation
      const validOrders = all.filter((o: any) => o.status !== "VOIDED");
      const totalRev = validOrders.reduce((sum: number, o: any) => sum + (Number(o.totalAmount || o.total) || 0), 0);
      setSummary({ totalOrders: validOrders.length, totalRevenue: totalRev });
    } catch (error) {
      toast.error("ดึงข้อมูลออเดอร์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [startDate, endDate]);

  const handleRowClick = async (id: string) => {
    const found = orders.find((o) => o.id === id || o.orderNumber === id);
    if (found) {
      setCurrentOrder(found);
      setIsDetailOpen(true);
      return;
    }

    try {
      const data = await apiFetch(`/orders/${id}`);
      setCurrentOrder(data);
      setIsDetailOpen(true);
    } catch (error) {
      toast.error("ดึงข้อมูลรายละเอียดออเดอร์ไม่สำเร็จ");
    }
  };

  const handleVoidOrder = async () => {
    if (!voidReason) {
      toast.error("กรุณาระบุเหตุผลที่ยกเลิก");
      return;
    }
    try {
      await apiFetch(`/orders/${currentOrder.id}/void`, {
        method: "POST",
        body: JSON.stringify({ reason: voidReason })
      });
      toast.success("ยกเลิกออเดอร์สำเร็จ");
      setIsVoidOpen(false);
      setIsDetailOpen(false);
      setVoidReason("");
      fetchOrders();
    } catch (error) {
      toast.error("ยกเลิกออเดอร์ไม่สำเร็จ");
    }
  };

  const filteredOrders = orders.filter(o => 
    (o.orderNumber && o.orderNumber.toLowerCase().includes(search.toLowerCase())) ||
    (o.customerName && o.customerName.toLowerCase().includes(search.toLowerCase())) ||
    (o.customer && o.customer.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">รายการออเดอร์ (ประวัติการขาย)</h1>
          <p className="text-slate-500 mt-2">ตรวจสอบประวัติการขาย รายการสินค้า ราคารวม และช่องทางการชำระเงิน</p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] md:w-auto">
          <div className="space-y-1">
            <label className="text-xs text-slate-500">ตั้งแต่</label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-white border-slate-300 h-9" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500">ถึง</label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-white border-slate-300 h-9" />
          </div>
          <div className="space-y-1 self-end">
            <Button variant="outline" className="h-9 border-slate-300 text-slate-700 hover:bg-slate-50" onClick={() => {setStartDate(""); setEndDate("");}}>
              รีเซ็ต
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">ออเดอร์ทั้งหมด (ไม่รวมยกเลิก)</CardTitle>
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-slate-900">{summary.totalOrders} <span className="text-sm text-slate-500 font-normal">รายการ</span></div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">ยอดขายรวมสุทธิ</CardTitle>
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-sky-600">{formatCurrency(summary.totalRevenue)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="ค้นหาเลขออเดอร์, ชื่อลูกค้า..." 
              className="pl-9 bg-white border-slate-300 h-10 text-slate-900"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="text-slate-600 font-bold">เลขออเดอร์</TableHead>
                <TableHead className="text-slate-600 font-bold">วันที่ / เวลา</TableHead>
                <TableHead className="text-slate-600 font-bold">ลูกค้า</TableHead>
                <TableHead className="text-slate-600 font-bold text-right">จำนวนรายการ</TableHead>
                <TableHead className="text-slate-600 font-bold text-right">ยอดรวมสุทธิ</TableHead>
                <TableHead className="text-slate-600 font-bold text-center">ช่องทางชำระ</TableHead>
                <TableHead className="text-slate-600 font-bold text-center">สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-32 text-slate-500">
                    กำลังโหลดข้อมูล...
                  </TableCell>
                </TableRow>
              ) : filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-32 text-slate-500">
                    ไม่พบข้อมูลออเดอร์
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((order) => (
                  <TableRow 
                    key={order.id || order.orderNumber} 
                    className="border-slate-200 hover:bg-sky-50/60 cursor-pointer transition-colors" 
                    onClick={() => handleRowClick(order.id || order.orderNumber)}
                  >
                    <TableCell className="font-bold text-sky-600">{order.orderNumber}</TableCell>
                    <TableCell className="text-slate-700">{formatDate(order.createdAt)}</TableCell>
                    <TableCell className="text-slate-700 font-semibold">{order.customerName || order.customer || "ลูกค้าทั่วไป"}</TableCell>
                    <TableCell className="text-right text-slate-700 font-bold">{(order.items?.length || order.itemCount || 0)} รายการ</TableCell>
                    <TableCell className="text-right font-extrabold text-slate-900 text-base">{formatCurrency(order.totalAmount || order.total || 0)}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex gap-1 justify-center flex-wrap">
                        {order.payments?.map((p: any, i: number) => (
                          <Badge key={i} variant="outline" className="bg-white text-xs border-slate-300 text-slate-800 font-semibold px-2 py-0.5">
                            {p.method === 'CASH' ? '💵 เงินสด' : p.method === 'QR_PROMPTPAY' ? '📱 QR โอนเงิน' : p.method === 'CREDIT_NOTE' ? '👤 เงินเชื่อ' : p.method}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {order.status === 'COMPLETED' ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold">สำเร็จ</Badge>
                      ) : order.status === 'VOIDED' ? (
                        <Badge className="bg-red-100 text-red-700 border-red-300 line-through">ยกเลิก</Badge>
                      ) : (
                        <Badge variant="outline">{order.status}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Order Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[90vw] max-w-3xl max-h-[90vh] overflow-y-auto p-6 sm:p-8 rounded-3xl shadow-2xl">
          <DialogHeader className="border-b border-slate-200 pb-4">
            <DialogTitle className="flex justify-between items-center mr-4">
              <span className="text-2xl font-bold text-slate-900">รายละเอียดออเดอร์ {currentOrder?.orderNumber}</span>
              {currentOrder?.status === 'COMPLETED' ? (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-sm px-3 py-1">สำเร็จ</Badge>
              ) : currentOrder?.status === 'VOIDED' ? (
                <Badge className="bg-red-100 text-red-700 border-red-300 text-sm px-3 py-1 font-bold">ยกเลิกแล้ว</Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          
          {currentOrder && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <div>
                  <span className="text-slate-500 text-xs font-semibold block mb-0.5">วันที่ / เวลาขาย</span>
                  <span className="font-bold text-slate-900 text-base">{formatDate(currentOrder.createdAt)}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-xs font-semibold block mb-0.5">ชื่อลูกค้า</span>
                  <span className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                    <User className="w-4 h-4 text-sky-600" />
                    {currentOrder.customerName || currentOrder.customer || "ลูกค้าทั่วไป"}
                  </span>
                </div>
                {currentOrder.status === 'VOIDED' && currentOrder.voidReason && (
                  <div className="col-span-1 sm:col-span-2 mt-2 pt-2 border-t border-slate-200">
                    <span className="text-red-600 font-bold block mb-1">เหตุผลที่ยกเลิก:</span>
                    <span className="text-slate-700 bg-red-50 p-2.5 rounded-xl border border-red-200 block">{currentOrder.voidReason}</span>
                  </div>
                )}
              </div>

              <div>
                <h4 className="font-bold text-slate-900 text-base mb-3 flex items-center justify-between">
                  <span>รายการสินค้าที่ซื้อ ({currentOrder.items?.length || 0} รายการ)</span>
                </h4>
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <Table>
                    <TableHeader className="bg-slate-100">
                      <TableRow className="border-slate-200">
                        <TableHead className="text-slate-700 font-bold">ชื่อสินค้า</TableHead>
                        <TableHead className="text-right text-slate-700 font-bold">ราคา/หน่วย</TableHead>
                        <TableHead className="text-right text-slate-700 font-bold">จำนวน</TableHead>
                        <TableHead className="text-right text-slate-700 font-bold">รวมเป็นเงิน</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentOrder.items?.map((item: any, idx: number) => {
                        const matchedProduct = item.productId ? productsMap[item.productId] : (item.sku ? productsMap[item.sku] : null);
                        const itemName = item.name || item.productName || item.product?.name || item.title || matchedProduct?.name || (item.sku ? `สินค้า (${item.sku})` : "สินค้าทั่วไป");
                        const itemPrice = item.unitPrice ?? item.price ?? 0;
                        const qty = item.quantity ?? 1;
                        const unit = item.unitName || item.unit || matchedProduct?.units?.[0]?.unitName || "ชิ้น";
                        const lineTotal = item.lineTotal ?? item.total ?? (itemPrice * qty);

                        return (
                          <TableRow key={idx} className="border-slate-200">
                            <TableCell className="font-semibold text-slate-900">
                              {itemName}
                              {unit && (
                                <span className="ml-1.5 text-xs text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-200 font-normal">
                                  {unit}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-slate-700 font-medium">{formatCurrency(itemPrice)}</TableCell>
                            <TableCell className="text-right text-slate-900 font-bold">{qty} {unit}</TableCell>
                            <TableCell className="text-right text-slate-900 font-extrabold">{formatCurrency(lineTotal)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Summary calculation box */}
                <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                  {currentOrder.subtotal > 0 && (
                    <div className="flex justify-between text-slate-600 text-sm">
                      <span>ยอดรวมก่อนส่วนลด:</span>
                      <span className="font-semibold">{formatCurrency(currentOrder.subtotal)}</span>
                    </div>
                  )}

                  {(currentOrder.billDiscountAmount > 0 || currentOrder.discountAmount > 0 || currentOrder.discount > 0) && (
                    <div className="flex justify-between text-red-600 text-sm font-semibold">
                      <span>ส่วนลดท้ายบิล:</span>
                      <span>-{formatCurrency(currentOrder.billDiscountAmount || currentOrder.discountAmount || currentOrder.discount || 0)}</span>
                    </div>
                  )}

                  {currentOrder.vatAmount > 0 && (
                    <div className="flex justify-between text-slate-600 text-sm">
                      <span>ภาษีมูลค่าเพิ่ม (VAT 7%):</span>
                      <span className="font-semibold">{formatCurrency(currentOrder.vatAmount)}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-slate-900">
                    <span className="font-bold text-base">ยอดเงินรวมสุทธิ:</span>
                    <span className="font-extrabold text-3xl text-sky-600">{formatCurrency(currentOrder.totalAmount || currentOrder.total || 0)}</span>
                  </div>
                </div>
              </div>

              {/* Payment Methods Detail */}
              <div>
                <h4 className="font-bold text-slate-900 text-base mb-3 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-sky-500" /> การรับชำระเงิน
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {currentOrder.payments?.map((p: any, i: number) => (
                    <div key={i} className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-slate-900 block text-sm">
                          {p.method === 'CASH' ? '💵 เงินสด' : p.method === 'QR_PROMPTPAY' ? '📱 QR PromptPay / โอนเงิน' : p.method === 'CREDIT_NOTE' ? '👤 เงินเชื่อ' : p.method}
                        </span>
                        {p.referenceNo && (
                          <span className="text-xs text-sky-700 font-medium block mt-0.5">
                            บัญชี: {p.referenceNo}
                          </span>
                        )}
                      </div>
                      <span className="font-extrabold text-lg text-slate-900">{formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>

                {currentOrder.cashReceived > 0 && (
                  <div className="mt-3 flex gap-4 text-xs text-slate-600 bg-slate-100 p-3 rounded-xl">
                    <span>รับเงินสดมา: <b>{formatCurrency(currentOrder.cashReceived)}</b></span>
                    <span>เงินทอน: <b>{formatCurrency(currentOrder.changeAmount || 0)}</b></span>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between sm:justify-between items-center w-full pt-4 border-t border-slate-200">
            <div>
              {currentOrder?.status === 'COMPLETED' && (
                <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 font-bold" onClick={() => setIsVoidOpen(true)}>
                  <Ban className="w-4 h-4 mr-2" />
                  ยกเลิกบิลนี้
                </Button>
              )}
            </div>
            <Button variant="ghost" onClick={() => setIsDetailOpen(false)} className="text-slate-600 hover:text-slate-900 font-bold text-base">ปิดหน้าต่าง</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Dialog */}
      <Dialog open={isVoidOpen} onOpenChange={setIsVoidOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md rounded-2xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2 text-xl font-bold">
              <Ban className="w-6 h-6" />
              ยืนยันการยกเลิกบิล
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              การยกเลิกบิลจะคืนสต็อกสินค้าเข้าสู่ระบบอัตโนมัติ และออเดอร์นี้จะไม่ถูกนำไปคิดรวมในยอดขายสุทธิ
            </p>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">เหตุผลที่ยกเลิก *</label>
              <Input 
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                placeholder="เช่น ลูกค้าขอคืนสินค้า, พนักงานคีย์ผิด..."
                className="bg-white border-slate-300 h-11 text-slate-900"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsVoidOpen(false)} className="text-slate-500 hover:text-slate-900 font-semibold">
              ย้อนกลับ
            </Button>
            <Button onClick={handleVoidOrder} className="bg-red-500 hover:bg-red-600 text-white font-bold h-11 px-5 shadow-sm">
              ยืนยันยกเลิกบิล
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
