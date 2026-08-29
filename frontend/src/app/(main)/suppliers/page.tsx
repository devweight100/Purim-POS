"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, Edit, Trash2, Building2 } from "lucide-react";
import { toast } from "sonner";

function loadSuppliersFromStorage(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('custom_suppliers');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  
  const initial = [
    { id: "supp_1", name: "บริษัท ปุริม ซัพพลาย จำกัด", contactName: "คุณสมชาย", phone: "081-234-5678", email: "contact@purimsupply.com", address: "123 ถ.สุขุมวิท กรุงเทพฯ", creditTerms: 30 },
    { id: "supp_2", name: "บจก. สยามเทรดดิ้ง แอนด์ ดีสทริบิวชั่น", contactName: "คุณวิภา", phone: "089-876-5432", email: "sales@siamtrading.co.th", address: "456 ถ.รัชดาภิเษก กรุงเทพฯ", creditTerms: 15 },
    { id: "supp_3", name: "หจก. รวมสินค้าค้าส่ง", contactName: "คุณกิตติ", phone: "02-999-8888", email: "wholesale@ruamkhong.com", address: "789 ถ.พหลโยธิน กรุงเทพฯ", creditTerms: 45 },
  ];
  try { localStorage.setItem('custom_suppliers', JSON.stringify(initial)); } catch {}
  return initial;
}

function saveSuppliersToStorage(suppliers: any[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('custom_suppliers', JSON.stringify(suppliers));
  } catch {}
}

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
    let list: any[] = [];
    try {
      const data = await apiFetch("/suppliers");
      if (Array.isArray(data) && data.length > 0) {
        list = data;
      }
    } catch {}

    if (list.length === 0) {
      list = loadSuppliersFromStorage();
    } else {
      saveSuppliersToStorage(list);
    }

    setSuppliers(list);
    setLoading(false);
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
    if (!currentSupplier.name.trim()) {
      toast.error("กรุณาระบุชื่อบริษัท");
      return;
    }
    
    const existing = loadSuppliersFromStorage();
    let updatedList: any[] = [];

    if (isEditMode) {
      updatedList = existing.map(s => s.id === currentSupplier.id ? { ...s, ...currentSupplier, creditTerms: Number(currentSupplier.creditTerms) || 0 } : s);
      try {
        await apiFetch(`/suppliers/${currentSupplier.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...currentSupplier,
            creditTerms: Number(currentSupplier.creditTerms) || 0
          }),
        });
      } catch {}
      toast.success("อัปเดตผู้จำหน่ายสำเร็จ");
    } else {
      const newSupplier = {
        ...currentSupplier,
        id: currentSupplier.id || "supp_" + Date.now(),
        creditTerms: Number(currentSupplier.creditTerms) || 0,
      };
      updatedList = [newSupplier, ...existing];
      try {
        await apiFetch("/suppliers", {
          method: "POST",
          body: JSON.stringify(newSupplier),
        });
      } catch {}
      toast.success("เพิ่มผู้จำหน่ายสำเร็จ");
    }

    saveSuppliersToStorage(updatedList);
    setSuppliers(updatedList);
    setIsDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการลบผู้จำหน่ายนี้?")) return;
    const existing = loadSuppliersFromStorage();
    const updatedList = existing.filter(s => s.id !== id);
    try {
      await apiFetch(`/suppliers/${id}`, { method: "DELETE" });
    } catch {}
    saveSuppliersToStorage(updatedList);
    setSuppliers(updatedList);
    toast.success("ลบผู้จำหน่ายสำเร็จ");
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.contactName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <Building2 className="w-6 h-6 text-sky-500" /> จัดการผู้จำหน่าย (Suppliers)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">รายชื่อบริษัทผู้จำหน่ายสินค้า ซัพพลายเออร์ และเงื่อนไขเครดิตเทอม</p>
        </div>
        <Button 
          className="bg-sky-500 hover:bg-sky-600 text-white font-bold h-10 px-5 text-xs shadow-sm rounded-xl"
          onClick={() => handleOpenDialog()}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          เพิ่มผู้จำหน่าย
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs w-full">
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
            <Button onClick={handleSave} className="bg-sky-500 hover:bg-sky-600 text-white font-bold">
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
