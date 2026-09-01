"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, Edit, Trash2, Building2 } from "lucide-react";
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
      if (Array.isArray(data)) {
        setSuppliers(data);
      } else {
        setSuppliers([]);
      }
    } catch (err: any) {
      console.error("Failed to fetch suppliers:", err);
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const handleOpenAdd = () => {
    setIsEditMode(false);
    setCurrentSupplier({
      name: "",
      contactName: "",
      phone: "",
      email: "",
      address: "",
      creditTerms: 0,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (supp: any) => {
    setIsEditMode(true);
    setCurrentSupplier({ ...supp });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!currentSupplier.name.trim()) {
      toast.error("กรุณากรอกชื่อบริษัทผู้จำหน่าย");
      return;
    }

    try {
      if (isEditMode) {
        await apiFetch(`/suppliers/${currentSupplier.id}`, {
          method: "PATCH",
          body: JSON.stringify(currentSupplier),
        });
        toast.success("อัปเดตข้อมูลผู้จำหน่ายสำเร็จ");
      } else {
        await apiFetch("/suppliers", {
          method: "POST",
          body: JSON.stringify(currentSupplier),
        });
        toast.success("เพิ่มผู้จำหน่ายสำเร็จ");
      }
      setIsDialogOpen(false);
      fetchSuppliers();
    } catch (err: any) {
      toast.error("เกิดข้อผิดพลาด: " + (err.message || "ไม่สามารถบันทึกได้"));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`คุณต้องการลบผู้จำหน่าย "${name}" ใช่หรือไม่?`)) return;
    try {
      await apiFetch(`/suppliers/${id}`, { method: "DELETE" });
      toast.success("ลบผู้จำหน่ายสำเร็จ");
      fetchSuppliers();
    } catch (err: any) {
      toast.error("เกิดข้อผิดพลาดในการลบ: " + err.message);
    }
  };

  const filtered = suppliers.filter((s) => {
    const term = search.toLowerCase();
    return (
      (s.name || "").toLowerCase().includes(term) ||
      (s.contactName || "").toLowerCase().includes(term) ||
      (s.phone || "").toLowerCase().includes(term)
    );
  });

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <Building2 className="w-6 h-6 text-indigo-600" /> ข้อมูลบริษัทผู้จำหน่าย (Suppliers)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">จัดการรายชื่อคู่ค้า ซัพพลายเออร์ เครดิตเทอม และช่องทางติดต่อ</p>
        </div>
        <Button className="h-11 bg-primary px-6 font-bold text-white hover:bg-primary/90" onClick={handleOpenAdd}>
          <Plus className="w-5 h-5 mr-2" /> เพิ่มผู้จำหน่ายใหม่
        </Button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาชื่อผู้จำหน่าย, ผู้ติดต่อ, เบอร์โทร..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>
          <span className="text-xs text-slate-500">พบทั้งหมด {filtered.length} รายการ</span>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="py-3.5 px-6 font-semibold">ชื่อบริษัท / ผู้จำหน่าย</TableHead>
                <TableHead className="py-3.5 px-4 font-semibold">ชื่อผู้ติดต่อ</TableHead>
                <TableHead className="py-3.5 px-4 font-semibold">เบอร์โทรศัพท์</TableHead>
                <TableHead className="py-3.5 px-4 font-semibold">อีเมล</TableHead>
                <TableHead className="py-3.5 px-4 font-semibold text-center">เครดิตเทอม (วัน)</TableHead>
                <TableHead className="py-3.5 px-6 text-right font-semibold">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    กำลังโหลดข้อมูลผู้จำหน่าย...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    ไม่พบข้อมูลผู้จำหน่ายในฐานข้อมูล
                  </td>
                </tr>
              ) : (
                filtered.map((supp) => (
                  <TableRow key={supp.id} className="hover:bg-slate-50/70">
                    <td className="py-4 px-6 font-medium text-slate-900">{supp.name}</td>
                    <td className="py-4 px-4 text-slate-600">{supp.contactName || "-"}</td>
                    <td className="py-4 px-4 text-slate-600">{supp.phone || "-"}</td>
                    <td className="py-4 px-4 text-slate-600">{supp.email || "-"}</td>
                    <td className="py-4 px-4 text-center text-slate-600">
                      {supp.creditTerms ? `${supp.creditTerms} วัน` : "-"}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(supp)}>
                          <Edit className="w-4 h-4 text-slate-600" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(supp.id, supp.name)}>
                          <Trash2 className="w-4 h-4 text-rose-500" />
                        </Button>
                      </div>
                    </td>
                  </TableRow>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>{isEditMode ? "แก้ไขข้อมูลผู้จำหน่าย" : "เพิ่มผู้จำหน่ายใหม่"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                ชื่อบริษัท / ผู้จำหน่าย <span className="text-rose-500">*</span>
              </label>
              <Input
                value={currentSupplier.name}
                onChange={(e) => setCurrentSupplier({ ...currentSupplier, name: e.target.value })}
                placeholder="เช่น บริษัท ปุริม ซัพพลาย จำกัด"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">ชื่อผู้ติดต่อ</label>
                <Input
                  value={currentSupplier.contactName}
                  onChange={(e) => setCurrentSupplier({ ...currentSupplier, contactName: e.target.value })}
                  placeholder="เช่น คุณสมชาย"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">เบอร์โทรศัพท์</label>
                <Input
                  value={currentSupplier.phone}
                  onChange={(e) => setCurrentSupplier({ ...currentSupplier, phone: e.target.value })}
                  placeholder="เช่น 081-234-5678"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">อีเมล</label>
                <Input
                  value={currentSupplier.email}
                  onChange={(e) => setCurrentSupplier({ ...currentSupplier, email: e.target.value })}
                  placeholder="เช่น contact@supplier.com"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">เครดิตเทอม (วัน)</label>
                <Input
                  type="number"
                  value={currentSupplier.creditTerms}
                  onChange={(e) => setCurrentSupplier({ ...currentSupplier, creditTerms: Number(e.target.value) })}
                  placeholder="30"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">ที่อยู่</label>
              <textarea
                value={currentSupplier.address}
                onChange={(e) => setCurrentSupplier({ ...currentSupplier, address: e.target.value })}
                placeholder="ที่อยู่สำหรับจัดส่งหรือออกใบกำกับภาษี..."
                className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSave}>บันทึกข้อมูล</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
