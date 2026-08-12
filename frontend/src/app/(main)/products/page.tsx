"use client";

import { useEffect, useState } from "react";
import { api, apiFetch } from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Plus, PackagePlus, Barcode, Tags, Truck } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const emptyWholesaleSteps = Array.from({ length: 5 }, () => ({
  minQuantity: "",
  unitPrice: "",
}));

const initialProductForm = {
  name: "",
  size: "",
  color: "",
  supplierId: "",
  barcode: "",
  cost: "",
  priceLevel1: "",
  priceLevel2: "",
  priceLevel3: "",
  priceLevel4: "",
  wholesaleSteps: emptyWholesaleSteps,
};

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [productForm, setProductForm] = useState(initialProductForm);

  useEffect(() => {
    Promise.all([
      api.getProducts(),
      api.getCategories(),
      apiFetch("/suppliers").catch(() => []),
    ]).then(([prods, cats, supps]) => {
      setProducts(prods);
      setCategories(cats);
      setSuppliers(supps || []);
      setLoading(false);
    });
  }, []);

  const getCategoryName = (id: string) => categories.find(c => c.id === id)?.name || "-";

  const filtered = products.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const updateForm = (key: keyof typeof initialProductForm, value: any) => {
    setProductForm(prev => ({ ...prev, [key]: value }));
  };

  const updateWholesaleStep = (index: number, key: "minQuantity" | "unitPrice", value: string) => {
    setProductForm(prev => ({
      ...prev,
      wholesaleSteps: prev.wholesaleSteps.map((step, i) =>
        i === index ? { ...step, [key]: value } : step
      ),
    }));
  };

  const handleOpenAdd = () => {
    setProductForm({
      ...initialProductForm,
      wholesaleSteps: emptyWholesaleSteps.map(step => ({ ...step })),
    });
    setIsAddOpen(true);
  };

  const handleMockSave = () => {
    if (!productForm.name.trim()) {
      toast.error("กรุณาระบุชื่อสินค้า");
      return;
    }

    toast.success("เตรียมข้อมูลสินค้าไว้แล้ว (ยังไม่บันทึก backend)");
    setIsAddOpen(false);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">สินค้า</h1>
          <p className="text-slate-500 mt-2">จัดการรายการสินค้า ราคา และสต็อก</p>
        </div>
        <Button className="h-11 w-full bg-primary px-6 font-bold text-white hover:bg-primary/90 sm:w-auto" onClick={handleOpenAdd}>
          <Plus className="w-5 h-5 mr-2" />
          เพิ่มสินค้าใหม่
        </Button>
      </div>

      <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
        <div className="flex border-b border-slate-200 bg-slate-50 p-4">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="ค้นหาชื่อสินค้า, SKU..." 
              className="pl-9 bg-white border-slate-300 h-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow className="border-slate-200 hover:bg-transparent">
              <TableHead className="text-slate-500 text-center">บาร์โค้ด</TableHead>
              <TableHead className="text-slate-500">รหัสสินค้า</TableHead>
              <TableHead className="text-slate-500">ชื่อสินค้า</TableHead>
              <TableHead className="text-slate-500">หมวดหมู่</TableHead>
              <TableHead className="text-slate-500 text-right">จำนวน</TableHead>
              <TableHead className="text-slate-500 text-center">หน่วย</TableHead>
              <TableHead className="text-slate-500 text-right">ราคาต้นทุน</TableHead>
              <TableHead className="text-slate-500 text-right">ราคา 1</TableHead>
              <TableHead className="text-slate-500 text-right">ราคา 2</TableHead>
              <TableHead className="text-slate-500 text-right">ราคา 3</TableHead>
              <TableHead className="text-slate-500 text-right">ราคา 4</TableHead>
              <TableHead className="text-slate-500 text-right">ราคา 5</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center h-32 text-slate-500">กำลังโหลด...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center h-32 text-slate-400">ไม่พบสินค้า</TableCell>
              </TableRow>
            ) : filtered.map(p => (
              <TableRow key={p.id} className="border-slate-100 hover:bg-slate-50 cursor-pointer">
                <TableCell className="text-center">
                  <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
                    {p.barcodes?.[0]?.barcode || '-'}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs font-semibold text-slate-600">{p.sku}</TableCell>
                <TableCell className="font-semibold text-slate-900 min-w-[180px]">{p.name}</TableCell>
                <TableCell className="text-slate-500 text-sm">
                  <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 font-normal">
                    {getCategoryName(p.categoryId)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Badge
                    variant="outline"
                    className={(
                      (p.stock ?? 0) <= 10
                        ? 'bg-rose-50 text-rose-600 border-rose-200'
                        : (p.stock ?? 0) <= 20
                        ? 'bg-amber-50 text-amber-600 border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    )}
                  >
                    {p.stock ?? 0}
                  </Badge>
                </TableCell>
                <TableCell className="text-center text-slate-500 text-sm">{p.unit || '-'}</TableCell>
                <TableCell className="text-right text-slate-600 text-sm">{p.basePrice != null ? formatCurrency(p.basePrice) : '-'}</TableCell>
                <TableCell className="text-right font-semibold text-emerald-600">{p.priceLevel1 != null ? formatCurrency(p.priceLevel1) : p.basePrice != null ? formatCurrency(p.basePrice) : '-'}</TableCell>
                <TableCell className="text-right text-slate-600">{p.priceLevel2 != null ? formatCurrency(p.priceLevel2) : '-'}</TableCell>
                <TableCell className="text-right text-slate-600">{p.priceLevel3 != null ? formatCurrency(p.priceLevel3) : '-'}</TableCell>
                <TableCell className="text-right text-slate-600">{p.priceLevel4 != null ? formatCurrency(p.priceLevel4) : '-'}</TableCell>
                <TableCell className="text-right text-slate-600">{p.priceLevel5 != null ? formatCurrency(p.priceLevel5) : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-h-[92dvh] overflow-hidden bg-white p-0 text-slate-900 sm:max-w-5xl">
          <DialogHeader className="border-b border-slate-200 px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <PackagePlus className="h-5 w-5 text-primary" />
              เพิ่มสินค้าใหม่
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-5 py-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-5">
                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <Tags className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-slate-900">รายละเอียดสินค้า</h3>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <label className="text-sm font-medium text-slate-700">ชื่อสินค้า *</label>
                      <Input
                        value={productForm.name}
                        onChange={(e) => updateForm("name", e.target.value)}
                        placeholder="เช่น น้ำดื่มสิงห์ 600ml"
                        className="h-10 border-slate-300 bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">ขนาด</label>
                      <Input
                        value={productForm.size}
                        onChange={(e) => updateForm("size", e.target.value)}
                        placeholder="เช่น 600ml, M, 30x40"
                        className="h-10 border-slate-300 bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">สี</label>
                      <Input
                        value={productForm.color}
                        onChange={(e) => updateForm("color", e.target.value)}
                        placeholder="เช่น ขาว, ดำ, น้ำเงิน"
                        className="h-10 border-slate-300 bg-white"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <label className="text-sm font-medium text-slate-700">ผู้จำหน่าย</label>
                      <select
                        value={productForm.supplierId}
                        onChange={(e) => updateForm("supplierId", e.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary"
                      >
                        <option value="">เลือกผู้จำหน่าย</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <Barcode className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-slate-900">บาร์โค้ดและต้นทุน</h3>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">บาร์โค้ด</label>
                      <Input
                        value={productForm.barcode}
                        onChange={(e) => updateForm("barcode", e.target.value)}
                        placeholder="ยิงบาร์โค้ดหรือกรอกเลข"
                        className="h-10 border-slate-300 bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">ต้นทุน</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={productForm.cost}
                        onChange={(e) => updateForm("cost", e.target.value)}
                        placeholder="0.00"
                        className="h-10 border-slate-300 bg-white text-right"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <Tags className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-slate-900">ราคาขายระดับ 1-4</h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {[1, 2, 3, 4].map((level) => {
                      const key = `priceLevel${level}` as keyof typeof initialProductForm;
                      return (
                        <div key={level} className="space-y-2">
                          <label className="text-sm font-medium text-slate-700">ระดับราคา {level}</label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={productForm[key] as string}
                            onChange={(e) => updateForm(key, e.target.value)}
                            placeholder="0.00"
                            className="h-10 border-slate-300 bg-white text-right"
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>

              <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Truck className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-slate-900">ราคาส่ง 5 Step</h3>
                </div>
                <div className="space-y-3">
                  {productForm.wholesaleSteps.map((step, index) => (
                    <div key={index} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-xs font-semibold text-slate-500">Step {index + 1}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs text-slate-500">จำนวนถึง</label>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={step.minQuantity}
                            onChange={(e) => updateWholesaleStep(index, "minQuantity", e.target.value)}
                            placeholder="เช่น 6"
                            className="h-9 border-slate-300 bg-white text-right"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-slate-500">ราคาต่อชิ้น</label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={step.unitPrice}
                            onChange={(e) => updateWholesaleStep(index, "unitPrice", e.target.value)}
                            placeholder="เช่น 10"
                            className="h-9 border-slate-300 bg-white text-right"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  ตัวอย่าง: จำนวนถึง 6 ราคาต่อชิ้น 10 บาท, จำนวนถึง 12 ราคาต่อชิ้น 9 บาท
                </p>
              </section>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-slate-50">
            <Button variant="outline" className="border-slate-300" onClick={() => setIsAddOpen(false)}>
              ยกเลิก
            </Button>
            <Button className="bg-primary text-white hover:bg-primary/90" onClick={handleMockSave}>
              บันทึกสินค้า (Front-end)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
