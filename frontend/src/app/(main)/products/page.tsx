"use client";

import { useEffect, useState, useMemo } from "react";
import { api, apiFetch } from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Search, Plus, PackagePlus, Barcode, Tags, Truck,
  Pencil, ChevronUp, ChevronDown, ChevronsUpDown, X,
  Layers, RefreshCw, Trash2
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

// ─── EAN-13 Generator (prefix 200-209 for internal use) ──────────────
function generateEAN13(): string {
  const prefix = "200";
  let num = prefix;
  for (let i = 0; i < 9; i++) num += Math.floor(Math.random() * 10);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(num[i]) * (i % 2 === 0 ? 1 : 3);
  return num + ((10 - (sum % 10)) % 10);
}

// ─── Packaging unit type ──────────────────────────────────────────────
interface PackagingUnit {
  name: string;       // e.g. "กล่อง", "ลัง"
  qtyPerPrev: string; // qty of previous unit inside 1 of this (e.g. "30")
  barcode: string;
}

// Compute cumulative multipliers: index i = total base units per 1 of unit[i]
function computeMultipliers(units: PackagingUnit[]): number[] {
  let cum = 1;
  return units.map(u => { cum *= parseInt(u.qtyPerPrev) || 1; return cum; });
}

// Format stock as "2 ลัง 3 กล่อง 5 ซอง"
function formatStockBreakdown(baseStock: number, baseUnit: string, units: PackagingUnit[]): string {
  if (!units.length) return `${baseStock}`;
  const mults = computeMultipliers(units);
  const parts: string[] = [];
  let remaining = baseStock;
  for (let i = units.length - 1; i >= 0; i--) {
    const qty = Math.floor(remaining / mults[i]);
    remaining = remaining % mults[i];
    if (qty > 0) parts.push(`${qty} ${units[i].name}`);
  }
  if (remaining > 0 || parts.length === 0) parts.push(`${remaining} ${baseUnit || "ชิ้น"}`);
  return parts.join(" ");
}

// ─── Initial form state ───────────────────────────────────────────────
const makeInitialForm = () => ({
  name: "",
  sku: generateEAN13(),
  unit: "",
  size: "",
  color: "",
  supplierId: "",
  categoryId: "",
  basePrice: "",
  priceLevel1: "",
  priceLevel2: "",
  priceLevel3: "",
  priceLevel4: "",
  priceLevel5: "",
  barcode: "",
  packagingUnits: [] as PackagingUnit[],
  wholesaleSteps: Array.from({ length: 5 }, () => ({ minQuantity: "", unitPrice: "" })),
});

type ProductForm = ReturnType<typeof makeInitialForm>;
type SortKey = "name" | "stock" | "basePrice" | "priceLevel1" | "priceLevel2" | "priceLevel3" | "priceLevel4" | "priceLevel5";
type SortDir = "asc" | "desc";

// ─── Sort icon helper ─────────────────────────────────────────────────
function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 text-slate-400 inline" />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3 h-3 ml-1 text-sky-500 inline" />
    : <ChevronDown className="w-3 h-3 ml-1 text-sky-500 inline" />;
}

