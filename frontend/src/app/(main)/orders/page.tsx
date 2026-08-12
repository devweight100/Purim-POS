"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, DollarSign, ShoppingCart, Ban } from "lucide-react";
import { toast } from "sonner";

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
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

  const fetchOrders = async () => {
    setLoading(true);
    try {
      let url = "/orders";
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      const data = await apiFetch(url);
      setOrders(data);
      
      // Calculate summary
      const validOrders = data.filter((o: any) => o.status !== "VOIDED");
      const totalRev = validOrders.reduce((sum: number, o: any) => sum + (Number(o.totalAmount) || 0), 0);
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
    o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
    (o.customer && o.customer.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">รายการออเดอร์</h1>
          <p className="text-slate-500 mt-2">ประวัติการขายและการชำระเงินทั้งหมด</p>
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
            <div className="text-2xl font-bold text-slate-900">{summary.totalOrders} <span className="text-sm text-slate-500 font-normal">รายการ</span></div>
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
            <div className="text-2xl font-bold text-sky-600">{formatCurrency(summary.totalRevenue)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
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
                <TableHead className="text-slate-500">เลขออเดอร์</TableHead>
                <TableHead className="text-slate-500">วันที่ / เวลา</TableHead>
                <TableHead className="text-slate-500">ลูกค้า</TableHead>
                <TableHead className="text-slate-500 text-right">จำนวน</TableHead>
                <TableHead className="text-slate-500 text-right">ยอดรวม</TableHead>
                <TableHead className="text-slate-500 text-center">ช่องทางชำระ</TableHead>
                <TableHead className="text-slate-500 text-center">สถานะ</TableHead>
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
                    ไม่พบข้อมูล
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((order) => (
                  <TableRow key={order.id} className="border-slate-200 hover:bg-slate-50 cursor-pointer" onClick={() => handleRowClick(order.id)}>
                    <TableCell className="font-medium text-sky-600">{order.orderNumber}</TableCell>
                    <TableCell className="text-slate-700">{formatDate(order.createdAt)}</TableCell>
                    <TableCell className="text-slate-700">{order.customer || "-"}</TableCell>
                    <TableCell className="text-right text-slate-700">{(order.items?.length || 0)} ชิ้น</TableCell>
                    <TableCell className="text-right font-bold text-slate-900">{formatCurrency(order.totalAmount || order.total)}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex gap-1 justify-center flex-wrap">
                        {order.payments?.map((p: any, i: number) => (
                          <Badge key={i} variant="outline" className="bg-white text-xs border-slate-300 text-slate-700">
                            {p.method === 'CASH' ? 'เงินสด' : p.method === 'QR_PROMPTPAY' ? 'QR' : p.method}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {order.status === 'COMPLETED' ? (
                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">สำเร็จ</Badge>
                      ) : order.status === 'VOIDED' ? (
                        <Badge className="bg-red-50 text-red-600 border-red-200 line-through">ยกเลิก</Badge>
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
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex justify-between items-center mr-4">
              <span>รายละเอียดออเดอร์ {currentOrder?.orderNumber}</span>
              {currentOrder?.status === 'COMPLETED' ? (
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">สำเร็จ</Badge>
              ) : currentOrder?.status === 'VOIDED' ? (
                <Badge className="bg-red-50 text-red-600 border-red-200">ยกเลิกแล้ว</Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          
          {currentOrder && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <span className="text-slate-500 block mb-1">วันที่ขาย</span>
                  <span className="font-medium text-slate-900">{formatDate(currentOrder.createdAt)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">ลูกค้า</span>
                  <span className="font-medium text-slate-900">{currentOrder.customer || "ลูกค้าทั่วไป"}</span>
                </div>
                {currentOrder.status === 'VOIDED' && currentOrder.voidReason && (
                  <div className="col-span-2 mt-2 pt-2 border-t border-slate-200">
                    <span className="text-red-600 block mb-1">เหตุผลที่ยกเลิก:</span>
                    <span className="text-slate-700">{currentOrder.voidReason}</span>
                  </div>
                )}
              </div>

              <div>
                <h4 className="font-medium text-slate-700 mb-3">รายการสินค้า</h4>
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200">
                      <TableHead className="text-slate-500">สินค้า</TableHead>
                      <TableHead className="text-right text-slate-500">ราคา/ชิ้น</TableHead>
                      <TableHead className="text-right text-slate-500">จำนวน</TableHead>
                      <TableHead className="text-right text-slate-500">รวม</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentOrder.items?.map((item: any, idx: number) => (
                      <TableRow key={idx} className="border-slate-200">
                        <TableCell className="text-slate-700">{item.name || item.product?.name}</TableCell>
                        <TableCell className="text-right text-slate-700">{formatCurrency(item.price)}</TableCell>
                        <TableCell className="text-right text-slate-700">{item.quantity}</TableCell>
                        <TableCell className="text-right text-slate-700">{formatCurrency(item.price * item.quantity)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="text-right mt-4 pt-4 border-t border-slate-200">
                  <div className="flex justify-end mb-2">
                    <div className="w-48 flex justify-between text-slate-500">
                      <span>ส่วนลด:</span>
                      <span>{formatCurrency(currentOrder.discount || 0)}</span>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="w-48 flex justify-between font-bold text-lg text-sky-600">
                      <span>ยอดสุทธิ:</span>
                      <span>{formatCurrency(currentOrder.totalAmount || currentOrder.total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-slate-700 mb-3">การชำระเงิน</h4>
                <div className="flex gap-2">
                  {currentOrder.payments?.map((p: any, i: number) => (
                    <div key={i} className="bg-slate-50 px-4 py-2 rounded-lg border border-slate-200 flex justify-between gap-6 items-center">
                      <span className="text-sm text-slate-700">{p.method === 'CASH' ? 'เงินสด' : p.method === 'QR_PROMPTPAY' ? 'พร้อมเพย์ QR' : p.method}</span>
                      <span className="font-medium text-slate-900">{formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between sm:justify-between items-center w-full">
            <div>
              {currentOrder?.status === 'COMPLETED' && (
                <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setIsVoidOpen(true)}>
                  <Ban className="w-4 h-4 mr-2" />
                  ยกเลิกบิล
                </Button>
              )}
            </div>
            <Button variant="ghost" onClick={() => setIsDetailOpen(false)} className="text-slate-500 hover:text-slate-900">ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Dialog */}
      <Dialog open={isVoidOpen} onOpenChange={setIsVoidOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Ban className="w-5 h-5" />
              ยืนยันการยกเลิกบิล
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm text-slate-500">
              การยกเลิกบิลจะทำให้สต็อกสินค้าถูกดึงกลับเข้าสู่ระบบ และออเดอร์นี้จะไม่ถูกนำไปคำนวณในยอดขายสุทธิ
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">เหตุผลที่ยกเลิก *</label>
              <Input 
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                placeholder="เช่น ลูกค้าขอคืนสินค้า, คีย์ผิด..."
                className="bg-white border-slate-300"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsVoidOpen(false)} className="text-slate-500 hover:text-slate-900">
              ย้อนกลับ
            </Button>
            <Button onClick={handleVoidOrder} className="bg-red-500 hover:bg-red-600 text-white">
              ยืนยันยกเลิกบิล
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
