"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { api, apiFetch } from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Search, Plus, PackagePlus, Barcode, Tags, Truck,
  Pencil, ChevronUp, ChevronDown, ChevronsUpDown, X,
  Layers, RefreshCw, Trash2, ChevronRight
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

// ─── EAN-13 Generator ─────────────────────────────────────────────────
function generateEAN13(): string {
  const prefix = "200";
  let num = prefix;
  for (let i = 0; i < 9; i++) num += Math.floor(Math.random() * 10);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(num[i]) * (i % 2 === 0 ? 1 : 3);
  return num + ((10 - (sum % 10)) % 10);
}

// ─── Packaging Unit (สินค้าสัมพันธ์) ──────────────────────────────────
interface PackagingUnit {
  name: string;        // ชื่อหน่วย เช่น "กล่อง", "ลัง"
  qtyPerPrev: string;  // จำนวนหน่วยก่อนหน้าต่อ 1 หน่วยนี้ เช่น "30"
  barcode: string;
  priceLevel1: string;
  priceLevel2: string;
  priceLevel3: string;
  priceLevel4: string;
  priceLevel5: string;
}

// Cumulative multipliers: mults[i] = total base units per 1 of packagingUnits[i]
function computeMultipliers(units: PackagingUnit[]): number[] {
  let cum = 1;
  return units.map(u => { cum *= parseInt(u.qtyPerPrev) || 1; return cum; });
}

// ─── localStorage helpers ──────────────────────────────────────────────
function savePackaging(productId: string, units: PackagingUnit[]) {
  try { localStorage.setItem(`pkg_${productId}`, JSON.stringify(units)); } catch {}
}