// ─── Page Component ───────────────────────────────────────────────────
export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [colorFilter, setColorFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Dialogs
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [form, setForm] = useState<ProductForm>(makeInitialForm());

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

  // Dynamic size & color options for current category
  const sizeOptions = useMemo(() => {
    const src = categoryFilter === "all" ? products : products.filter(p => p.categoryId === categoryFilter);
    return [...new Set(src.map(p => p.size).filter(Boolean))];
  }, [products, categoryFilter]);

  const colorOptions = useMemo(() => {
    const src = categoryFilter === "all" ? products : products.filter(p => p.categoryId === categoryFilter);
    return [...new Set(src.map(p => p.color).filter(Boolean))];
  }, [products, categoryFilter]);

  // Filtered + sorted list
  const filtered = useMemo(() => {
    let list = products.filter(p => {
      const q = search.toLowerCase();
      const matchSearch =
        (p.name || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.barcodes?.[0]?.barcode || "").includes(search);
      const matchCat = categoryFilter === "all" || p.categoryId === categoryFilter;
      const matchSize = sizeFilter === "all" || p.size === sizeFilter;
      const matchColor = colorFilter === "all" || p.color === colorFilter;
      const stock = p.stock ?? 0;
      const matchStock =
        stockFilter === "all" ? true :
        stockFilter === "out" ? stock === 0 :
        stock > 0 && stock <= 10;
      return matchSearch && matchCat && matchSize && matchColor && matchStock;
    });
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
        if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
      });
    }
    return list;
  }, [products, search, categoryFilter, sizeFilter, colorFilter, stockFilter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // Form helpers
  const updateForm = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const addPackagingUnit = () =>
    setForm(prev => ({ ...prev, packagingUnits: [...prev.packagingUnits, { name: "", qtyPerPrev: "", barcode: "" }] }));

  const updatePackagingUnit = (i: number, key: keyof PackagingUnit, value: string) =>
    setForm(prev => ({ ...prev, packagingUnits: prev.packagingUnits.map((u, j) => j === i ? { ...u, [key]: value } : u) }));

  const removePackagingUnit = (i: number) =>
    setForm(prev => ({ ...prev, packagingUnits: prev.packagingUnits.filter((_, j) => j !== i) }));

  const updateWholesale = (i: number, key: "minQuantity" | "unitPrice", value: string) =>
    setForm(prev => ({ ...prev, wholesaleSteps: prev.wholesaleSteps.map((s, j) => j === i ? { ...s, [key]: value } : s) }));

  const handleOpenAdd = () => {
    setForm(makeInitialForm());
    setEditingProduct(null);
    setDialogMode("add");
  };

  const handleOpenEdit = (p: any) => {
    setEditingProduct(p);
    setForm({
      name: p.name || "",
      sku: p.sku || generateEAN13(),
      unit: p.unit || "",
      size: p.size || "",
      color: p.color || "",
      supplierId: p.supplierId || "",
      categoryId: p.categoryId || "",
      basePrice: p.basePrice?.toString() || "",
      priceLevel1: p.priceLevel1?.toString() || "",
      priceLevel2: p.priceLevel2?.toString() || "",
      priceLevel3: p.priceLevel3?.toString() || "",
      priceLevel4: p.priceLevel4?.toString() || "",
      priceLevel5: p.priceLevel5?.toString() || "",
      barcode: p.barcodes?.[0]?.barcode || "",
      packagingUnits: [],
      wholesaleSteps: Array.from({ length: 5 }, () => ({ minQuantity: "", unitPrice: "" })),
    });
    setDialogMode("edit");
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("กรุณาระบุชื่อสินค้า"); return; }
    toast.success(`${dialogMode === "edit" ? "แก้ไข" : "เพิ่ม"}สินค้าสำเร็จ`);
    setDialogMode(null);
  };

  const packagingMultipliers = useMemo(() => computeMultipliers(form.packagingUnits), [form.packagingUnits]);

  // ─── Shared Form JSX (rendered inline) ────────────────────────────
  const renderForm = () => (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* Left: main details */}
      <div className="space-y-5">

        {/* Basic Info */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <Tags className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-slate-900">รายละเอียดสินค้า</h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">ชื่อสินค้า *</label>
              <Input value={form.name} onChange={e => updateForm("name", e.target.value)} placeholder="เช่น มาม่า รสหมูสับ" className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">หน่วยหลัก (หน่วยย่อยสุด)</label>
              <Input value={form.unit} onChange={e => updateForm("unit", e.target.value)} placeholder="เช่น ซอง, ชิ้น, ขวด" className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">หมวดหมู่</label>
              <select value={form.categoryId} onChange={e => updateForm("categoryId", e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary">
                <option value="">เลือกหมวดหมู่</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">ขนาด</label>
              <Input value={form.size} onChange={e => updateForm("size", e.target.value)} placeholder="เช่น 60g, 1L, 30x40" className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">สี</label>
              <Input value={form.color} onChange={e => updateForm("color", e.target.value)} placeholder="เช่น ขาว, ดำ, น้ำเงิน" className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">ผู้จำหน่าย</label>
              <select value={form.supplierId} onChange={e => updateForm("supplierId", e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary">
                <option value="">เลือกผู้จำหน่าย</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Barcode & SKU */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <Barcode className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-slate-900">รหัสสินค้า &amp; บาร์โค้ด</h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">รหัสสินค้า (EAN-13 อัตโนมัติ)</label>
              <div className="flex gap-2">
                <Input value={form.sku} onChange={e => updateForm("sku", e.target.value)} placeholder="EAN-13" className="h-10 border-slate-300 font-mono flex-1" />
                <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 border-slate-300 hover:border-primary hover:text-primary" title="สุ่ม EAN-13 ใหม่" onClick={() => updateForm("sku", generateEAN13())}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-slate-400">ระบบสร้าง EAN-13 ให้อัตโนมัติ กดปุ่ม 🔄 เพื่อสุ่มใหม่</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">บาร์โค้ดหน่วยหลัก</label>
              <Input value={form.barcode} onChange={e => updateForm("barcode", e.target.value)} placeholder="สแกนหรือกรอก" className="h-10 border-slate-300 font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">ราคาต้นทุน</label>
              <Input type="number" min="0" step="0.01" value={form.basePrice} onChange={e => updateForm("basePrice", e.target.value)} placeholder="0.00" className="h-10 border-slate-300 text-right" />
            </div>
          </div>
        </section>

        {/* Price Levels */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <Tags className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-slate-900">ราคาขาย 1–5</h3>
          </div>
          <div className="grid gap-3 grid-cols-5">
            {([1, 2, 3, 4, 5] as const).map(n => (
              <div key={n} className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">ราคา {n}</label>
                <Input type="number" min="0" step="0.01" value={(form as any)[`priceLevel${n}`]} onChange={e => updateForm(`priceLevel${n}` as any, e.target.value)} placeholder="0.00" className="h-10 border-slate-300 text-right" />
              </div>
            ))}
          </div>
        </section>

        {/* Packaging Units (สินค้าสัมพันธ์) */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-slate-900">สินค้าสัมพันธ์ (หน่วยบรรจุ)</h3>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-primary text-primary hover:bg-primary/5" onClick={addPackagingUnit}>
              <Plus className="w-3 h-3 mr-1" /> เพิ่มหน่วยบรรจุ
            </Button>
          </div>

          {form.packagingUnits.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-sm text-slate-400 space-y-1">
              <Layers className="w-8 h-8 mx-auto text-slate-200 mb-2" />
              <p className="font-medium">ยังไม่มีหน่วยบรรจุ</p>
              <p>เช่น มาม่า 1 ลัง = 6 กล่อง, 1 กล่อง = 30 ซอง</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Base unit row */}
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-2.5 text-sm border border-slate-200">
                <div className="w-6 h-6 rounded-full bg-slate-300 text-white flex items-center justify-center text-xs font-bold shrink-0">0</div>
                <span className="text-slate-600">หน่วยหลัก:</span>
                <span className="font-bold text-slate-900">{form.unit || <span className="text-slate-400 font-normal">ยังไม่ระบุ</span>}</span>
                <span className="ml-auto text-xs text-slate-400">= 1</span>
              </div>

              {form.packagingUnits.map((unit, idx) => {
                const multiplier = packagingMultipliers[idx];
                const prevName = idx === 0 ? (form.unit || "หน่วยหลัก") : form.packagingUnits[idx - 1].name || `หน่วย ${idx}`;
                return (
                  <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-xs font-bold shrink-0">{idx + 1}</div>
                        <span className="text-sm font-semibold text-slate-700">หน่วยบรรจุ #{idx + 1}</span>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => removePackagingUnit(idx)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-600">ชื่อหน่วย</label>
                        <Input value={unit.name} onChange={e => updatePackagingUnit(idx, "name", e.target.value)} placeholder="เช่น กล่อง, ลัง" className="h-9 border-slate-300 text-sm" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-600">จำนวน {prevName} ต่อ 1 {unit.name || "หน่วยนี้"}</label>
                        <Input type="number" min="1" step="1" value={unit.qtyPerPrev} onChange={e => updatePackagingUnit(idx, "qtyPerPrev", e.target.value)} placeholder="เช่น 30" className="h-9 border-slate-300 text-sm text-right" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-600">บาร์โค้ดหน่วยนี้</label>
                        <div className="flex gap-1">
                          <Input value={unit.barcode} onChange={e => updatePackagingUnit(idx, "barcode", e.target.value)} placeholder="บาร์โค้ด" className="h-9 border-slate-300 text-sm font-mono flex-1" />
                          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-slate-400 hover:text-primary" title="สุ่มบาร์โค้ด" onClick={() => updatePackagingUnit(idx, "barcode", generateEAN13())}>
                            <RefreshCw className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    {multiplier > 1 && (
                      <div className="rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-xs text-sky-700 font-medium">
                        📦 1 {unit.name || "หน่วยนี้"} = <span className="font-bold">{multiplier.toLocaleString()}</span> {form.unit || "หน่วยหลัก"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Right: Wholesale Steps */}
      <div className="space-y-5">
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-4 flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-slate-900">ราคาส่ง 5 Step</h3>
          </div>
          <div className="space-y-3">
            {form.wholesaleSteps.map((step, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold text-slate-400 uppercase">Step {idx + 1}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">จำนวนตั้งแต่</label>
                    <Input type="number" min="0" step="1" value={step.minQuantity} onChange={e => updateWholesale(idx, "minQuantity", e.target.value)} placeholder="เช่น 6" className="h-9 border-slate-300 text-right text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">ราคาต่อชิ้น</label>
                    <Input type="number" min="0" step="0.01" value={step.unitPrice} onChange={e => updateWholesale(idx, "unitPrice", e.target.value)} placeholder="เช่น 10" className="h-9 border-slate-300 text-right text-sm" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">เช่น ≥ 6 ชิ้น ราคา 10 บ., ≥ 12 ชิ้น ราคา 9 บ.</p>
        </section>
      </div>
    </div>
  );

  // ─── Main Render ──────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">สินค้า</h1>
          <p className="text-slate-500 mt-1">จัดการรายการสินค้า ราคา และสต็อก</p>
        </div>
        <Button className="h-11 w-full bg-primary px-6 font-bold text-white hover:bg-primary/90 sm:w-auto" onClick={handleOpenAdd}>
          <Plus className="w-5 h-5 mr-2" /> เพิ่มสินค้าใหม่
        </Button>
      </div>

      {/* Filter Toolbar */}
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="ค้นหาชื่อ, รหัส, บาร์โค้ด..." className="pl-9 bg-white border-slate-300 h-10" value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Dropdown */}
        <select
          value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value); setSizeFilter("all"); setColorFilter("all"); }}
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        >
          <option value="all">📁 ทุกหมวดหมู่</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>

        {/* Size Dropdown (visible only when options exist) */}
        {sizeOptions.length > 0 && (
          <select
            value={sizeFilter}
            onChange={e => setSizeFilter(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <option value="all">📏 ทุกขนาด</option>
            {sizeOptions.map(s => <option key={s as string} value={s as string}>{s as string}</option>)}
          </select>
        )}

        {/* Color Dropdown (visible only when options exist) */}
        {colorOptions.length > 0 && (
          <select
            value={colorFilter}
            onChange={e => setColorFilter(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <option value="all">🎨 ทุกสี</option>
            {colorOptions.map(c => <option key={c as string} value={c as string}>{c as string}</option>)}
          </select>
        )}

        {/* Stock Status Filter */}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {([
            { key: "all", label: "ทั้งหมด" },
            { key: "low", label: "⚠️ ใกล้หมด" },
            { key: "out", label: "🔴 หมดสต็อก" },
          ] as const).map(opt => (
            <button
              key={opt.key}
              onClick={() => setStockFilter(opt.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${stockFilter === opt.key ? "bg-slate-200 text-slate-900" : "text-slate-500 hover:bg-slate-100"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="mb-3 flex gap-2 flex-wrap text-sm text-slate-500">
        <span>แสดง <b className="text-slate-800">{filtered.length}</b> รายการ จากทั้งหมด {products.length}</span>
        {categoryFilter !== "all" && <span>· <b className="text-sky-600">{categories.find(c => c.id === categoryFilter)?.name}</b></span>}
        {sizeFilter !== "all" && <span>· ขนาด <b className="text-sky-600">{sizeFilter}</b></span>}
        {colorFilter !== "all" && <span>· สี <b className="text-sky-600">{colorFilter}</b></span>}
        {stockFilter !== "all" && <span>· <b className="text-amber-600">{stockFilter === "out" ? "หมดสต็อก" : "ใกล้หมด"}</b></span>}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="text-slate-500 text-center whitespace-nowrap">บาร์โค้ด</TableHead>
                <TableHead className="text-slate-500 whitespace-nowrap">รหัสสินค้า</TableHead>
                <TableHead className="text-slate-500 whitespace-nowrap cursor-pointer hover:text-sky-600 select-none" onClick={() => handleSort("name")}>
                  ชื่อสินค้า <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead className="text-slate-500 whitespace-nowrap">หมวดหมู่</TableHead>
                <TableHead className="text-slate-500 text-right whitespace-nowrap cursor-pointer hover:text-sky-600 select-none" onClick={() => handleSort("stock")}>
                  จำนวน <SortIcon col="stock" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead className="text-slate-500 text-center whitespace-nowrap">หน่วย</TableHead>
                <TableHead className="text-slate-500 text-right whitespace-nowrap cursor-pointer hover:text-sky-600 select-none" onClick={() => handleSort("basePrice")}>
                  ต้นทุน <SortIcon col="basePrice" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                {([1, 2, 3, 4, 5] as const).map(n => (
                  <TableHead key={n} className="text-slate-500 text-right whitespace-nowrap cursor-pointer hover:text-sky-600 select-none" onClick={() => handleSort(`priceLevel${n}` as SortKey)}>
                    ราคา {n} <SortIcon col={`priceLevel${n}` as SortKey} sortKey={sortKey} sortDir={sortDir} />
                  </TableHead>
                ))}
                <TableHead className="text-slate-500 text-center whitespace-nowrap">แก้ไข</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={13} className="text-center h-32 text-slate-500">กำลังโหลด...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={13} className="text-center h-40 text-slate-400">ไม่พบสินค้าที่ตรงกับเงื่อนไข</TableCell></TableRow>
              ) : filtered.map(p => {
                const stock = p.stock ?? 0;
                const stockClass =
                  stock === 0 ? "bg-rose-50 text-rose-600 border-rose-200" :
                  stock <= 10 ? "bg-amber-50 text-amber-600 border-amber-200" :
                  "bg-emerald-50 text-emerald-700 border-emerald-200";
                return (
                  <TableRow key={p.id} className="border-slate-100 hover:bg-slate-50">
                    <TableCell className="text-center">
                      <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">{p.barcodes?.[0]?.barcode || "-"}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold text-slate-600 whitespace-nowrap">{p.sku}</TableCell>
                    <TableCell className="font-semibold text-slate-900 min-w-[180px]">{p.name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 font-normal">{getCategoryName(p.categoryId)}</Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Badge variant="outline" className={stockClass}>{stock}</Badge>
                    </TableCell>
                    <TableCell className="text-center text-slate-500 text-sm whitespace-nowrap">{p.unit || "-"}</TableCell>
                    <TableCell className="text-right text-slate-600 text-sm whitespace-nowrap">{p.basePrice != null ? formatCurrency(p.basePrice) : "-"}</TableCell>
                    <TableCell className="text-right font-semibold text-emerald-600 whitespace-nowrap">{p.priceLevel1 != null ? formatCurrency(p.priceLevel1) : p.basePrice != null ? formatCurrency(p.basePrice) : "-"}</TableCell>
                    <TableCell className="text-right text-slate-600 whitespace-nowrap">{p.priceLevel2 != null ? formatCurrency(p.priceLevel2) : "-"}</TableCell>
                    <TableCell className="text-right text-slate-600 whitespace-nowrap">{p.priceLevel3 != null ? formatCurrency(p.priceLevel3) : "-"}</TableCell>
                    <TableCell className="text-right text-slate-600 whitespace-nowrap">{p.priceLevel4 != null ? formatCurrency(p.priceLevel4) : "-"}</TableCell>
                    <TableCell className="text-right text-slate-600 whitespace-nowrap">{p.priceLevel5 != null ? formatCurrency(p.priceLevel5) : "-"}</TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-sky-600 hover:bg-sky-50" onClick={() => handleOpenEdit(p)}>
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

      {/* ─── Add / Edit Dialog ─────────────────────────────────────────── */}
      <Dialog open={dialogMode !== null} onOpenChange={open => { if (!open) setDialogMode(null); }}>
        <DialogContent className="flex flex-col bg-white p-0 text-slate-900 sm:max-w-5xl max-h-[92dvh] overflow-hidden gap-0">
          <DialogHeader className="border-b border-slate-200 px-6 py-4 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              {dialogMode === "edit"
                ? <><Pencil className="h-5 w-5 text-primary" /> แก้ไขสินค้า: {editingProduct?.name}</>
                : <><PackagePlus className="h-5 w-5 text-primary" /> เพิ่มสินค้าใหม่</>
              }
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {renderForm()}
          </div>

          <DialogFooter className="border-t border-slate-200 bg-slate-50 px-6 py-4 shrink-0 flex-row gap-2">
            <Button variant="outline" className="border-slate-300 text-slate-600" onClick={() => setDialogMode(null)}>
              ยกเลิก
            </Button>
            <Button
              className={dialogMode === "edit" ? "bg-sky-500 text-white hover:bg-sky-600" : "bg-primary text-white hover:bg-primary/90"}
              onClick={handleSave}
            >
              {dialogMode === "edit" ? "บันทึกการแก้ไข" : "บันทึกสินค้า"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
