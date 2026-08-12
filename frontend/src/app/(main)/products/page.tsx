"use client";

import { useEffect, useState, useMemo } from "react";
import { api, apiFetch } from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, PackagePlus, Barcode, Tags, Truck, Pencil, ChevronUp, ChevronDown, ChevronsUpDown, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
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
  priceLevel5: "",
  wholesaleSteps: emptyWholesaleSteps,
};

type SortKey = "name" | "stock" | "basePrice" | "priceLevel1" | "priceLevel2" | "priceLevel3" | "priceLevel4" | "priceLevel5";
type SortDir = "asc" | "desc";

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<"all" | "out" | "low">("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 text-slate-400 inline" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 ml-1 text-sky-500 inline" />
      : <ChevronDown className="w-3 h-3 ml-1 text-sky-500 inline" />;
  };

  const filtered = useMemo(() => {
    let list = products.filter(p => {
      const matchSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase()) ||
        (p.barcodes?.[0]?.barcode || "").includes(search);
      const matchCat = categoryFilter === "all" || p.categoryId === categoryFilter;
      const stock = p.stock ?? 0;
      const matchStock =
        stockFilter === "all" ? true :
        stockFilter === "out" ? stock === 0 :
        stockFilter === "low" ? stock > 0 && stock <= 10 : true;
      return matchSearch && matchCat && matchStock;
    });

    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey] ?? 0;
        const bv = b[sortKey] ?? 0;
        if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
      });
    }
    return list;
  }, [products, search, categoryFilter, stockFilter, sortKey, sortDir]);

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
    setProductForm({ ...initialProductForm, wholesaleSteps: emptyWholesaleSteps.map(s => ({ ...s })) });
    setIsAddOpen(true);
  };

  const handleOpenEdit = (product: any) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name || "",
      size: product.size || "",
      color: product.color || "",
      supplierId: product.supplierId || "",
      barcode: product.barcodes?.[0]?.barcode || "",
      cost: product.basePrice?.toString() || "",
      priceLevel1: product.priceLevel1?.toString() || "",
      priceLevel2: product.priceLevel2?.toString() || "",
      priceLevel3: product.priceLevel3?.toString() || "",
      priceLevel4: product.priceLevel4?.toString() || "",
      priceLevel5: product.priceLevel5?.toString() || "",
      wholesaleSteps: emptyWholesaleSteps.map(s => ({ ...s })),
    });
    setIsEditOpen(true);
  };

  const handleMockSave = () => {
    if (!productForm.name.trim()) {
      toast.error("กรุณาระบุชื่อสินค้า");
      return;
    }
    toast.success("เตรียมข้อมูลสินค้าไว้แล้ว (ยังไม่บันทึก backend)");
    setIsAddOpen(false);
    setIsEditOpen(false);
  };

  const stockFilterOptions = [
    { key: "all", label: "ทั้งหมด" },
    { key: "low", label: "⚠️ ใกล้หมด (≤10)" },
    { key: "out", label: "🔴 หมดสต็อก" },
  ] as const;

  const ProductForm = () => (
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
              <Input value={productForm.name} onChange={e => updateForm("name", e.target.value)} placeholder="เช่น น้ำดื่มสิงห์ 600ml" className="h-10 border-slate-300 bg-white" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">ขนาด</label>
              <Input value={productForm.size} onChange={e => updateForm("size", e.target.value)} placeholder="เช่น 600ml, M, 30x40" className="h-10 border-slate-300 bg-white" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">สี</label>
              <Input value={productForm.color} onChange={e => updateForm("color", e.target.value)} placeholder="เช่น ขาว, ดำ, น้ำเงิน" className="h-10 border-slate-300 bg-white" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">ผู้จำหน่าย</label>
              <select value={productForm.supplierId} onChange={e => updateForm("supplierId", e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary">
                <option value="">เลือกผู้จำหน่าย</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
              <Input value={productForm.barcode} onChange={e => updateForm("barcode", e.target.value)} placeholder="ยิงบาร์โค้ดหรือกรอกเลข" className="h-10 border-slate-300 bg-white" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">ราคาต้นทุน</label>
              <Input type="number" min="0" step="0.01" value={productForm.cost} onChange={e => updateForm("cost", e.target.value)} placeholder="0.00" className="h-10 border-slate-300 bg-white text-right" />
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <Tags className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-slate-900">ราคาขายระดับ 1–5</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            {([1, 2, 3, 4, 5] as const).map(level => {
              const key = `priceLevel${level}` as keyof typeof initialProductForm;
              return (
                <div key={level} className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">ราคา {level}</label>
                  <Input type="number" min="0" step="0.01" value={productForm[key] as string} onChange={e => updateForm(key, e.target.value)} placeholder="0.00" className="h-10 border-slate-300 bg-white text-right" />
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
                  <Input type="number" min="0" step="1" value={step.minQuantity} onChange={e => updateWholesaleStep(index, "minQuantity", e.target.value)} placeholder="เช่น 6" className="h-9 border-slate-300 bg-white text-right" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500">ราคาต่อชิ้น</label>
                  <Input type="number" min="0" step="0.01" value={step.unitPrice} onChange={e => updateWholesaleStep(index, "unitPrice", e.target.value)} placeholder="เช่น 10" className="h-9 border-slate-300 bg-white text-right" />
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
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">สินค้า</h1>
          <p className="text-slate-500 mt-1">จัดการรายการสินค้า ราคา และสต็อก</p>
        </div>
        <Button className="h-11 w-full bg-primary px-6 font-bold text-white hover:bg-primary/90 sm:w-auto" onClick={handleOpenAdd}>
          <Plus className="w-5 h-5 mr-2" />
          เพิ่มสินค้าใหม่
        </Button>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
        {/* Search */}
        <div className="relative flex-1 xl:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="ค้นหาชื่อ, รหัส, บาร์โค้ด..."
            className="pl-9 bg-white border-slate-300 h-10"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 overflow-x-auto rounded-md border border-slate-200 bg-white p-1 no-scrollbar shrink-0">
          <Button
            variant={categoryFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="shrink-0 text-xs h-8 px-3"
            onClick={() => setCategoryFilter("all")}
          >
            ทุกหมวด
          </Button>
          {categories.map(cat => (
            <Button
              key={cat.id}
              variant={categoryFilter === cat.id ? "secondary" : "ghost"}
              size="sm"
              className="shrink-0 text-xs h-8 px-3 gap-1"
              onClick={() => setCategoryFilter(cat.id)}
            >
              {cat.icon && <span>{cat.icon}</span>}
              {cat.name}
            </Button>
          ))}
        </div>

        {/* Stock Status Filter */}
        <div className="flex gap-2 rounded-md border border-slate-200 bg-white p-1 shrink-0">
          {stockFilterOptions.map(opt => (
            <Button
              key={opt.key}
              variant={stockFilter === opt.key ? "secondary" : "ghost"}
              size="sm"
              className="shrink-0 text-xs h-8 px-3"
              onClick={() => setStockFilter(opt.key)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Stats Summary */}
      <div className="mb-4 flex gap-3 text-sm text-slate-500">
        <span>แสดง <b className="text-slate-800">{filtered.length}</b> รายการ</span>
        {categoryFilter !== "all" && <span>· หมวด: <b className="text-sky-600">{categories.find(c => c.id === categoryFilter)?.name}</b></span>}
        {stockFilter !== "all" && <span>· สถานะ: <b className="text-amber-600">{stockFilter === "out" ? "หมดสต็อก" : "ใกล้หมด"}</b></span>}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="text-slate-500 text-center whitespace-nowrap">บาร์โค้ด</TableHead>
                <TableHead className="text-slate-500 whitespace-nowrap">รหัสสินค้า</TableHead>
                <TableHead
                  className="text-slate-500 whitespace-nowrap cursor-pointer hover:text-sky-600 select-none"
                  onClick={() => handleSort("name")}
                >
                  ชื่อสินค้า <SortIcon col="name" />
                </TableHead>
                <TableHead className="text-slate-500 whitespace-nowrap">หมวดหมู่</TableHead>
                <TableHead
                  className="text-slate-500 text-right whitespace-nowrap cursor-pointer hover:text-sky-600 select-none"
                  onClick={() => handleSort("stock")}
                >
                  จำนวน <SortIcon col="stock" />
                </TableHead>
                <TableHead className="text-slate-500 text-center whitespace-nowrap">หน่วย</TableHead>
                <TableHead
                  className="text-slate-500 text-right whitespace-nowrap cursor-pointer hover:text-sky-600 select-none"
                  onClick={() => handleSort("basePrice")}
                >
                  ราคาต้นทุน <SortIcon col="basePrice" />
                </TableHead>
                {([1, 2, 3, 4, 5] as const).map(n => (
                  <TableHead
                    key={n}
                    className="text-slate-500 text-right whitespace-nowrap cursor-pointer hover:text-sky-600 select-none"
                    onClick={() => handleSort(`priceLevel${n}` as SortKey)}
                  >
                    ราคา {n} <SortIcon col={`priceLevel${n}` as SortKey} />
                  </TableHead>
                ))}
                <TableHead className="text-slate-500 text-center whitespace-nowrap">แก้ไข</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center h-32 text-slate-500">กำลังโหลด...</TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center h-32 text-slate-400">
                    ไม่พบสินค้าที่ตรงกับเงื่อนไข
                  </TableCell>
                </TableRow>
              ) : filtered.map(p => {
                const stock = p.stock ?? 0;
                const stockBadgeClass =
                  stock === 0 ? "bg-rose-50 text-rose-600 border-rose-200" :
                  stock <= 10 ? "bg-amber-50 text-amber-600 border-amber-200" :
                  "bg-emerald-50 text-emerald-700 border-emerald-200";
                return (
                  <TableRow key={p.id} className="border-slate-100 hover:bg-slate-50">
                    <TableCell className="text-center">
                      <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
                        {p.barcodes?.[0]?.barcode || "-"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold text-slate-600 whitespace-nowrap">{p.sku}</TableCell>
                    <TableCell className="font-semibold text-slate-900 min-w-[180px]">{p.name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 font-normal">
                        {getCategoryName(p.categoryId)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={stockBadgeClass}>{stock}</Badge>
                    </TableCell>
                    <TableCell className="text-center text-slate-500 text-sm">{p.unit || "-"}</TableCell>
                    <TableCell className="text-right text-slate-600 text-sm whitespace-nowrap">
                      {p.basePrice != null ? formatCurrency(p.basePrice) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-emerald-600 whitespace-nowrap">
                      {p.priceLevel1 != null ? formatCurrency(p.priceLevel1) : p.basePrice != null ? formatCurrency(p.basePrice) : "-"}
                    </TableCell>
                    <TableCell className="text-right text-slate-600 whitespace-nowrap">{p.priceLevel2 != null ? formatCurrency(p.priceLevel2) : "-"}</TableCell>
                    <TableCell className="text-right text-slate-600 whitespace-nowrap">{p.priceLevel3 != null ? formatCurrency(p.priceLevel3) : "-"}</TableCell>
                    <TableCell className="text-right text-slate-600 whitespace-nowrap">{p.priceLevel4 != null ? formatCurrency(p.priceLevel4) : "-"}</TableCell>
                    <TableCell className="text-right text-slate-600 whitespace-nowrap">{p.priceLevel5 != null ? formatCurrency(p.priceLevel5) : "-"}</TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-sky-600 hover:bg-sky-50"
                        onClick={() => handleOpenEdit(p)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Add Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-h-[92dvh] overflow-hidden bg-white p-0 text-slate-900 sm:max-w-5xl">
          <DialogHeader className="border-b border-slate-200 px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <PackagePlus className="h-5 w-5 text-primary" />
              เพิ่มสินค้าใหม่
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-5 py-5">
            <ProductForm />
          </div>
          <DialogFooter className="border-t border-slate-200 bg-slate-50 px-5 py-3">
            <Button variant="outline" className="border-slate-300" onClick={() => setIsAddOpen(false)}>ยกเลิก</Button>
            <Button className="bg-primary text-white hover:bg-primary/90" onClick={handleMockSave}>บันทึกสินค้า</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-h-[92dvh] overflow-hidden bg-white p-0 text-slate-900 sm:max-w-5xl">
          <DialogHeader className="border-b border-slate-200 px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Pencil className="h-5 w-5 text-primary" />
              แก้ไขสินค้า: {editingProduct?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-5 py-5">
            <ProductForm />
          </div>
          <DialogFooter className="border-t border-slate-200 bg-slate-50 px-5 py-3">
            <Button variant="outline" className="border-slate-300" onClick={() => setIsEditOpen(false)}>ยกเลิก</Button>
            <Button className="bg-sky-500 text-white hover:bg-sky-600" onClick={handleMockSave}>บันทึกการแก้ไข</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