function loadPackaging(productId: string): PackagingUnit[] {
  try {
    const raw = localStorage.getItem(`pkg_${productId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ─── Initial form factory ──────────────────────────────────────────────
const makeInitialForm = () => ({
  name: "", sku: generateEAN13(), unit: "",
  size: "", color: "", supplierId: "", categoryId: "",
  basePrice: "",
  priceLevel1: "", priceLevel2: "", priceLevel3: "", priceLevel4: "", priceLevel5: "",
  barcode: "",
  packagingUnits: [] as PackagingUnit[],
  wholesaleSteps: Array.from({ length: 5 }, () => ({ minQuantity: "", unitPrice: "" })),
});

type ProductForm = ReturnType<typeof makeInitialForm>;
type SortKey = "name" | "stock" | "basePrice" | "priceLevel1" | "priceLevel2" | "priceLevel3" | "priceLevel4" | "priceLevel5";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 text-slate-400 inline" />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3 h-3 ml-1 text-sky-500 inline" />
    : <ChevronDown className="w-3 h-3 ml-1 text-sky-500 inline" />;
}

const emptyPackagingUnit = (): PackagingUnit => ({
  name: "", qtyPerPrev: "", barcode: "",
  priceLevel1: "", priceLevel2: "", priceLevel3: "", priceLevel4: "", priceLevel5: "",
});

// ─── Page ──────────────────────────────────────────────────────────────
export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // packaging data loaded from localStorage per product id
  const [allPackaging, setAllPackaging] = useState<Record<string, PackagingUnit[]>>({});
  // expanded rows in table
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [colorFilter, setColorFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Dialog
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
      // load all packaging from localStorage
      const pkgMap: Record<string, PackagingUnit[]> = {};
      (prods as any[]).forEach(p => { pkgMap[p.id] = loadPackaging(p.id); });
      setAllPackaging(pkgMap);
      setLoading(false);
    });
  }, []);

  const getCategoryName = (id: string) => categories.find(c => c.id === id)?.name || "-";

  const sizeOptions = useMemo(() => {
    const src = categoryFilter === "all" ? products : products.filter(p => p.categoryId === categoryFilter);
    return [...new Set(src.map((p: any) => p.size).filter(Boolean))] as string[];
  }, [products, categoryFilter]);

  const colorOptions = useMemo(() => {
    const src = categoryFilter === "all" ? products : products.filter(p => p.categoryId === categoryFilter);
    return [...new Set(src.map((p: any) => p.color).filter(Boolean))] as string[];
  }, [products, categoryFilter]);

  const filtered = useMemo(() => {
    let list = products.filter((p: any) => {
      const q = search.toLowerCase();
      const barcodes = [p.barcodes?.[0]?.barcode || "", ...(allPackaging[p.id] || []).map(u => u.barcode)];
      const matchSearch =
        (p.name || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        barcodes.some(b => b.includes(search));
      const matchCat = categoryFilter === "all" || p.categoryId === categoryFilter;
      const matchSize = sizeFilter === "all" || p.size === sizeFilter;
      const matchColor = colorFilter === "all" || p.color === colorFilter;
      const stock = p.stock ?? 0;
      const matchStock = stockFilter === "all" ? true : stockFilter === "out" ? stock === 0 : stock > 0 && stock <= 10;
      return matchSearch && matchCat && matchSize && matchColor && matchStock;
    });
    if (sortKey) {
      list = [...list].sort((a: any, b: any) => {
        const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
        if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
      });
    }
    return list;
  }, [products, search, categoryFilter, sizeFilter, colorFilter, stockFilter, sortKey, sortDir, allPackaging]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const toggleExpand = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── Form helpers ──────────────────────────────────────────────────
  const updateForm = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const updatePackagingUnit = (i: number, key: keyof PackagingUnit, value: string) =>
    setForm(prev => ({ ...prev, packagingUnits: prev.packagingUnits.map((u, j) => j === i ? { ...u, [key]: value } : u) }));

  const removePackagingUnit = (i: number) =>
    setForm(prev => ({ ...prev, packagingUnits: prev.packagingUnits.filter((_, j) => j !== i) }));

  const updateWholesale = (i: number, key: "minQuantity" | "unitPrice", value: string) =>
    setForm(prev => ({ ...prev, wholesaleSteps: prev.wholesaleSteps.map((s, j) => j === i ? { ...s, [key]: value } : s) }));

  const addPackagingUnit = () =>
    setForm(prev => ({ ...prev, packagingUnits: [...prev.packagingUnits, emptyPackagingUnit()] }));

  const handleOpenAdd = () => {
    setForm(makeInitialForm());
    setEditingProduct(null);
    setDialogMode("add");
  };

  const handleOpenEdit = (p: any) => {
    setEditingProduct(p);
    const existingPkg = allPackaging[p.id] || [];
    setForm({
      name: p.name || "", sku: p.sku || generateEAN13(), unit: p.unit || "",
      size: p.size || "", color: p.color || "", supplierId: p.supplierId || "",
      categoryId: p.categoryId || "", basePrice: p.basePrice?.toString() || "",
      priceLevel1: p.priceLevel1?.toString() || "", priceLevel2: p.priceLevel2?.toString() || "",
      priceLevel3: p.priceLevel3?.toString() || "", priceLevel4: p.priceLevel4?.toString() || "",
      priceLevel5: p.priceLevel5?.toString() || "", barcode: p.barcodes?.[0]?.barcode || "",
      packagingUnits: existingPkg.length > 0 ? existingPkg : [],
      wholesaleSteps: Array.from({ length: 5 }, () => ({ minQuantity: "", unitPrice: "" })),
    });
    setDialogMode("edit");
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("กรุณาระบุชื่อสินค้า"); return; }
    // Save packaging to localStorage if editing existing product
    if (editingProduct?.id) {
      savePackaging(editingProduct.id, form.packagingUnits);
      setAllPackaging(prev => ({ ...prev, [editingProduct.id]: form.packagingUnits }));
      if (form.packagingUnits.length > 0) {
        setExpandedRows(prev => new Set([...prev, editingProduct.id]));
      }
    }
    toast.success(`${dialogMode === "edit" ? "แก้ไข" : "เพิ่ม"}สินค้าสำเร็จ`);
    setDialogMode(null);
  };

  const packagingMultipliers = useMemo(() => computeMultipliers(form.packagingUnits), [form.packagingUnits]);

  // ─── Render form ───────────────────────────────────────────────────
  const renderForm = () => (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-5">

        {/* Basic Info */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <Tags className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-slate-900">รายละเอียดสินค้า</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">ชื่อสินค้า *</label>
              <Input value={form.name} onChange={e => updateForm("name", e.target.value)} placeholder="เช่น มาม่า รสหมูสับ" className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">หน่วยย่อยสุด</label>
              <Input value={form.unit} onChange={e => updateForm("unit", e.target.value)} placeholder="เช่น ซอง, ชิ้น, ขวด" className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">หมวดหมู่</label>
              <select value={form.categoryId} onChange={e => updateForm("categoryId", e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary">
                <option value="">เลือกหมวดหมู่</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">ขนาด</label>
              <Input value={form.size} onChange={e => updateForm("size", e.target.value)} placeholder="60g, 1L, 30x40" className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">สี</label>
              <Input value={form.color} onChange={e => updateForm("color", e.target.value)} placeholder="ขาว, ดำ, น้ำเงิน" className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">ผู้จำหน่าย</label>
              <select value={form.supplierId} onChange={e => updateForm("supplierId", e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary">
                <option value="">เลือกผู้จำหน่าย</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Barcode & Cost */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <Barcode className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-slate-900">รหัส / บาร์โค้ด / ต้นทุน (หน่วยย่อยสุด)</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">รหัสสินค้า EAN-13</label>
              <div className="flex gap-2">
                <Input value={form.sku} onChange={e => updateForm("sku", e.target.value)} className="h-10 border-slate-300 font-mono flex-1" />
                <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" title="สุ่ม EAN-13" onClick={() => updateForm("sku", generateEAN13())}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">บาร์โค้ดหน่วยย่อย</label>
              <Input value={form.barcode} onChange={e => updateForm("barcode", e.target.value)} placeholder="สแกนหรือกรอก" className="h-10 border-slate-300 font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">ราคาต้นทุน</label>
              <Input type="number" min="0" step="0.01" value={form.basePrice} onChange={e => updateForm("basePrice", e.target.value)} placeholder="0.00" className="h-10 border-slate-300 text-right" />
            </div>
          </div>
        </section>

        {/* Price Levels (base unit) */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <Tags className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-slate-900">ราคาขาย 1–5 <span className="text-slate-400 font-normal text-sm">(หน่วยย่อยสุด: {form.unit || "—"})</span></h3>
          </div>
          <div className="grid gap-3 grid-cols-5">
            {([1, 2, 3, 4, 5] as const).map(n => (
              <div key={n} className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">ราคา {n}</label>
                <Input type="number" min="0" step="0.01" value={(form as any)[`priceLevel${n}`]} onChange={e => updateForm(`priceLevel${n}` as any, e.target.value)} placeholder="0.00" className="h-9 border-slate-300 text-right text-sm" />
              </div>
            ))}
          </div>
        </section>

        {/* Packaging Units */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-slate-900">สินค้าสัมพันธ์ — หน่วยบรรจุ</h3>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-primary text-primary hover:bg-primary/5" onClick={addPackagingUnit}>
              <Plus className="w-3 h-3 mr-1" /> เพิ่มหน่วยบรรจุ
            </Button>
          </div>

          {form.packagingUnits.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-6 text-center space-y-1">
              <Layers className="w-7 h-7 mx-auto text-slate-200 mb-1" />
              <p className="text-sm font-medium text-slate-400">ยังไม่มีหน่วยบรรจุ</p>
              <p className="text-xs text-slate-400">เช่น มาม่า → กล่อง (30 ซอง) → ลัง (6 กล่อง = 180 ซอง)</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Base unit indicator */}
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-2.5 text-sm border border-slate-200">
                <div className="w-6 h-6 rounded-full bg-slate-400 text-white flex items-center justify-center text-xs font-bold shrink-0">0</div>
                <span className="text-slate-500">หน่วยย่อยสุด:</span>
                <span className="font-bold text-slate-900">{form.unit || <span className="text-slate-400 font-normal">ยังไม่ระบุ</span>}</span>
                <span className="ml-auto text-xs text-slate-400 bg-slate-200 px-2 py-0.5 rounded">× 1</span>
              </div>

              {form.packagingUnits.map((unit, idx) => {
                const multiplier = packagingMultipliers[idx];
                const prevName = idx === 0 ? (form.unit || "หน่วยย่อย") : form.packagingUnits[idx - 1].name || `หน่วย ${idx}`;
                const autoCost = form.basePrice ? (parseFloat(form.basePrice) * multiplier).toFixed(2) : "";
                return (
                  <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                    {/* Header row */}
                    <div className="flex items-center justify-between bg-sky-50 border-b border-sky-100 px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center text-xs font-bold shrink-0">{idx + 1}</div>
                        <span className="text-sm font-semibold text-sky-900">หน่วยบรรจุ #{idx + 1}</span>
                        {multiplier > 1 && (
                          <span className="text-xs text-sky-600 bg-sky-100 px-2 py-0.5 rounded-full font-medium">
                            1 {unit.name || "หน่วยนี้"} = {multiplier.toLocaleString()} {form.unit || "หน่วยย่อย"}
                          </span>
                        )}
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => removePackagingUnit(idx)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    <div className="p-4 space-y-4">
                      {/* Name, Qty, Barcode row */}
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-600">ชื่อหน่วย</label>
                          <Input value={unit.name} onChange={e => updatePackagingUnit(idx, "name", e.target.value)} placeholder="เช่น กล่อง, ลัง" className="h-9 border-slate-300 bg-white text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-600">จำนวน {prevName} ต่อ 1 {unit.name || "หน่วยนี้"}</label>
                          <Input type="number" min="1" step="1" value={unit.qtyPerPrev} onChange={e => updatePackagingUnit(idx, "qtyPerPrev", e.target.value)} placeholder="เช่น 30" className="h-9 border-slate-300 bg-white text-sm text-right" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-600">บาร์โค้ดหน่วยนี้</label>
                          <div className="flex gap-1">
                            <Input value={unit.barcode} onChange={e => updatePackagingUnit(idx, "barcode", e.target.value)} placeholder="บาร์โค้ด" className="h-9 border-slate-300 bg-white text-sm font-mono flex-1" />
                            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-slate-400 hover:text-primary" onClick={() => updatePackagingUnit(idx, "barcode", generateEAN13())}>
                              <RefreshCw className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* Price levels for this unit */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Tags className="w-3.5 h-3.5 text-primary" />
                          <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                            ราคาขาย 1–5 ของ {unit.name || "หน่วยนี้"}
                          </label>
                          {autoCost && (
                            <span className="text-xs text-slate-400">(ต้นทุนอัตโนมัติ ≈ {formatCurrency(parseFloat(autoCost))})</span>
                          )}
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                          {([1, 2, 3, 4, 5] as const).map(n => (
                            <div key={n} className="space-y-1">
                              <label className="text-[10px] text-slate-500 font-medium">ราคา {n}</label>
                              <Input
                                type="number" min="0" step="0.01"
                                value={(unit as any)[`priceLevel${n}`]}
                                onChange={e => updatePackagingUnit(idx, `priceLevel${n}` as any, e.target.value)}
                                placeholder={autoCost ? `~${autoCost}` : "0.00"}
                                className="h-8 border-slate-300 bg-white text-xs text-right"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Right: Wholesale steps */}
      <div>
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 sticky top-0">
          <div className="mb-3 flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-slate-900">ราคาส่ง 5 Step</h3>
          </div>
          <div className="space-y-3">
            {form.wholesaleSteps.map((step, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-1.5 text-xs font-semibold text-slate-400 uppercase">Step {idx + 1}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">จำนวนตั้งแต่</label>
                    <Input type="number" min="0" value={step.minQuantity} onChange={e => updateWholesale(idx, "minQuantity", e.target.value)} placeholder="6" className="h-8 border-slate-300 text-right text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">ราคา/ชิ้น</label>
                    <Input type="number" min="0" step="0.01" value={step.unitPrice} onChange={e => updateWholesale(idx, "unitPrice", e.target.value)} placeholder="0.00" className="h-8 border-slate-300 text-right text-sm" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">เช่น ≥ 6 ชิ้น ราคา 10 บ., ≥ 12 ชิ้น ราคา 9 บ.</p>
        </section>
      </div>
    </div>
  );

  // ─── Main render ───────────────────────────────────────────────────
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
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="ค้นหาชื่อ, รหัส, บาร์โค้ด..." className="pl-9 bg-white border-slate-300 h-10" value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
        </div>
        <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setSizeFilter("all"); setColorFilter("all"); }} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary">
          <option value="all">📁 ทุกหมวดหมู่</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        {sizeOptions.length > 0 && (
          <select value={sizeFilter} onChange={e => setSizeFilter(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary">
            <option value="all">📏 ทุกขนาด</option>
            {sizeOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {colorOptions.length > 0 && (
          <select value={colorFilter} onChange={e => setColorFilter(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary">
            <option value="all">🎨 ทุกสี</option>
            {colorOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {([{ key: "all", label: "ทั้งหมด" }, { key: "low", label: "⚠️ ใกล้หมด" }, { key: "out", label: "🔴 หมดสต็อก" }] as const).map(opt => (
            <button key={opt.key} onClick={() => setStockFilter(opt.key)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${stockFilter === opt.key ? "bg-slate-200 text-slate-900" : "text-slate-500 hover:bg-slate-100"}`}>{opt.label}</button>
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
                <TableHead className="w-8"></TableHead>
                <TableHead className="text-slate-500 text-center whitespace-nowrap">บาร์โค้ด</TableHead>
                <TableHead className="text-slate-500 whitespace-nowrap">รหัสสินค้า</TableHead>
                <TableHead className="text-slate-500 whitespace-nowrap cursor-pointer hover:text-sky-600 select-none" onClick={() => handleSort("name")}>ชื่อสินค้า <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} /></TableHead>
                <TableHead className="text-slate-500 whitespace-nowrap">หมวดหมู่</TableHead>
                <TableHead className="text-slate-500 text-right whitespace-nowrap cursor-pointer hover:text-sky-600 select-none" onClick={() => handleSort("stock")}>จำนวน <SortIcon col="stock" sortKey={sortKey} sortDir={sortDir} /></TableHead>
                <TableHead className="text-slate-500 text-center whitespace-nowrap">หน่วย</TableHead>
                <TableHead className="text-slate-500 text-right whitespace-nowrap cursor-pointer hover:text-sky-600 select-none" onClick={() => handleSort("basePrice")}>ต้นทุน <SortIcon col="basePrice" sortKey={sortKey} sortDir={sortDir} /></TableHead>
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
                <TableRow><TableCell colSpan={14} className="text-center h-32 text-slate-500">กำลังโหลด...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={14} className="text-center h-40 text-slate-400">ไม่พบสินค้าที่ตรงกับเงื่อนไข</TableCell></TableRow>
              ) : filtered.map((p: any) => {
                const stock = p.stock ?? 0;
                const stockClass = stock === 0 ? "bg-rose-50 text-rose-600 border-rose-200" : stock <= 10 ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200";
                const pkgUnits = allPackaging[p.id] || [];
                const pkgMults = computeMultipliers(pkgUnits);
                const isExpanded = expandedRows.has(p.id);

                return (
                  <>
                    {/* Main product row */}
                    <TableRow key={p.id} className={`border-slate-100 hover:bg-slate-50 ${isExpanded ? "bg-sky-50/30" : ""}`}>
                      {/* Expand toggle */}
                      <TableCell className="text-center p-0 pl-2">
                        {pkgUnits.length > 0 ? (
                          <button onClick={() => toggleExpand(p.id)} className="w-7 h-7 rounded flex items-center justify-center text-sky-500 hover:bg-sky-100 transition-colors" title={isExpanded ? "ยุบ" : `ดู ${pkgUnits.length} หน่วยบรรจุ`}>
                            <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                          </button>
                        ) : (
                          <div className="w-7 h-7" />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-mono text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{p.barcodes?.[0]?.barcode || "-"}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-slate-600 whitespace-nowrap">{p.sku}</TableCell>
                      <TableCell className="font-semibold text-slate-900 min-w-[160px]">
                        {p.name}
                        {pkgUnits.length > 0 && <span className="ml-2 text-xs text-sky-500 font-normal">{pkgUnits.length} ขนาด</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap"><Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 font-normal">{getCategoryName(p.categoryId)}</Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap"><Badge variant="outline" className={stockClass}>{stock}</Badge></TableCell>
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

                    {/* Packaging unit sub-rows */}
                    {isExpanded && pkgUnits.map((unit, ui) => {
                      const mult = pkgMults[ui];
                      const unitStock = Math.floor(stock / mult);
                      const unitCostBase = p.basePrice != null ? p.basePrice * mult : null;
                      return (
                        <TableRow key={`${p.id}-pkg-${ui}`} className="bg-sky-50/50 border-sky-100 hover:bg-sky-50">
                          <TableCell className="p-0 pl-2">
                            <div className="w-7 h-7 flex items-center justify-center">
                              <div className="w-px h-5 bg-sky-200 ml-3.5" />
                            </div>
                          </TableCell>
                          <TableCell className="text-center py-2">
                            <span className="font-mono text-xs text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">{unit.barcode || "-"}</span>
                          </TableCell>
                          <TableCell className="py-2">
                            <span className="text-xs text-slate-400 font-mono">—</span>
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-1 h-4 rounded-full bg-sky-300 shrink-0" />
                              <span className="text-sm font-semibold text-sky-800">{unit.name || `หน่วย ${ui + 1}`}</span>
                              <span className="text-xs text-sky-500 bg-sky-100 px-1.5 py-0.5 rounded-full">× {mult.toLocaleString()} {p.unit || "ชิ้น"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2"><span className="text-xs text-slate-400">—</span></TableCell>
                          <TableCell className="text-right py-2 whitespace-nowrap">
                            <Badge variant="outline" className={`${unitStock === 0 ? "bg-rose-50 text-rose-500 border-rose-200" : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                              {unitStock}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center text-sky-700 text-sm py-2 font-medium whitespace-nowrap">{unit.name}</TableCell>
                          <TableCell className="text-right text-slate-500 text-xs py-2 whitespace-nowrap">
                            {unitCostBase != null ? <span className="text-slate-400">{formatCurrency(unitCostBase)}</span> : "-"}
                          </TableCell>
                          {([1, 2, 3, 4, 5] as const).map(n => (
                            <TableCell key={n} className="text-right py-2 whitespace-nowrap">
                              {(unit as any)[`priceLevel${n}`]
                                ? <span className={n === 1 ? "font-semibold text-emerald-600" : "text-slate-600 text-sm"}>{formatCurrency((unit as any)[`priceLevel${n}`])}</span>
                                : <span className="text-slate-300 text-xs">—</span>
                              }
                            </TableCell>
                          ))}
                          <TableCell className="py-2 text-center">
                            <span className="text-slate-300 text-xs">—</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Dialog */}
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
            <Button variant="outline" className="border-slate-300 text-slate-600" onClick={() => setDialogMode(null)}>ยกเลิก</Button>
            <Button className={dialogMode === "edit" ? "bg-sky-500 text-white hover:bg-sky-600" : "bg-primary text-white hover:bg-primary/90"} onClick={handleSave}>
              {dialogMode === "edit" ? "บันทึกการแก้ไข" : "บันทึกสินค้า"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
