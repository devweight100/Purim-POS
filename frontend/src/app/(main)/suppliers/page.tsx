"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentSupplier, setCurrentSupplier] = useState<any>({
    name: "",
    contactName: "",
    phone: "",
    email: "",
    address: "",
    creditTerms: 0,
  });

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/suppliers");
      setSuppliers(data);
    } catch (error) {
      toast.error("ดึงข้อมูลผู้จำหน่ายไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const handleOpenDialog = (supplier: any = null) => {
    if (supplier) {
      setCurrentSupplier(supplier);
      setIsEditMode(true);
    } else {
      setCurrentSupplier({
        name: "",
        contactName: "",
        phone: "",
        email: "",
        address: "",
        creditTerms: 0,
      });
      setIsEditMode(false);
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!currentSupplier.name) {
      toast.error("กรุณาระบุชื่อบริษัท");
      return;
    }
    try {
      if (isEditMode) {
        await apiFetch(`/suppliers/${currentSupplier.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...currentSupplier,
            creditTerms: Number(currentSupplier.creditTerms)
          }),
        });
        toast.success("อัปเดตผู้จำหน่ายสำเร็จ");
      } else {
        await apiFetch("/suppliers", {
          method: "POST",
          body: JSON.stringify({
            ...currentSupplier,
            creditTerms: Number(currentSupplier.creditTerms)
          }),
        });
        toast.success("เพิ่มผู้จำหน่ายสำเร็จ");
      }
      setIsDialogOpen(false);
      fetchSuppliers();
    } catch (error) {
      toast.error("บันทึกข้อมูลไม่สำเร็จ");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการลบผู้จำหน่ายนี้?")) return;
    try {
      await apiFetch(`/suppliers/${id}`, { method: "DELETE" });
      toast.success("ลบผู้จำหน่ายสำเร็จ");
      fetchSuppliers();
    } catch (error) {
      toast.error("ลบข้อมูลไม่สำเร็จ");
    }
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.contactName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">จัดการผู้จำหน่าย</h1>
          <p className="text-slate-500 mt-2">รายชื่อผู้จำหน่ายสินค้าและซัพพลายเออร์</p>
        </div>
        <Button 
          className="w-full bg-primary text-white font-medium hover:bg-primary/90 sm:w-auto"
          onClick={() => handleOpenDialog()}
        >
          <Plus className="w-4 h-4 mr-2" />
          เพิ่มผู้จำหน่าย
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="ค้นหาชื่อบริษัท, ผู้ติดต่อ..." 
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
                <TableHead className="text-slate-500">ชื่อบริษัท</TableHead>
                <TableHead className="text-slate-500">ผู้ติดต่อ</TableHead>
                <TableHead className="text-slate-500">เบอร์โทร</TableHead>
                <TableHead className="text-slate-500">อีเมล</TableHead>
                <TableHead className="text-slate-500 text-right">เครดิต (วัน)</TableHead>
                <TableHead className="text-slate-500 text-center">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-32 text-slate-500">
                    กำลังโหลดข้อมูล...
                  </TableCell>
                </TableRow>
              ) : filteredSuppliers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-32 text-slate-500">
                    ไม่พบข้อมูล
                  </TableCell>
                </TableRow>
              ) : (
                filteredSuppliers.map((supplier) => (
                  <TableRow key={supplier.id} className="border-slate-200 hover:bg-slate-50">
                    <TableCell className="font-medium text-slate-900">{supplier.name}</TableCell>
                    <TableCell className="text-slate-700">{supplier.contactName || "-"}</TableCell>
                    <TableCell className="text-slate-700">{supplier.phone || "-"}</TableCell>
                    <TableCell className="text-slate-700">{supplier.email || "-"}</TableCell>
                    <TableCell className="text-right text-slate-700">{supplier.creditTerms || 0}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex gap-2 justify-center">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-sky-600 hover:bg-slate-100" onClick={() => handleOpenDialog(supplier)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-slate-100" onClick={() => handleDelete(supplier.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-slate-900">{isEditMode ? "แก้ไขผู้จำหน่าย" : "เพิ่มผู้จำหน่าย"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-500">ชื่อบริษัท *</label>
              <Input 
                value={currentSupplier.name}
                onChange={e => setCurrentSupplier({...currentSupplier, name: e.target.value})}
                className="bg-white border-slate-300 text-slate-900"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-500">ผู้ติดต่อ</label>
              <Input 
                value={currentSupplier.contactName}
                onChange={e => setCurrentSupplier({...currentSupplier, contactName: e.target.value})}
                className="bg-white border-slate-300 text-slate-900"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-500">เบอร์โทร</label>
                <Input 
                  value={currentSupplier.phone}
                  onChange={e => setCurrentSupplier({...currentSupplier, phone: e.target.value})}
                  className="bg-white border-slate-300 text-slate-900"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-500">อีเมล</label>
                <Input 
                  value={currentSupplier.email}
                  onChange={e => setCurrentSupplier({...currentSupplier, email: e.target.value})}
                  className="bg-white border-slate-300 text-slate-900"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-500">ที่อยู่</label>
              <Input 
                value={currentSupplier.address}
                onChange={e => setCurrentSupplier({...currentSupplier, address: e.target.value})}
                className="bg-white border-slate-300 text-slate-900"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-500">เครดิต (วัน)</label>
              <Input 
                type="number"
                value={currentSupplier.creditTerms}
                onChange={e => setCurrentSupplier({...currentSupplier, creditTerms: e.target.value})}
                className="bg-white border-slate-300 text-slate-900"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="border-slate-300 text-slate-700 hover:bg-slate-50">
              ยกเลิก
            </Button>
            <Button onClick={handleSave} className="bg-sky-500 hover:bg-sky-600 text-white">
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
