"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { api, apiFetch } from "@/lib/api";
import Link from "next/link";
import { loadCategories } from "@/lib/category-storage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Search, Plus, PackagePlus, Barcode, Tags, Truck,
  Pencil, ChevronUp, ChevronDown, ChevronsUpDown, X,
  Layers, RefreshCw, Trash2, ChevronRight, Building2, Info,
  ImagePlus, Star, Crown, Upload, FolderTree
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

// ─── Image Types & Helpers ───────────────────────────────────────────
interface ProductImage {
  id: string;
  dataUrl: string;   // base64 compressed JPEG
  name: string;
  isCover: boolean;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Compress image to max 900px, JPEG quality 0.82
function compressImage(file: File, maxPx = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round((h / w) * maxPx); w = maxPx; }
          else { w = Math.round((w / h) * maxPx); h = maxPx; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function saveImages(productId: string, images: ProductImage[]) {
  try {
    const slim = images.map(img => ({ ...img, dataUrl: img.dataUrl.slice(0, 5) === "data:" ? img.dataUrl : "" }));
    localStorage.setItem(`img_${productId}`, JSON.stringify(images));
  } catch { toast.warning("พื้นที่ localStorage เต็ม ไม่สามารถบันทึกรูปได้"); }
}

function loadImages(productId: string): ProductImage[] {
  try { const r = localStorage.getItem(`img_${productId}`); return r ? JSON.parse(r) : []; } catch { return []; }
}

// ─── Types ────────────────────────────────────────────────────────────
interface ProductBarcode {
  barcode: string;
  supplierId?: string;
  label?: string; // เช่น "บาร์โค้ดจาก บ.นิวยอร์ค", "บาร์โค้ดผู้ผลิตจีน"
}

interface ProductSupplierEntry {
  supplierId: string;
  lastCost: string;  // ต้นทุนซื้อล่าสุดจากผู้จำหน่ายนี้
  notes: string;
}

interface PackagingUnit {
  name: string;
  qtyPerPrev: string;
  barcode: string;
  priceLevel1: string;
  priceLevel2: string;
  priceLevel3: string;
  priceLevel4: string;
  priceLevel5: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────
function computeMultipliers(units: PackagingUnit[]): number[] {
  let cum = 1;
  return units.map(u => { cum *= parseInt(u.qtyPerPrev) || 1; return cum; });
}

function savePackaging(productId: string, units: PackagingUnit[]) {
  try { localStorage.setItem(`pkg_${productId}`, JSON.stringify(units)); } catch {}
}

function loadPackaging(productId: string): PackagingUnit[] {
  try { const r = localStorage.getItem(`pkg_${productId}`); return r ? JSON.parse(r) : []; } catch { return []; }
}

function saveWholesale(productId: string, steps: any[]) {
  try { localStorage.setItem(`ws_${productId}`, JSON.stringify(steps)); } catch {}
}

function loadWholesale(productId: string): any[] {
  try { const r = localStorage.getItem(`ws_${productId}`); return r ? JSON.parse(r) : []; } catch { return []; }
}

function saveSavedProducts(prods: any[]) {
  try { localStorage.setItem("custom_products", JSON.stringify(prods)); } catch {}
}

function loadSavedProducts(): any[] | null {
  try {
    const raw = localStorage.getItem("custom_products");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── Initial form ─────────────────────────────────────────────────────
const makeInitialForm = () => ({
  name: "",
  sku: generateEAN13(),
  unit: "",
  size: "",
  color: "",
  categoryId: "",
  basePrice: "",           // ต้นทุนอ้างอิง (ถัวเฉลี่ยหรือค่าล่าสุด)
  priceLevel1: "", priceLevel2: "", priceLevel3: "", priceLevel4: "", priceLevel5: "",
  barcodes: [{ barcode: "", supplierId: "", label: "" }] as ProductBarcode[],
  supplierEntries: [] as ProductSupplierEntry[],
  packagingUnits: [] as PackagingUnit[],
  images: [] as ProductImage[],
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

// ─── Page ──────────────────────────────────────────────────────────────
export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [allPackaging, setAllPackaging] = useState<Record<string, PackagingUnit[]>>({});
  const [allImages, setAllImages] = useState<Record<string, ProductImage[]>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [colorFilter, setColorFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [form, setForm] = useState<ProductForm>(makeInitialForm());

  useEffect(() => {
    Promise.all([api.getProducts(), apiFetch("/suppliers").catch(() => [])]).then(([prods, supps]) => {
      const savedProds = loadSavedProducts();
      const finalProds = savedProds && savedProds.length > 0 ? savedProds : prods;
      setProducts(finalProds);
      setCategories(loadCategories());
      setSuppliers(supps || []);
      const pkgMap: Record<string, PackagingUnit[]> = {};
      const imgMap: Record<string, ProductImage[]> = {};
      (finalProds as any[]).forEach((p: any) => {
        pkgMap[p.id] = loadPackaging(p.id);
        imgMap[p.id] = loadImages(p.id);
      });
      setAllPackaging(pkgMap);
      setAllImages(imgMap);
      setLoading(false);
    });
  }, []);

  const getCategoryName = (id: string) => categories.find(c => c.id === id)?.name || "-";
  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || "-";

  const sizeOptions = useMemo(() => [...new Set((categoryFilter === "all" ? products : products.filter(p => p.categoryId === categoryFilter)).map((p: any) => p.size).filter(Boolean))] as string[], [products, categoryFilter]);
  const colorOptions = useMemo(() => [...new Set((categoryFilter === "all" ? products : products.filter(p => p.categoryId === categoryFilter)).map((p: any) => p.color).filter(Boolean))] as string[], [products, categoryFilter]);

  const filtered = useMemo(() => {
    let list = products.filter((p: any) => {
      const q = search.toLowerCase();
      const allBarcodes = [...(p.barcodes || []).map((b: any) => b.barcode), ...(allPackaging[p.id] || []).map(u => u.barcode)];
      const matchSearch = (p.name || "").toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q) || allBarcodes.some(b => b?.includes(search));
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

  const handleSort = (key: SortKey) => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } };
  const toggleExpand = (id: string) => setExpandedRows(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const updateForm = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Barcodes
  const addBarcode = () => setForm(prev => ({ ...prev, barcodes: [...prev.barcodes, { barcode: "", supplierId: "", label: "" }] }));
  const updateBarcode = (i: number, key: keyof ProductBarcode, val: string) =>
    setForm(prev => ({ ...prev, barcodes: prev.barcodes.map((b, j) => j === i ? { ...b, [key]: val } : b) }));
  const removeBarcode = (i: number) => setForm(prev => ({ ...prev, barcodes: prev.barcodes.filter((_, j) => j !== i) }));

  // Supplier entries
  const addSupplierEntry = () => setForm(prev => ({ ...prev, supplierEntries: [...prev.supplierEntries, { supplierId: "", lastCost: "", notes: "" }] }));
  const updateSupplierEntry = (i: number, key: keyof ProductSupplierEntry, val: string) =>
    setForm(prev => ({ ...prev, supplierEntries: prev.supplierEntries.map((s, j) => j === i ? { ...s, [key]: val } : s) }));
  const removeSupplierEntry = (i: number) => setForm(prev => ({ ...prev, supplierEntries: prev.supplierEntries.filter((_, j) => j !== i) }));

  // Packaging
  const addPackagingUnit = () => setForm(prev => ({ ...prev, packagingUnits: [...prev.packagingUnits, { name: "", qtyPerPrev: "", barcode: "", priceLevel1: "", priceLevel2: "", priceLevel3: "", priceLevel4: "", priceLevel5: "" }] }));
  const updatePackagingUnit = (i: number, key: keyof PackagingUnit, val: string) =>
    setForm(prev => ({ ...prev, packagingUnits: prev.packagingUnits.map((u, j) => j === i ? { ...u, [key]: val } : u) }));
  const removePackagingUnit = (i: number) => setForm(prev => ({ ...prev, packagingUnits: prev.packagingUnits.filter((_, j) => j !== i) }));
  const updateWholesale = (i: number, key: "minQuantity" | "unitPrice", val: string) =>
    setForm(prev => ({ ...prev, wholesaleSteps: prev.wholesaleSteps.map((s, j) => j === i ? { ...s, [key]: val } : s) }));

  const packagingMultipliers = useMemo(() => computeMultipliers(form.packagingUnits), [form.packagingUnits]);

  // Auto-calculate average cost from supplier entries
  const avgCostFromSuppliers = useMemo(() => {
    const valid = form.supplierEntries.filter(s => s.lastCost && parseFloat(s.lastCost) > 0);
    if (!valid.length) return null;
    return (valid.reduce((sum, s) => sum + parseFloat(s.lastCost), 0) / valid.length).toFixed(2);
  }, [form.supplierEntries]);

  const handleOpenAdd = () => { setForm(makeInitialForm()); setEditingProduct(null); setDialogMode("add"); };

  const handleOpenEdit = (p: any) => {
    setEditingProduct(p);
    setForm({
      name: p.name || "", sku: p.sku || generateEAN13(), unit: p.unit || "",
      size: p.size || "", color: p.color || "", categoryId: p.categoryId || "",
      basePrice: p.basePrice?.toString() || "",
      priceLevel1: p.priceLevel1?.toString() || "", priceLevel2: p.priceLevel2?.toString() || "",
      priceLevel3: p.priceLevel3?.toString() || "", priceLevel4: p.priceLevel4?.toString() || "",
      priceLevel5: p.priceLevel5?.toString() || "",
      barcodes: p.barcodes?.length ? p.barcodes.map((b: any) => ({ barcode: b.barcode || "", supplierId: b.supplierId || "", label: b.label || "" })) : [{ barcode: "", supplierId: "", label: "" }],
      supplierEntries: [],
      packagingUnits: allPackaging[p.id] || [],
      images: p.id ? loadImages(p.id) : [],
      wholesaleSteps: p.id && loadWholesale(p.id).length ? loadWholesale(p.id) : Array.from({ length: 5 }, () => ({ minQuantity: "", unitPrice: "" })),
    });
    setDialogMode("edit");
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("กรุณาระบุชื่อสินค้า"); return; }
    
    let targetId = editingProduct?.id;
    if (!targetId) {
      targetId = "prod_" + Date.now();
    }

    const updatedProductObj = {
      id: targetId,
      name: form.name.trim(),
      sku: form.sku.trim() || generateEAN13(),
      unit: form.unit.trim(),
      size: form.size.trim(),
      color: form.color.trim(),
      categoryId: form.categoryId,
      basePrice: form.basePrice ? parseFloat(form.basePrice) : null,
      priceLevel1: form.priceLevel1 ? parseFloat(form.priceLevel1) : null,
      priceLevel2: form.priceLevel2 ? parseFloat(form.priceLevel2) : null,
      priceLevel3: form.priceLevel3 ? parseFloat(form.priceLevel3) : null,
      priceLevel4: form.priceLevel4 ? parseFloat(form.priceLevel4) : null,
      priceLevel5: form.priceLevel5 ? parseFloat(form.priceLevel5) : null,
      stock: editingProduct?.stock ?? 0,
      barcodes: form.barcodes.filter(b => b.barcode.trim()).map(b => ({
        barcode: b.barcode.trim(),
        supplierId: b.supplierId || "",
        label: b.label || "",
      })),
    };

    let newProductsList: any[];
    if (editingProduct?.id) {
      newProductsList = products.map(p => p.id === editingProduct.id ? { ...p, ...updatedProductObj } : p);
    } else {
      newProductsList = [updatedProductObj, ...products];
    }

    setProducts(newProductsList);
    saveSavedProducts(newProductsList);

    savePackaging(targetId, form.packagingUnits);
    setAllPackaging(prev => ({ ...prev, [targetId]: form.packagingUnits }));
    if (form.packagingUnits.length > 0) setExpandedRows(prev => new Set([...prev, targetId]));
    saveImages(targetId, form.images);
    setAllImages(prev => ({ ...prev, [targetId]: form.images }));
    saveWholesale(targetId, form.wholesaleSteps);

    toast.success(`${dialogMode === "edit" ? "แก้ไข" : "เพิ่ม"}สินค้าสำเร็จ`);
    setDialogMode(null);
  };

  // ─── Image handlers ────────────────────────────────────────────────
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [imgDragOver, setImgDragOver] = useState(false);

  const handleImageFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const remaining = 3 - form.images.length;
    if (remaining <= 0) { toast.warning("เพิ่มรูปได้สูงสุด 3 รูป"); return; }
    const toProcess = Array.from(files).filter(f => f.type.startsWith("image/")).slice(0, remaining);
    for (const file of toProcess) {
      try {
        const dataUrl = await compressImage(file);
        const isFirst = form.images.length === 0;
        setForm(prev => ({
          ...prev,
          images: [...prev.images, { id: generateId(), dataUrl, name: file.name, isCover: prev.images.length === 0 }],
        }));
      } catch { toast.error(`ไม่สามารถโหลดรูป ${file.name}`); }
    }
  }, [form.images.length]);

  const setCoverImage = (id: string) =>
    setForm(prev => ({ ...prev, images: prev.images.map(img => ({ ...img, isCover: img.id === id })) }));

  const removeImage = (id: string) =>
    setForm(prev => {
      const remaining = prev.images.filter(img => img.id !== id);
      if (remaining.length > 0 && !remaining.some(img => img.isCover)) remaining[0].isCover = true;
      return { ...prev, images: remaining };
    });

  // ─── Form ─────────────────────────────────────────────────────────
  const renderForm = () => (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-5">

        {/* 0. รูปภาพสินค้า */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <ImagePlus className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-slate-900">รูปภาพสินค้า</h3>
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">สูงสุด 3 รูป</span>
          </div>

          {/* Drop zone / image grid */}
          <div
            className={`grid grid-cols-3 gap-3 mb-3 transition-all rounded-xl ${
              imgDragOver ? "ring-2 ring-primary ring-offset-2 bg-primary/5" : ""
            }`}
            onDragOver={e => { e.preventDefault(); setImgDragOver(true); }}
            onDragLeave={() => setImgDragOver(false)}
            onDrop={e => { e.preventDefault(); setImgDragOver(false); handleImageFiles(e.dataTransfer.files); }}
          >
            {/* Filled image slots */}
            {form.images.map(img => (
              <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden border-2 border-slate-200">
                <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
                {/* Cover badge */}
                {img.isCover && (
                  <div className="absolute top-2 left-2 flex items-center gap-1 bg-amber-400 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow">
                    <Crown className="w-2.5 h-2.5" /> หน้าปก
                  </div>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  {!img.isCover && (
                    <button onClick={() => setCoverImage(img.id)} className="w-8 h-8 rounded-full bg-amber-400 hover:bg-amber-500 flex items-center justify-center shadow" title="ตั้งเป็นหน้าปก">
                      <Crown className="w-4 h-4 text-amber-900" />
                    </button>
                  )}
                  <button onClick={() => removeImage(img.id)} className="w-8 h-8 rounded-full bg-rose-500 hover:bg-rose-600 flex items-center justify-center shadow" title="ลบรูป">
                    <Trash2 className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            ))}

            {/* Empty upload slot(s) */}
            {form.images.length < 3 && (
              <button
                onClick={() => imgInputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-primary transition-colors cursor-pointer"
              >
                <Upload className="w-7 h-7" />
                <span className="text-xs font-medium">{form.images.length === 0 ? "เพิ่มรูปภาพ" : "เพิ่มรูปอีก"}</span>
                <span className="text-[10px]">{3 - form.images.length} ช่องเหลือ</span>
              </button>
            )}

            {/* Placeholder empty slots (visual) */}
            {Array.from({ length: Math.max(0, 2 - form.images.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square rounded-xl border-2 border-dashed border-slate-100 bg-slate-50/50" />
            ))}
          </div>

          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => { handleImageFiles(e.target.files); e.target.value = ""; }}
          />

          <div className="flex items-start gap-2 rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-xs text-sky-700">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <p>ลากวางรูปที่นี่ได้เลย · รูปถูกบีบอัดและเก็บในเครื่องชั่วคราว · เมื่อเชื่อมต่อ backend จะอัปโหลดถาวร</p>
          </div>
        </section>

        {/* 1. รายละเอียดสินค้า */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
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
              <label className="text-sm font-medium text-slate-700">รหัสสินค้า EAN-13 (Identity หลัก)</label>
              <div className="flex gap-2">
                <Input value={form.sku} onChange={e => updateForm("sku", e.target.value)} className="h-10 border-slate-300 font-mono flex-1" />
                <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 hover:border-primary hover:text-primary" title="สุ่ม EAN-13" onClick={() => updateForm("sku", generateEAN13())}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-slate-400">EAN-13 นี้คือ identity หลักของสินค้า ไม่ใช่บาร์โค้ดที่ใช้สแกน (บาร์โค้ดใช้สแกนระบุด้านล่าง)</p>
            </div>
          </div>
        </section>

        {/* 2. บาร์โค้ดทั้งหมด */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Barcode className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-slate-900">บาร์โค้ดทั้งหมด</h3>
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">สแกนบาร์โค้ดไหนก็ได้ → ตัดสต็อกสินค้าเดียวกัน</span>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-primary text-primary hover:bg-primary/5" onClick={addBarcode}>
              <Plus className="w-3 h-3 mr-1" /> เพิ่มบาร์โค้ด
            </Button>
          </div>
          <div className="space-y-2">
            {form.barcodes.map((b, i) => (
              <div key={i} className="flex gap-2 items-center">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input value={b.barcode} onChange={e => updateBarcode(i, "barcode", e.target.value)} placeholder="สแกนหรือกรอกบาร์โค้ด" className="h-9 border-slate-300 font-mono text-sm" />
                  <select
                    value={b.supplierId || ""}
                    onChange={e => updateBarcode(i, "supplierId", e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary"
                  >
                    <option value="">เลือกผู้จำหน่าย (ถ้ามี)</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <Input value={b.label || ""} onChange={e => updateBarcode(i, "label", e.target.value)} placeholder="หมายเหตุ เช่น บาร์โค้ดจาก บ.A" className="h-9 border-slate-300 text-sm" />
                </div>
                {form.barcodes.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => removeBarcode(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">เพิ่มบาร์โค้ดได้หลายอัน และสามารถเลือกผู้จำหน่ายที่ผูกกับแต่ละบาร์โค้ดได้</p>
        </section>

        {/* 3. ผู้จำหน่ายและต้นทุน */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-slate-900">ผู้จำหน่ายและต้นทุน</h3>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-primary text-primary hover:bg-primary/5" onClick={addSupplierEntry}>
              <Plus className="w-3 h-3 mr-1" /> เพิ่มผู้จำหน่าย
            </Button>
          </div>

          {/* Cost strategy note */}
          <div className="mb-4 flex gap-2 rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <div>
              <p className="font-semibold mb-1">กลยุทธ์ต้นทุน (FIFO Pool)</p>
              <p>สต็อกรวมจากทุก supplier เป็น <b>pool เดียว</b> → ตัดสต็อกถูกต้องเสมอ<br />
              ต้นทุนขายคิดแบบ FIFO จาก pool เดียวกัน → อาจคลาดเคลื่อนเล็กน้อยถ้าต้นทุนต่าง supplier ต่างกัน<br />
              แต่ถ้าสินค้าจีนประเภทเดียวกัน ต้นทุนมักใกล้เคียงกัน ≈ยอมรับได้</p>
            </div>
          </div>

          {form.supplierEntries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-5 text-center text-sm text-slate-400">
              <Building2 className="w-7 h-7 mx-auto text-slate-200 mb-1" />
              <p>ยังไม่มีผู้จำหน่าย — คลิก "เพิ่มผู้จำหน่าย" เพื่อเพิ่ม</p>
            </div>
          ) : (
            <div className="space-y-2">
              {form.supplierEntries.map((entry, i) => (
                <div key={i} className="grid grid-cols-[1fr_120px_1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    {i === 0 && <label className="text-xs font-medium text-slate-500">ผู้จำหน่าย</label>}
                    <select value={entry.supplierId} onChange={e => updateSupplierEntry(i, "supplierId", e.target.value)} className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary">
                      <option value="">เลือกผู้จำหน่าย</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    {i === 0 && <label className="text-xs font-medium text-slate-500">ต้นทุน/ชิ้น</label>}
                    <Input type="number" min="0" step="0.01" value={entry.lastCost} onChange={e => updateSupplierEntry(i, "lastCost", e.target.value)} placeholder="0.00" className="h-9 border-slate-300 text-sm text-right" />
                  </div>
                  <div className="space-y-1">
                    {i === 0 && <label className="text-xs font-medium text-slate-500">หมายเหตุ</label>}
                    <Input value={entry.notes} onChange={e => updateSupplierEntry(i, "notes", e.target.value)} placeholder="เช่น นำเข้าจากจีน, ส่งตรง" className="h-9 border-slate-300 text-sm" />
                  </div>
                  <Button type="button" variant="ghost" size="icon" className={`h-9 w-9 shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50 ${i === 0 ? "mt-5" : ""}`} onClick={() => removeSupplierEntry(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}

              {/* Auto-calculated average cost */}
              {avgCostFromSuppliers && (
                <div className="mt-3 flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-sm">
                  <span className="text-emerald-700">ต้นทุนเฉลี่ยจากทุก supplier:</span>
                  <span className="font-bold text-emerald-800">{formatCurrency(parseFloat(avgCostFromSuppliers))}</span>
                  <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-xs text-emerald-600 hover:text-emerald-800 hover:bg-emerald-100" onClick={() => updateForm("basePrice", avgCostFromSuppliers)}>
                    ใช้เป็นต้นทุนอ้างอิง →
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Reference cost */}
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium text-slate-700">ต้นทุนอ้างอิง (สำหรับแสดงผล/ประมาณการ)</label>
              <Input type="number" min="0" step="0.01" value={form.basePrice} onChange={e => updateForm("basePrice", e.target.value)} placeholder="0.00" className="h-10 border-slate-300 text-right max-w-[160px]" />
            </div>
            <p className="text-xs text-slate-400 flex-1">ต้นทุนจริงคำนวณจาก FIFO เมื่อมีการขาย ตัวเลขนี้ใช้แสดงในรายงานประมาณการเท่านั้น</p>
          </div>
        </section>

        {/* 4. ราคาขาย */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
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

        {/* 5. Packaging units */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-slate-900">สินค้าสัมพันธ์ — หน่วยบรรจุ</h3>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-primary text-primary hover:bg-primary/5" onClick={addPackagingUnit}>
              <Plus className="w-3 h-3 mr-1" /> เพิ่มหน่วยบรรจุ
            </Button>
          </div>

          {form.packagingUnits.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-6 text-center text-sm text-slate-400">
              <Layers className="w-7 h-7 mx-auto text-slate-200 mb-1" />
              <p>เช่น มาม่า → กล่อง (30 ซอง) → ลัง (6 กล่อง = 180 ซอง)</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-2.5 text-sm border border-slate-200">
                <div className="w-6 h-6 rounded-full bg-slate-400 text-white flex items-center justify-center text-xs font-bold shrink-0">0</div>
                <span className="text-slate-500">หน่วยย่อยสุด:</span>
                <span className="font-bold text-slate-900">{form.unit || "—"}</span>
                <span className="ml-auto text-xs text-slate-400 bg-slate-200 px-2 py-0.5 rounded">× 1</span>
              </div>
              {form.packagingUnits.map((unit, idx) => {
                const multiplier = packagingMultipliers[idx];
                const prevName = idx === 0 ? (form.unit || "หน่วยย่อย") : form.packagingUnits[idx - 1].name || `หน่วย ${idx}`;
                const autoCost = form.basePrice ? (parseFloat(form.basePrice) * multiplier).toFixed(2) : "";
                return (
                  <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                    <div className="flex items-center justify-between bg-sky-50 border-b border-sky-100 px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center text-xs font-bold shrink-0">{idx + 1}</div>
                        <span className="text-sm font-semibold text-sky-900">หน่วยบรรจุ #{idx + 1}</span>
                        {multiplier > 1 && <span className="text-xs text-sky-600 bg-sky-100 px-2 py-0.5 rounded-full font-medium">1 {unit.name || "หน่วยนี้"} = {multiplier.toLocaleString()} {form.unit || "หน่วยย่อย"}</span>}
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => removePackagingUnit(idx)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="p-4 space-y-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-600">ชื่อหน่วย</label>
                          <Input value={unit.name} onChange={e => updatePackagingUnit(idx, "name", e.target.value)} placeholder="กล่อง, ลัง" className="h-9 border-slate-300 bg-white text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-600">จำนวน {prevName} ต่อ 1 {unit.name || "หน่วยนี้"}</label>
                          <Input type="number" min="1" value={unit.qtyPerPrev} onChange={e => updatePackagingUnit(idx, "qtyPerPrev", e.target.value)} placeholder="30" className="h-9 border-slate-300 bg-white text-sm text-right" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-600">บาร์โค้ดหน่วยนี้</label>
                          <div className="flex gap-1">
                            <Input value={unit.barcode} onChange={e => updatePackagingUnit(idx, "barcode", e.target.value)} placeholder="บาร์โค้ด" className="h-9 border-slate-300 bg-white text-sm font-mono flex-1" />
                            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-slate-400 hover:text-primary" onClick={() => updatePackagingUnit(idx, "barcode", generateEAN13())}><RefreshCw className="w-3.5 h-3.5" /></Button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Tags className="w-3.5 h-3.5 text-primary" />
                          <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">ราคาขาย 1–5 ของ {unit.name || "หน่วยนี้"}</label>
                          {autoCost && <span className="text-xs text-slate-400">(ต้นทุน ≈ {formatCurrency(parseFloat(autoCost))})</span>}
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                          {([1, 2, 3, 4, 5] as const).map(n => (
                            <div key={n} className="space-y-1">
                              <label className="text-[10px] text-slate-500">ราคา {n}</label>
                              <Input type="number" min="0" step="0.01" value={(unit as any)[`priceLevel${n}`]} onChange={e => updatePackagingUnit(idx, `priceLevel${n}` as any, e.target.value)} placeholder="0.00" className="h-8 border-slate-300 bg-white text-xs text-right" />
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

      {/* Right: Wholesale */}
      <div>
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-5 sticky top-4">
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
          <p className="mt-3 text-xs text-slate-400">เช่น ≥ 6 ชิ้น ราคา 10 บ.</p>
        </section>
      </div>
    </div>
  );

  // ─── Main render ───────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">สินค้า</h1>
          <p className="text-slate-500 mt-1">จัดการรายการสินค้า ราคา และสต็อก</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <Link href="/categories" className="w-full sm:w-auto">
            <Button variant="outline" className="h-11 w-full border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto">
              <FolderTree className="w-5 h-5 mr-2 text-primary" /> จัดการหมวดหมู่
            </Button>
          </Link>
          <Button className="h-11 w-full bg-primary px-6 font-bold text-white hover:bg-primary/90 sm:w-auto" onClick={handleOpenAdd}>
            <Plus className="w-5 h-5 mr-2" /> เพิ่มสินค้าใหม่
          </Button>
        </div>
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
                const prodImages = allImages[p.id] || [];
                const coverImg = prodImages.find(img => img.isCover)?.dataUrl || prodImages[0]?.dataUrl || p.imageUrl || null;

                return (
                  <>
                    <TableRow key={p.id} className={`border-slate-100 hover:bg-slate-50 ${isExpanded ? "bg-sky-50/20" : ""}`}>
                      <TableCell className="text-center p-0 pl-2">
                        {pkgUnits.length > 0 ? (
                          <button onClick={() => toggleExpand(p.id)} className="w-7 h-7 rounded flex items-center justify-center text-sky-500 hover:bg-sky-100 transition-colors">
                            <ChevronRight className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`} />
                          </button>
                        ) : <div className="w-7 h-7" />}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col gap-1 items-center">
                          {(p.barcodes?.slice(0, 3) || []).map((b: any, bi: number) => {
                            const sName = getSupplierName(b.supplierId);
                            return (
                              <div key={bi} className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                <span>{b.barcode}</span>
                                {sName !== "-" && (
                                  <span className="text-[10px] text-sky-700 bg-sky-100 font-sans px-1 rounded font-medium">
                                    {sName}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          {(p.barcodes?.length || 0) > 3 && <span className="text-xs text-slate-400">+{p.barcodes.length - 3} อื่นๆ</span>}
                          {!p.barcodes?.length && <span className="text-slate-300 text-xs">—</span>}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-slate-600 whitespace-nowrap">{p.sku}</TableCell>
                      <TableCell className="font-semibold text-slate-900 min-w-[200px]">
                        <div className="flex items-center gap-2.5">
                          {coverImg ? (
                            <img src={coverImg} alt={p.name} className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0 shadow-sm" />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0 text-base">
                              {categories.find(c => c.id === p.categoryId)?.icon || "📦"}
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span>{p.name}</span>
                              {prodImages.length > 0 && (
                                <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded font-medium">
                                  📷 {prodImages.length}
                                </span>
                              )}
                            </div>
                            {pkgUnits.length > 0 && <span className="text-xs text-sky-500 font-normal">{pkgUnits.length} ขนาดบรรจุ</span>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap"><Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 font-normal">{getCategoryName(p.categoryId)}</Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap"><Badge variant="outline" className={stockClass}>{stock}</Badge></TableCell>
                      <TableCell className="text-center text-slate-500 text-sm whitespace-nowrap">{p.unit || "-"}</TableCell>
                      <TableCell className="text-right text-slate-600 text-sm whitespace-nowrap">{p.basePrice != null ? formatCurrency(p.basePrice) : "-"}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-600 whitespace-nowrap">{p.priceLevel1 != null ? formatCurrency(p.priceLevel1) : p.basePrice != null ? formatCurrency(p.basePrice) : "-"}</TableCell>
                      {[2,3,4,5].map(n => <TableCell key={n} className="text-right text-slate-600 whitespace-nowrap">{(p as any)[`priceLevel${n}`] != null ? formatCurrency((p as any)[`priceLevel${n}`]) : "-"}</TableCell>)}
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-sky-600 hover:bg-sky-50" onClick={() => handleOpenEdit(p)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isExpanded && pkgUnits.map((unit, ui) => {
                      const mult = pkgMults[ui];
                      const unitStock = Math.floor(stock / mult);
                      const unitCost = p.basePrice != null ? p.basePrice * mult : null;
                      return (
                        <TableRow key={`${p.id}-pkg-${ui}`} className="bg-sky-50/40 border-sky-100 hover:bg-sky-50/60">
                          <TableCell className="p-0 pl-2"><div className="w-7 h-7 flex items-center justify-center"><div className="w-px h-5 bg-sky-200 ml-3.5" /></div></TableCell>
                          <TableCell className="text-center py-2"><span className="font-mono text-xs text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">{unit.barcode || "-"}</span></TableCell>
                          <TableCell className="py-2"><span className="text-xs text-slate-300">—</span></TableCell>
                          <TableCell className="py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-1 h-4 rounded-full bg-sky-300 shrink-0" />
                              <span className="text-sm font-semibold text-sky-800">{unit.name}</span>
                              <span className="text-xs text-sky-500 bg-sky-100 px-1.5 py-0.5 rounded-full">× {mult.toLocaleString()} {p.unit || "ชิ้น"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2"><span className="text-xs text-slate-300">—</span></TableCell>
                          <TableCell className="text-right py-2">
                            <Badge variant="outline" className={unitStock === 0 ? "bg-rose-50 text-rose-500 border-rose-200" : "bg-sky-50 text-sky-700 border-sky-200"}>{unitStock}</Badge>
                          </TableCell>
                          <TableCell className="text-center text-sky-700 text-sm py-2 font-medium">{unit.name}</TableCell>
                          <TableCell className="text-right text-slate-400 text-xs py-2">{unitCost != null ? formatCurrency(unitCost) : "-"}</TableCell>
                          <TableCell className="text-right py-2">{unit.priceLevel1 ? <span className="font-semibold text-emerald-600">{formatCurrency(parseFloat(unit.priceLevel1))}</span> : <span className="text-slate-300 text-xs">—</span>}</TableCell>
                          {[2,3,4,5].map(n => <TableCell key={n} className="text-right py-2">{(unit as any)[`priceLevel${n}`] ? <span className="text-slate-600 text-sm">{formatCurrency(parseFloat((unit as any)[`priceLevel${n}`]))}</span> : <span className="text-slate-300 text-xs">—</span>}</TableCell>)}
                          <TableCell className="py-2 text-center"><span className="text-slate-300 text-xs">—</span></TableCell>
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
              {dialogMode === "edit" ? <><Pencil className="h-5 w-5 text-primary" /> แก้ไขสินค้า: {editingProduct?.name}</> : <><PackagePlus className="h-5 w-5 text-primary" /> เพิ่มสินค้าใหม่</>}
            </DialogTitle>
          </DialogHeader>
          {/* ✅ เพิ่ม pb-6 กัน content ไม่ชนกับ footer */}
          <div className="flex-1 overflow-y-auto px-6 py-5 pb-6">
            {renderForm()}
          </div>
          {/* ✅ Footer มี padding ชัดเจน ปุ่มไม่ล้น */}
          <DialogFooter className="border-t border-slate-200 bg-slate-50 px-6 py-4 shrink-0 flex-row gap-3 justify-end">
            <Button variant="outline" className="border-slate-300 text-slate-600 px-6" onClick={() => setDialogMode(null)}>ยกเลิก</Button>
            <Button className={`px-8 ${dialogMode === "edit" ? "bg-sky-500 text-white hover:bg-sky-600" : "bg-primary text-white hover:bg-primary/90"}`} onClick={handleSave}>
              {dialogMode === "edit" ? "บันทึกการแก้ไข" : "บันทึกสินค้า"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
