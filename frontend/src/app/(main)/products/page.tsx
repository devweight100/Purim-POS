"use client";

import { useEffect, useState, useMemo, useRef, useCallback, Fragment } from "react";
import { api, apiFetch } from "@/lib/api";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Search, Plus, PackagePlus, Barcode, Tags, Truck, Package,
  Pencil, ChevronUp, ChevronDown, ChevronsUpDown, X,
  Layers, RefreshCw, Trash2, ChevronRight, Building2, Info,
  ImagePlus, Star, Crown, Upload, FolderTree, FileSpreadsheet, AlertTriangle, Download, Gift
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { parseProductCSV, csvRowsToProducts } from "@/lib/csv-parser";
import { useProductStore } from "@/lib/store/product-store";
import * as XLSX from "xlsx";

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

function clearSavedProducts() {
  try { localStorage.removeItem("custom_products"); } catch {}
}

function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function getProductBarcodes(product: any): string[] {
  const fromBarcodes = Array.isArray(product?.barcodes)
    ? product.barcodes.map((b: any) => typeof b === 'string' ? b : b?.barcode)
    : [];
  const fromUnits = Array.isArray(product?.units)
    ? product.units.map((u: any) => u?.barcode)
    : [];
  const directBarcodes = [
    product?.barcode,
    product?.customBarcodeId,
    product?.barcodeForSelling,
  ];
  const seen = new Set<string>();
  return [...fromBarcodes, ...fromUnits, ...directBarcodes]
    .map((b) => String(b ?? '').trim())
    .filter((barcode) => {
      const key = normalizeKey(barcode);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getProductPackagingUnits(product: any): PackagingUnit[] {
  const units = Array.isArray(product?.packagingUnits) && product.packagingUnits.length > 0
    ? product.packagingUnits
    : product?.id ? loadPackaging(product.id) : [];

  return units.map((unit: any) => ({
    name: unit.name || unit.unitName || '',
    qtyPerPrev: String(unit.qtyPerPrev ?? unit.factor ?? ''),
    barcode: unit.barcode || '',
    priceLevel1: unit.priceLevel1 != null ? String(unit.priceLevel1) : '',
    priceLevel2: unit.priceLevel2 != null ? String(unit.priceLevel2) : '',
    priceLevel3: unit.priceLevel3 != null ? String(unit.priceLevel3) : '',
    priceLevel4: unit.priceLevel4 != null ? String(unit.priceLevel4) : '',
    priceLevel5: unit.priceLevel5 != null ? String(unit.priceLevel5) : '',
  }));
}

function getProductImages(product: any): ProductImage[] {
  if (Array.isArray(product?.images) && product.images.length > 0) {
    return product.images
      .filter((image: any) => image?.dataUrl)
      .map((image: any) => ({
        id: image.id || generateId(),
        dataUrl: image.dataUrl,
        name: image.name || '',
        isCover: Boolean(image.isCover),
      }));
  }
  return product?.id ? loadImages(product.id) : [];
}

function getProductWholesaleSteps(product: any) {
  const prices = Array.isArray(product?.wholesalePrices) && product.wholesalePrices.length > 0
    ? product.wholesalePrices
    : product?.id ? loadWholesale(product.id) : [];

  const rows = prices.map((price: any) => ({
    minQuantity: price.minQuantity != null ? String(price.minQuantity) : '',
    unitPrice: price.unitPrice != null ? String(price.unitPrice) : '',
  }));

  return rows.length > 0 ? rows : Array.from({ length: 5 }, () => ({ minQuantity: "", unitPrice: "" }));
}

function findDuplicateProduct(candidate: any, existingProducts: any[]): any | null {
  const candidateSku = normalizeKey(candidate.sku);
  const candidateBarcodes = new Set(getProductBarcodes(candidate).map(normalizeKey).filter(Boolean));

  return existingProducts.find((product) => {
    if (candidateSku && normalizeKey(product.sku) === candidateSku) return true;
    if (candidateSku) return false;
    return getProductBarcodes(product).some((barcode) => candidateBarcodes.has(normalizeKey(barcode)));
  }) || null;
}

function getConflictingImportBarcodeKeys(importedProducts: any[]): Set<string> {
  const barcodeToSkus = new Map<string, Set<string>>();

  importedProducts.forEach((product) => {
    const sku = normalizeKey(product.sku || product.id);
    getProductBarcodes(product).forEach((barcode) => {
      const key = normalizeKey(barcode);
      if (!key) return;
      const skus = barcodeToSkus.get(key) || new Set<string>();
      skus.add(sku);
      barcodeToSkus.set(key, skus);
    });
  });

  const conflicts = new Set<string>();
  barcodeToSkus.forEach((skus, barcode) => {
    if (skus.size > 1) conflicts.add(barcode);
  });
  return conflicts;
}

function stripConflictingBarcodes(product: any, conflictingBarcodeKeys: Set<string>) {
  if (conflictingBarcodeKeys.size === 0) return product;

  const safeBarcodes = getProductBarcodes(product).filter((barcode) => !conflictingBarcodeKeys.has(normalizeKey(barcode)));
  const safeBarcodeSet = new Set(safeBarcodes.map(normalizeKey));

  return {
    ...product,
    barcodes: safeBarcodes.map((barcode) => ({ barcode })),
    units: Array.isArray(product.units)
      ? product.units.map((unit: any) => ({
          ...unit,
          barcode: safeBarcodeSet.has(normalizeKey(unit?.barcode)) ? unit.barcode : '',
        }))
      : product.units,
  };
}

function productToApiPayload(product: any, conflictingBarcodeKeys = new Set<string>()) {
  const sellingPrice = Number(product.priceLevel1 ?? product.price ?? 0);
  const barcodes = getProductBarcodes(product).filter((barcode) => !conflictingBarcodeKeys.has(normalizeKey(barcode)));
  return {
    name: product.name,
    sku: product.sku,
    categoryId: product.categoryId || undefined,
    basePrice: sellingPrice,
    costPrice: Number(product.cost ?? product.costPrice ?? product.basePrice ?? 0),
    priceLevel1: product.priceLevel1 != null ? Number(product.priceLevel1) : undefined,
    priceLevel2: product.priceLevel2 != null ? Number(product.priceLevel2) : undefined,
    priceLevel3: product.priceLevel3 != null ? Number(product.priceLevel3) : undefined,
    priceLevel4: product.priceLevel4 != null ? Number(product.priceLevel4) : undefined,
    priceLevel5: product.priceLevel5 != null ? Number(product.priceLevel5) : undefined,
    unit: product.unit || '',
    barcodes,
    packagingUnits: Array.isArray(product.packagingUnits)
      ? product.packagingUnits.map((unit: any) => ({
          name: unit.name || unit.unitName || '',
          qtyPerPrev: Number(unit.qtyPerPrev || 1),
          barcode: unit.barcode || '',
          priceLevel1: unit.priceLevel1 !== '' && unit.priceLevel1 != null ? Number(unit.priceLevel1) : undefined,
          priceLevel2: unit.priceLevel2 !== '' && unit.priceLevel2 != null ? Number(unit.priceLevel2) : undefined,
          priceLevel3: unit.priceLevel3 !== '' && unit.priceLevel3 != null ? Number(unit.priceLevel3) : undefined,
          priceLevel4: unit.priceLevel4 !== '' && unit.priceLevel4 != null ? Number(unit.priceLevel4) : undefined,
          priceLevel5: unit.priceLevel5 !== '' && unit.priceLevel5 != null ? Number(unit.priceLevel5) : undefined,
        })).filter((unit: any) => unit.name)
      : undefined,
    images: Array.isArray(product.images)
      ? product.images.map((image: any) => ({
          dataUrl: image.dataUrl,
          name: image.name || '',
          isCover: Boolean(image.isCover),
        })).filter((image: any) => image.dataUrl)
      : undefined,
    wholesalePrices: Array.isArray(product.wholesalePrices)
      ? product.wholesalePrices.map((price: any) => ({
          minQuantity: Number(price.minQuantity || 0),
          unitPrice: Number(price.unitPrice || 0),
        })).filter((price: any) => price.minQuantity > 0 && price.unitPrice > 0)
      : undefined,
    isBundle: Boolean(product.isBundle),
    bundleItems: product.isBundle && Array.isArray(product.bundleItems)
      ? product.bundleItems
          .map((item: any) => ({
            childProductId: item.childProductId,
            quantity: Number(item.quantity) || 1,
          }))
          .filter((item: any) => item.childProductId)
      : undefined,
  };
}

function loadSuppliersFromStorage(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('custom_suppliers');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [];
}

// ─── Initial form ─────────────────────────────────────────────────────
const makeInitialForm = () => ({
  name: "",
  sku: generateEAN13(),
  unit: "",
  size: "",
  color: "",
  categoryId: "",
  stock: "0",              // จำนวนสต๊อกคงเหลือปัจจุบัน
  basePrice: "",           // ต้นทุนอ้างอิง (ถัวเฉลี่ยหรือค่าล่าสุด)
  minStockAlert: "10",     // จำนวนสต๊อกเตือนใกล้หมด
  priceLevel1: "", priceLevel2: "", priceLevel3: "", priceLevel4: "", priceLevel5: "",
  barcodes: [{ barcode: "", supplierId: "", label: "" }] as ProductBarcode[],
  supplierEntries: [] as ProductSupplierEntry[],
  packagingUnits: [] as PackagingUnit[],
  images: [] as ProductImage[],
  wholesaleSteps: Array.from({ length: 5 }, () => ({ minQuantity: "", unitPrice: "" })),
  defaultSellingUnitId: "",
  isBundle: false,
  bundleItems: [] as Array<{ childProductId: string; quantity: number | string }>,
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
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // Excel Import Preview state
  const [importPreviewData, setImportPreviewData] = useState<any[]>([]);
  const [isImportPreviewOpen, setIsImportPreviewOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Export current products to .xlsx
  const handleExportExcel = () => {
    if (products.length === 0) {
      toast.warning("ไม่มีรายการสินค้าให้ส่งออก");
      return;
    }

    const exportRows = products.map((p, idx) => {
      const barcodesList = [
        p.barcode,
        ...(Array.isArray(p.barcodes) ? p.barcodes.map((b: any) => (typeof b === "string" ? b : b.barcode)) : []),
      ].filter(Boolean);
      const uniqueBarcodes = Array.from(new Set(barcodesList)).join(", ");

      const costVal = Number(p.costPrice !== undefined && p.costPrice !== null ? p.costPrice : (p.cost ?? p.basePrice ?? 0));
      const price1Val = Number(p.priceLevel1 !== undefined && p.priceLevel1 !== null ? p.priceLevel1 : (p.price ?? p.basePrice ?? 0));

      return {
        "ลำดับ (No.)": idx + 1,
        "รหัสสินค้า (SKU)": p.sku || "",
        "บาร์โค้ด (Barcode)": uniqueBarcodes || p.sku || "",
        "ชื่อสินค้า (Product Name)": p.name || "",
        "หมวดหมู่ (Category)": p.category?.name || p.category || "ทั่วไป",
        "หน่วยนับ (Unit)": p.unit || "ชิ้น",
        "ราคาทุน (Cost Price)": costVal,
        "ราคาขาย 1 / ขายปลีก (Price 1)": price1Val,
        "ราคาขาย 2 (Price Level 2)": Number(p.priceLevel2 || 0),
        "ราคาขาย 3 (Price Level 3)": Number(p.priceLevel3 || 0),
        "ราคาขาย 4 (Price Level 4)": Number(p.priceLevel4 || 0),
        "ราคาขาย 5 (Price Level 5)": Number(p.priceLevel5 || 0),
        "จำนวนสต็อก (Stock)": Number(p.stock || 0),
        "จุดแจ้งเตือนสต็อกต่ำ (Min Stock)": Number(p.minStockAlert ?? 10),
        "รายละเอียดสินค้า (Description)": p.description || "",
        "รหัสระบบ (System ID - ห้ามแก้ไข)": p.id || "",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet["!cols"] = [
      { wch: 8 },  // ลำดับ
      { wch: 18 }, // SKU
      { wch: 22 }, // Barcode
      { wch: 35 }, // Name
      { wch: 16 }, // Category
      { wch: 10 }, // Unit
      { wch: 14 }, // Cost
      { wch: 16 }, // Price 1
      { wch: 14 }, // Level 2
      { wch: 14 }, // Level 3
      { wch: 14 }, // Level 4
      { wch: 14 }, // Level 5
      { wch: 12 }, // Stock
      { wch: 14 }, // Min Stock
      { wch: 30 }, // Description
      { wch: 38 }, // ID
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "รายการสินค้า");
    const todayStr = new Date().toISOString().split("T")[0];
    XLSX.writeFile(workbook, `สินค้า_POSร้านปุริม_${todayStr}.xlsx`);
    toast.success(`📊 ส่งออกข้อมูลสินค้า ${products.length} รายการเป็นไฟล์ Excel สำเร็จ`);
  };

  // Download Sample Excel Template
  const handleDownloadExcelTemplate = () => {
    const templateRows = [
      {
        "ลำดับ (No.)": 1,
        "รหัสสินค้า (SKU)": "SKU-001",
        "บาร์โค้ด (Barcode)": "8850001234567",
        "ชื่อสินค้า (Product Name)": "น้ำดื่มตราช้าง 600ml",
        "หมวดหมู่ (Category)": "เครื่องดื่ม",
        "หน่วยนับ (Unit)": "ขวด",
        "ราคาทุน (Cost Price)": 5.0,
        "ราคาขาย 1 / ขายปลีก (Price 1)": 10.0,
        "ราคาขาย 2 (Price Level 2)": 9.5,
        "ราคาขาย 3 (Price Level 3)": 9.0,
        "ราคาขาย 4 (Price Level 4)": 8.5,
        "ราคาขาย 5 (Price Level 5)": 8.0,
        "จำนวนสต็อก (Stock)": 100,
        "จุดแจ้งเตือนสต็อกต่ำ (Min Stock)": 10,
        "รายละเอียดสินค้า (Description)": "น้ำดื่มบริสุทธิ์ 600 มล.",
        "รหัสระบบ (System ID - ห้ามแก้ไข)": "",
      },
      {
        "ลำดับ (No.)": 2,
        "รหัสสินค้า (SKU)": "SKU-002",
        "บาร์โค้ด (Barcode)": "8850009876543",
        "ชื่อสินค้า (Product Name)": "มาม่ารสต้มยำกุ้ง 55g",
        "หมวดหมู่ (Category)": "บะหมี่กึ่งสำเร็จรูป",
        "หน่วยนับ (Unit)": "ซอง",
        "ราคาทุน (Cost Price)": 6.0,
        "ราคาขาย 1 / ขายปลีก (Price 1)": 7.0,
        "ราคาขาย 2 (Price Level 2)": 6.8,
        "ราคาขาย 3 (Price Level 3)": 6.5,
        "ราคาขาย 4 (Price Level 4)": 6.2,
        "ราคาขาย 5 (Price Level 5)": 6.0,
        "จำนวนสต็อก (Stock)": 200,
        "จุดแจ้งเตือนสต็อกต่ำ (Min Stock)": 20,
        "รายละเอียดสินค้า (Description)": "บะหมี่กึ่งสำเร็จรูป รสต้มยำกุ้ง",
        "รหัสระบบ (System ID - ห้ามแก้ไข)": "",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateRows);
    worksheet["!cols"] = [
      { wch: 8 },
      { wch: 18 },
      { wch: 22 },
      { wch: 35 },
      { wch: 16 },
      { wch: 10 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 14 },
      { wch: 30 },
      { wch: 38 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "แม่แบบสินค้า");
    XLSX.writeFile(workbook, "แม่แบบนำเข้าสินค้า_Template_POS.xlsx");
    toast.success("ดาวน์โหลดไฟล์แม่แบบ Excel สำหรับกรอกสินค้าเรียบร้อย");
  };

  const [importFilterTab, setImportFilterTab] = useState<"all" | "changed" | "new" | "unchanged">("all");
  const [importProgress, setImportProgress] = useState<number>(0);

  // Import from Excel or CSV with intelligent diff comparison
  const handleFileSelectForImport = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        if (!buffer) return;
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          toast.error("ไม่พบข้อมูลในไฟล์ Excel");
          return;
        }
        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet);

        if (rawJson.length === 0) {
          toast.error("ไม่พบแถวข้อมูลสินค้าในไฟล์ที่อัพโหลด");
          return;
        }

        const parsedItems = rawJson
          .map((row: any) => {
            const id = row["รหัสระบบ (System ID - ห้ามแก้ไข)"] || row["System ID"] || row["ID"] || row["id"] || undefined;
            const sku = String(row["รหัสสินค้า (SKU)"] || row["รหัสสินค้า"] || row["SKU"] || row["sku"] || row["code"] || "").trim();
            const name = String(row["ชื่อสินค้า (Product Name)"] || row["ชื่อสินค้า"] || row["Name"] || row["name"] || row["product_name"] || "").trim();
            const barcode = String(row["บาร์โค้ด (Barcode)"] || row["บาร์โค้ด"] || row["Barcode"] || row["barcode"] || "").trim();
            const categoryName = String(row["หมวดหมู่ (Category)"] || row["หมวดหมู่"] || row["Category"] || row["category"] || "ทั่วไป").trim();
            const unit = String(row["หน่วยนับ (Unit)"] || row["หน่วยนับ"] || row["Unit"] || row["unit"] || "ชิ้น").trim();

            const costPrice = Number(
              row["ราคาทุน (Cost Price)"] ??
              row["ราคาทุน"] ??
              row["Cost Price"] ??
              row["Cost"] ??
              row["costPrice"] ??
              row["cost"] ??
              0
            );

            const priceLevel1 = Number(
              row["ราคาขาย 1 / ขายปลีก (Price 1)"] ??
              row["ราคาขาย 1 / ขายปลีก (Price Level 1)"] ??
              row["ราคาขายปลีก / ราคาฐาน (Retail Price)"] ??
              row["ระดับราคา 1 (Price Level 1)"] ??
              row["ระดับราคา 1"] ??
              row["ราคาขาย 1"] ??
              row["ราคา 1"] ??
              row["ราคาขายปลีก"] ??
              row["ราคาขาย"] ??
              row["Retail Price"] ??
              row["Price 1"] ??
              row["priceLevel1"] ??
              row["price"] ??
              0
            );

            const priceLevel2 = Number(row["ราคาขาย 2 (Price Level 2)"] ?? row["ราคาขาย 2 (Price 2)"] ?? row["ระดับราคา 2 (Price Level 2)"] ?? row["ระดับราคา 2"] ?? row["ราคาขาย 2"] ?? row["ราคา 2"] ?? row["priceLevel2"] ?? 0);
            const priceLevel3 = Number(row["ราคาขาย 3 (Price Level 3)"] ?? row["ราคาขาย 3 (Price 3)"] ?? row["ระดับราคา 3 (Price Level 3)"] ?? row["ระดับราคา 3"] ?? row["ราคาขาย 3"] ?? row["ราคา 3"] ?? row["priceLevel3"] ?? 0);
            const priceLevel4 = Number(row["ราคาขาย 4 (Price Level 4)"] ?? row["ราคาขาย 4 (Price 4)"] ?? row["ระดับราคา 4 (Price Level 4)"] ?? row["ระดับราคา 4"] ?? row["ราคาขาย 4"] ?? row["ราคา 4"] ?? row["priceLevel4"] ?? 0);
            const priceLevel5 = Number(row["ราคาขาย 5 (Price Level 5)"] ?? row["ราคาขาย 5 (Price 5)"] ?? row["ระดับราคา 5 (Price Level 5)"] ?? row["ระดับราคา 5"] ?? row["ราคาขาย 5"] ?? row["ราคา 5"] ?? row["priceLevel5"] ?? 0);
            const stock = Number(row["จำนวนสต็อก (Stock)"] ?? row["จำนวนสต็อก"] ?? row["สต็อก"] ?? row["Stock"] ?? row["stock"] ?? 0);
            const minStockAlert = Number(row["จุดแจ้งเตือนสต็อกต่ำ (Min Stock)"] ?? row["จุดแจ้งเตือน"] ?? row["minStockAlert"] ?? 10);
            const description = String(row["รายละเอียดสินค้า (Description)"] ?? row["รายละเอียด"] ?? row["Description"] ?? row["description"] ?? "").trim();

            // Find matching product in existing catalog
            const existing = products.find(
              (p) => (id && p.id === id) || (sku && p.sku?.toLowerCase() === sku.toLowerCase()) || (barcode && p.barcode === barcode)
            );

            let changeType: "NEW" | "CHANGED" | "UNCHANGED" = "NEW";
            const diffs: string[] = [];

            if (existing) {
              const existingCost = Number(existing.costPrice !== undefined && existing.costPrice !== null ? existing.costPrice : (existing.cost ?? existing.basePrice ?? 0));
              const existingPrice1 = Number(existing.priceLevel1 !== undefined && existing.priceLevel1 !== null ? existing.priceLevel1 : (existing.price ?? existing.basePrice ?? 0));
              const existingPrice2 = Number(existing.priceLevel2 || 0);
              const existingPrice3 = Number(existing.priceLevel3 || 0);
              const existingPrice4 = Number(existing.priceLevel4 || 0);
              const existingPrice5 = Number(existing.priceLevel5 || 0);
              const existingStock = Number(existing.stock ?? existing.computedStock ?? 0);

              if (name && name !== existing.name) {
                diffs.push(`ชื่อ: "${existing.name}" ➔ "${name}"`);
              }
              if (sku && sku !== existing.sku) {
                diffs.push(`SKU: ${existing.sku} ➔ ${sku}`);
              }
              if (costPrice !== existingCost) {
                diffs.push(`ทุน: ${existingCost} ➔ ${costPrice}`);
              }
              if (priceLevel1 !== existingPrice1) {
                diffs.push(`ราคา 1: ${existingPrice1} ➔ ${priceLevel1}`);
              }
              if (priceLevel2 !== existingPrice2) {
                diffs.push(`ราคา 2: ${existingPrice2} ➔ ${priceLevel2}`);
              }
              if (priceLevel3 !== existingPrice3) {
                diffs.push(`ราคา 3: ${existingPrice3} ➔ ${priceLevel3}`);
              }
              if (priceLevel4 !== existingPrice4) {
                diffs.push(`ราคา 4: ${existingPrice4} ➔ ${priceLevel4}`);
              }
              if (priceLevel5 !== existingPrice5) {
                diffs.push(`ราคา 5: ${existingPrice5} ➔ ${priceLevel5}`);
              }
              if (stock !== existingStock) {
                diffs.push(`สต็อก: ${existingStock} ➔ ${stock}`);
              }
              const existingUnit = String(existing.unit || "ชิ้น").trim();
              const newUnit = String(unit || "ชิ้น").trim();
              if (existingUnit !== newUnit) {
                diffs.push(`หน่วย: ${existingUnit} ➔ ${newUnit}`);
              }

              const existingCat = String(existing.category?.name || existing.category || "ทั่วไป").trim();
              const newCat = String(categoryName || "ทั่วไป").trim();
              if (existingCat !== newCat) {
                diffs.push(`หมวด: "${existingCat}" ➔ "${newCat}"`);
              }

              changeType = diffs.length > 0 ? "CHANGED" : "UNCHANGED";
            } else {
              changeType = "NEW";
              diffs.push("สินค้าใหม่");
            }

            return {
              id: existing?.id || id,
              sku,
              name,
              barcode,
              categoryName,
              unit,
              costPrice,
              retailPrice: priceLevel1,
              priceLevel1,
              priceLevel2,
              priceLevel3,
              priceLevel4,
              priceLevel5,
              stock,
              minStockAlert,
              description,
              isExisting: !!existing,
              changeType,
              diffs,
            };
          })
          .filter((item) => item.name || item.sku);

        if (parsedItems.length === 0) {
          toast.error("ไม่พบข้อมูลสินค้าที่ถูกต้องในไฟล์");
          return;
        }

        setImportPreviewData(parsedItems);
        setImportFilterTab("all");
        setImportProgress(0);
        setIsImportPreviewOpen(true);
      } catch (err: any) {
        console.error("Failed to parse Excel:", err);
        toast.error("เกิดข้อผิดพลาดในการอ่านไฟล์ Excel กรุณาตรวจสอบรูปแบบไฟล์");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleConfirmImport = async () => {
    // Only upload changed and new items!
    const itemsToUpsert = importPreviewData.filter((i) => i.changeType !== "UNCHANGED");

    if (itemsToUpsert.length === 0) {
      toast.info("ข้อมูลสินค้าในไฟล์ตรงกับระบบทั้งหมด ไม่มีรายการที่ต้องอัพเดต");
      setIsImportPreviewOpen(false);
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    try {
      // Chunk into batches of 150 items to optimize network & memory
      const chunkSize = 150;
      let totalCreated = 0;
      let totalUpdated = 0;

      for (let i = 0; i < itemsToUpsert.length; i += chunkSize) {
        const chunk = itemsToUpsert.slice(i, i + chunkSize);
        const res: any = await api.products.bulkUpsert(chunk);
        totalCreated += (res?.created || 0);
        totalUpdated += (res?.updated || 0);
        const currentProgress = Math.min(100, Math.round(((i + chunk.length) / itemsToUpsert.length) * 100));
        setImportProgress(currentProgress);
      }

      const unchangedCount = importPreviewData.length - itemsToUpsert.length;
      toast.success(
        `✅ นำเข้าสำเร็จ: แก้ไข ${totalUpdated} รายการ, เพิ่มใหม่ ${totalCreated} รายการ (ข้ามที่ไม่เปลี่ยน ${unchangedCount} รายการ)`
      );
      setIsImportPreviewOpen(false);
      setImportPreviewData([]);
      loadData();
    } catch (err: any) {
      console.error("Import failed:", err);
      toast.error(err?.message || "ไม่สามารถนำเข้าข้อมูลสินค้าได้");
    } finally {
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const handleCSVImport = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) return;
        const rows = parseProductCSV(text);
        if (rows.length === 0) {
          toast.error("ไม่พบข้อมูลสินค้าในไฟล์ CSV");
          return;
        }
        const importedProducts = csvRowsToProducts(rows);
        const conflictingImportBarcodeKeys = getConflictingImportBarcodeKeys(importedProducts);
        let workingProducts = [...products];
        let duplicateSourceProducts = [...products];
        let canUseBackend = false;
        try {
          const latest = await api.getProducts();
          if (Array.isArray(latest)) {
            canUseBackend = true;
            duplicateSourceProducts = latest;
            workingProducts = latest;
          }
        } catch {}

        let createdCount = 0;
        let updatedCount = 0;
        let failedCount = 0;
        const failedMessages: string[] = [];

        for (const rawProduct of importedProducts) {
          const p = stripConflictingBarcodes(rawProduct, conflictingImportBarcodeKeys);
          const duplicate = findDuplicateProduct(p, duplicateSourceProducts);
          const payload = productToApiPayload(p, conflictingImportBarcodeKeys);
          try {
            if (!canUseBackend) {
              const localDuplicate = findDuplicateProduct(p, workingProducts);
              if (localDuplicate?.id) {
                updatedCount++;
                workingProducts = workingProducts.map((item) =>
                  item.id === localDuplicate.id ? { ...item, ...p, id: localDuplicate.id, stock: item.stock ?? p.stock } : item
                );
              } else {
                createdCount++;
                workingProducts = [{ ...p, id: p.id || p.sku || `prod_${Date.now()}` }, ...workingProducts];
              }
            } else if (duplicate?.id) {
              await apiFetch(`/products/${duplicate.id}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
              });
              updatedCount++;
              workingProducts = workingProducts.map((item) =>
                item.id === duplicate.id ? { ...item, ...p, id: duplicate.id, stock: item.stock ?? p.stock } : item
              );
              duplicateSourceProducts = duplicateSourceProducts.map((item) =>
                item.id === duplicate.id ? { ...item, ...p, id: duplicate.id, stock: item.stock ?? p.stock } : item
              );
            } else {
              const created = await apiFetch('/products', {
                method: 'POST',
                body: JSON.stringify(payload),
              });
              createdCount++;
              workingProducts = [created || p, ...workingProducts];
              duplicateSourceProducts = [created || p, ...duplicateSourceProducts];
            }
          } catch (err: any) {
            failedCount++;
            failedMessages.push(`${p.sku || p.name}: ${err?.message || 'import failed'}`);

            const localDuplicate = findDuplicateProduct(p, workingProducts);
            if (localDuplicate?.id) {
              updatedCount++;
              workingProducts = workingProducts.map((item) =>
                item.id === localDuplicate.id ? { ...item, ...p, id: localDuplicate.id, stock: item.stock ?? p.stock } : item
              );
            } else {
              createdCount++;
              workingProducts = [{ ...p, id: p.id || p.sku || `prod_${Date.now()}` }, ...workingProducts];
            }
          }
        }

        if (failedCount > 0) {
          saveSavedProducts(workingProducts);
        } else {
          clearSavedProducts();
        }
        await useProductStore.getState().fetchProducts();
        const storeProducts = failedCount === 0 && useProductStore.getState().products.length > 0
          ? useProductStore.getState().products
          : workingProducts;
        setProducts(storeProducts);

        if (failedCount > 0) {
          console.warn('[Products CSV import] Backend errors, local fallback applied:', failedMessages);
          toast.warning(`นำเข้าสำเร็จแบบ fallback: เพิ่ม ${createdCount} | อัปเดต ${updatedCount} | API error ${failedCount} รายการ`);
        } else if (conflictingImportBarcodeKeys.size > 0) {
          toast.warning(`นำเข้าสินค้าสำเร็จ: เพิ่มใหม่ ${createdCount} | อัปเดตสินค้าเดิม ${updatedCount} รายการ | ข้ามบาร์โค้ดซ้ำ ${conflictingImportBarcodeKeys.size} ค่า`);
        } else {
          toast.success(`นำเข้าสินค้าสำเร็จ: เพิ่มใหม่ ${createdCount} | อัปเดตสินค้าเดิม ${updatedCount} รายการ`);
        }
      } catch (err: any) {
        toast.error("เกิดข้อผิดพลาดในการอ่านไฟล์ CSV: " + err.message);
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const loadData = useCallback(() => {
    setLoading(true);
    useProductStore.getState().fetchProducts().then(async () => {
      const storeProducts = useProductStore.getState().products;
      const storeCategories = useProductStore.getState().categories;
      setProducts(storeProducts);
      setCategories(storeCategories);

      const pkgMap: Record<string, PackagingUnit[]> = {};
      const imgMap: Record<string, ProductImage[]> = {};
      (storeProducts as any[]).forEach((p: any) => {
        pkgMap[p.id] = getProductPackagingUnits(p);
        imgMap[p.id] = getProductImages(p);
      });
      setAllPackaging(pkgMap);
      setAllImages(imgMap);

      // Load real suppliers from database API
      try {
        const supps = await apiFetch('/suppliers');
        if (Array.isArray(supps)) {
          setSuppliers(supps);
        } else {
          setSuppliers([]);
        }
      } catch {
        setSuppliers([]);
      }

      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [colorFilter, setColorFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [form, setForm] = useState<ProductForm>(makeInitialForm());

  const getCategoryName = (id: string) => categories.find(c => c.id === id)?.name || "-";
  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || "-";

  const sizeOptions = useMemo(() => [...new Set((categoryFilter === "all" ? products : products.filter(p => p.categoryId === categoryFilter)).map((p: any) => p.size).filter(Boolean))] as string[], [products, categoryFilter]);
  const colorOptions = useMemo(() => [...new Set((categoryFilter === "all" ? products : products.filter(p => p.categoryId === categoryFilter)).map((p: any) => p.color).filter(Boolean))] as string[], [products, categoryFilter]);

  const filtered = useMemo(() => {
    let list = products.filter((p: any) => {
      const q = search.toLowerCase();
      const allBarcodes = [...getProductBarcodes(p), ...(allPackaging[p.id] || []).map(u => u.barcode).filter(Boolean)];
      const matchSearch = (p.name || "").toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q) || allBarcodes.some(b => normalizeKey(b).includes(q));
      const matchCat = categoryFilter === "all" || p.categoryId === categoryFilter;
      const matchSupplier = supplierFilter === "all" || 
        (p.supplierId === supplierFilter) || 
        (Array.isArray(p.barcodes) && p.barcodes.some((b: any) => b.supplierId === supplierFilter)) ||
        (Array.isArray(p.supplierEntries) && p.supplierEntries.some((s: any) => s.supplierId === supplierFilter));
      const matchSize = sizeFilter === "all" || p.size === sizeFilter;
      const matchColor = colorFilter === "all" || p.color === colorFilter;
      const stock = p.stock ?? 0;
      const lowThreshold = p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : 10;
      const matchStock = stockFilter === "all" ? true : stockFilter === "out" ? stock === 0 : stock > 0 && stock <= lowThreshold;
      return matchSearch && matchCat && matchSupplier && matchSize && matchColor && matchStock;
    });
    if (sortKey) {
      list = [...list].sort((a: any, b: any) => {
        const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
        if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
      });
    }
    return list;
  }, [products, search, categoryFilter, supplierFilter, sizeFilter, colorFilter, stockFilter, sortKey, sortDir, allPackaging]);

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  useEffect(() => {
    setCurrentPage(1);
  }, [search, categoryFilter, supplierFilter, sizeFilter, colorFilter, stockFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filtered.slice(start, start + ITEMS_PER_PAGE);
  }, [filtered, currentPage]);

  const handleSort = (key: SortKey) => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } };
  const toggleExpand = (id: string) => setExpandedRows(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const currentPageIds = useMemo(() => paginatedList.map((p: any) => p.id).filter(Boolean), [paginatedList]);
  const isCurrentPageSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedProductIds.has(id));

  const toggleSelectProduct = (id: string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectCurrentPage = () => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (isCurrentPageSelected) {
        currentPageIds.forEach((id) => next.delete(id));
      } else {
        currentPageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedProductIds(new Set());

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedProductIds);
    if (ids.length === 0) {
      toast.info("กรุณาเลือกสินค้าที่ต้องการลบ");
      return;
    }
    const ok = window.confirm(`ยืนยันลบสินค้า ${ids.length} รายการ? การลบนี้จะเอาออกจากรายการสินค้าและข้อมูลรูป/ขนาดบรรจุในเครื่อง`);
    if (!ok) return;

    setIsBulkDeleting(true);
    let apiFailed = 0;
    for (const id of ids) {
      try {
        await api.products.delete(id);
      } catch {
        apiFailed++;
      }
      try {
        localStorage.removeItem(`pkg_${id}`);
        localStorage.removeItem(`img_${id}`);
        localStorage.removeItem(`ws_${id}`);
      } catch {}
    }

    const nextProducts = products.filter((p: any) => !selectedProductIds.has(p.id));
    setProducts(nextProducts);
    saveSavedProducts(nextProducts);
    setAllPackaging((prev) => {
      const next = { ...prev };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setAllImages((prev) => {
      const next = { ...prev };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setExpandedRows((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    clearSelection();
    setIsBulkDeleting(false);

    if (apiFailed > 0) {
      toast.warning(`ลบออกจากหน้าร้านแล้ว ${ids.length} รายการ แต่ API ลบไม่สำเร็จ ${apiFailed} รายการ`);
    } else {
      toast.success(`ลบสินค้าเรียบร้อย ${ids.length} รายการ`);
    }
  };

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

  const handleOpenAdd = () => {
    setForm(makeInitialForm());
    setEditingProduct(null);
    setDialogMode("add");
  };

  const handleOpenEdit = (p: any) => {
    setEditingProduct(p);
    setForm({
      name: p.name || "", sku: p.sku || generateEAN13(), unit: p.unit || "",
      size: p.size || "", color: p.color || "", categoryId: p.categoryId || "",
      stock: (p.stock !== undefined && p.stock !== null ? p.stock : 0).toString(),
      basePrice: p.basePrice?.toString() || "",
      minStockAlert: p.minStockAlert !== undefined && p.minStockAlert !== null ? p.minStockAlert.toString() : "10",
      priceLevel1: p.priceLevel1?.toString() || "", priceLevel2: p.priceLevel2?.toString() || "",
      priceLevel3: p.priceLevel3?.toString() || "", priceLevel4: p.priceLevel4?.toString() || "",
      priceLevel5: p.priceLevel5?.toString() || "",
      barcodes: p.barcodes?.length ? p.barcodes.map((b: any) => ({ barcode: b.barcode || "", supplierId: b.supplierId || "", label: b.label || "" })) : [{ barcode: "", supplierId: "", label: "" }],
      supplierEntries: [],
      packagingUnits: getProductPackagingUnits(p),
      images: getProductImages(p),
      wholesaleSteps: getProductWholesaleSteps(p),
      defaultSellingUnitId: p.defaultSellingUnitId || "",
      isBundle: Boolean(p.isBundle),
      bundleItems: Array.isArray(p.bundleItems)
        ? p.bundleItems.map((bi: any) => ({
            childProductId: bi.childProductId || bi.productId || "",
            quantity: Number(bi.quantity) || 1,
          }))
        : [],
    });
    setDialogMode("edit");
  };

  const addBundleItem = () => {
    setForm((f) => ({
      ...f,
      bundleItems: [...f.bundleItems, { childProductId: "", quantity: 1 }],
    }));
  };

  const removeBundleItem = (idx: number) => {
    setForm((f) => ({
      ...f,
      bundleItems: f.bundleItems.filter((_, i) => i !== idx),
    }));
  };

  const updateBundleItem = (idx: number, field: string, val: any) => {
    setForm((f) => ({
      ...f,
      bundleItems: f.bundleItems.map((item, i) => (i === idx ? { ...item, [field]: val } : item)),
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("กรุณาระบุชื่อสินค้า"); return; }
    if (form.isBundle) {
      const validItems = form.bundleItems.filter((bi) => bi.childProductId);
      if (validItems.length === 0) {
        toast.error("สินค้าจัดเซ็ตต้องมีสินค้าส่วนประกอบอย่างน้อย 1 รายการ");
        return;
      }
    }
    
    let targetId = editingProduct?.id;
    if (!targetId) {
      targetId = "prod_" + Date.now();
    }

    // Stock cannot be edited from product details dialog - must be adjusted via Inventory page for stock card tracking
    const finalStock = editingProduct?.id ? (editingProduct.stock ?? 0) : 0;

    const updatedProductObj = {
      id: targetId,
      name: form.name.trim(),
      sku: form.sku.trim() || generateEAN13(),
      unit: form.unit.trim(),
      size: form.size.trim(),
      color: form.color.trim(),
      categoryId: form.categoryId,
      basePrice: form.basePrice ? parseFloat(form.basePrice) : null,
      minStockAlert: form.minStockAlert ? parseInt(form.minStockAlert) : 10,
      priceLevel1: form.priceLevel1 ? parseFloat(form.priceLevel1) : null,
      priceLevel2: form.priceLevel2 ? parseFloat(form.priceLevel2) : null,
      priceLevel3: form.priceLevel3 ? parseFloat(form.priceLevel3) : null,
      priceLevel4: form.priceLevel4 ? parseFloat(form.priceLevel4) : null,
      priceLevel5: form.priceLevel5 ? parseFloat(form.priceLevel5) : null,
      stock: finalStock,
      defaultSellingUnitId: form.defaultSellingUnitId || null,
      packagingUnits: form.packagingUnits,
      images: form.images,
      wholesalePrices: form.wholesaleSteps,
      isBundle: Boolean(form.isBundle),
      bundleItems: form.isBundle
        ? form.bundleItems
            .filter((bi) => bi.childProductId)
            .map((bi) => ({
              childProductId: bi.childProductId,
              quantity: Math.max(1, Number(bi.quantity) || 1),
            }))
        : [],
      barcodes: form.barcodes.filter(b => b.barcode.trim()).map(b => ({
        barcode: b.barcode.trim(),
        supplierId: b.supplierId || "",
        label: b.label || "",
      })),
    };

    let persistedProduct: any = null;
    try {
      const payload = productToApiPayload(updatedProductObj);
      persistedProduct = editingProduct?.id
        ? await api.products.update(editingProduct.id, payload)
        : await api.products.create(payload);
      targetId = persistedProduct?.id || targetId;
      clearSavedProducts();
    } catch (err: any) {
      toast.warning(`บันทึกลงฐานข้อมูลไม่สำเร็จ ใช้ข้อมูลสำรองในเครื่องแทน: ${err.message || 'Server error'}`);
    }

    const displayProduct = {
      ...updatedProductObj,
      ...(persistedProduct || {}),
      id: targetId,
    };

    let newProductsList: any[];
    if (editingProduct?.id) {
      newProductsList = products.map(p => p.id === editingProduct.id ? { ...p, ...displayProduct } : p);
    } else {
      newProductsList = [displayProduct, ...products];
    }

    setProducts(newProductsList);
    if (!persistedProduct) {
      saveSavedProducts(newProductsList);
    }
    await useProductStore.getState().fetchProducts();

    if (!persistedProduct) savePackaging(targetId, form.packagingUnits);
    setAllPackaging(prev => ({ ...prev, [targetId]: form.packagingUnits }));
    if (form.packagingUnits.length > 0) setExpandedRows(prev => new Set([...prev, targetId]));
    if (!persistedProduct) saveImages(targetId, form.images);
    setAllImages(prev => ({ ...prev, [targetId]: form.images }));
    if (!persistedProduct) saveWholesale(targetId, form.wholesaleSteps);

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
            <div className="space-y-1.5 sm:col-span-2 pb-3 border-b border-slate-100">
              <label className="text-sm font-bold text-slate-700 block">ประเภทสินค้า</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => updateForm("isBundle", false)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    !form.isBundle
                      ? "border-sky-500 bg-sky-50/70 text-sky-900 ring-2 ring-sky-500/20 font-bold"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Package className="w-5 h-5 shrink-0 text-sky-600" />
                  <div>
                    <div className="text-sm">สินค้าเดี่ยวทั่วไป (Standard)</div>
                    <div className="text-[11px] font-normal text-slate-400">สินค้าชิ้นเดี่ยว ตัดสต็อกตามบาร์โค้ด</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => updateForm("isBundle", true)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    form.isBundle
                      ? "border-purple-500 bg-purple-50/70 text-purple-900 ring-2 ring-purple-500/20 font-bold"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Gift className="w-5 h-5 shrink-0 text-purple-600" />
                  <div>
                    <div className="text-sm">สินค้าจัดเซ็ต / เป็นชุด (Bundle)</div>
                    <div className="text-[11px] font-normal text-slate-400">รวมสินค้าหลายชิ้น ตัดสต็อกและเคลมแยกชิ้นได้</div>
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">ชื่อสินค้า *</label>
              <Input value={form.name} onChange={e => updateForm("name", e.target.value)} className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">หน่วยย่อยสุด</label>
              <Input value={form.unit} onChange={e => updateForm("unit", e.target.value)} className="h-10 border-slate-300" />
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
              <Input value={form.size} onChange={e => updateForm("size", e.target.value)} className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">สี</label>
              <Input value={form.color} onChange={e => updateForm("color", e.target.value)} className="h-10 border-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Package className="w-4 h-4 text-sky-600" />
                จำนวนสต๊อกคงเหลือปัจจุบัน ({form.unit || 'ชิ้น'})
              </label>
              <div className="h-10 px-3.5 bg-slate-100 border border-slate-300 rounded-xl flex items-center justify-between">
                <span className="font-black text-slate-900 text-base">
                  {(editingProduct ? (editingProduct.stock ?? 0) : 0).toLocaleString()} {form.unit || 'ชิ้น'}
                </span>
                <span className="text-xs font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg flex items-center gap-1">
                  🔒 ปรับยอดที่หน้าคลังสินค้าเท่านั้น
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                ระบบล็อคไม่ให้แก้ไขจำนวนสต็อกตรงนี้ เพื่อป้องกันข้อมูลสต็อกการ์ดคลาดเคลื่อน กรุณาปรับยอดที่เมนู <Link href="/inventory" className="text-indigo-600 font-bold underline hover:text-indigo-800">คลังสินค้า (Inventory)</Link>
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                จำนวนสต๊อกเตือนใกล้หมด ({form.unit || 'ชิ้น'})
              </label>
              <Input
                type="number"
                min="0"
                value={form.minStockAlert}
                onChange={e => updateForm("minStockAlert", e.target.value)}
                className="h-10 border-slate-300 font-bold text-slate-800"
              />
              <p className="text-xs text-slate-400">เมื่อสต๊อกเหลือน้อยกว่าหรือเท่ากับจำนวนนี้ ระบบจะแสดงสถานะใกล้หมด</p>
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

        {/* รายการสินค้าในชุด (Bundle Items) */}
        {form.isBundle && (
          <section className="rounded-xl border-2 border-purple-200 bg-purple-50/20 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-purple-100">
              <div className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-purple-600 shrink-0" />
                <div>
                  <h3 className="font-bold text-slate-900 text-base">รายการสินค้าในชุด (Bundle Items)</h3>
                  <p className="text-xs text-slate-500">เลือกสินค้าและจำนวนที่จะรวมอยู่ในชุดนี้ เมื่อขายจะตัดสต็อกและเคลมแยกชิ้นตามรายการนี้</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs border-purple-400 bg-white text-purple-700 hover:bg-purple-50 font-bold shadow-2xs cursor-pointer"
                onClick={addBundleItem}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> เพิ่มสินค้าเข้าชุด
              </Button>
            </div>

            {form.bundleItems.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-purple-200 bg-white/70 py-6 text-center text-sm text-slate-400">
                <Gift className="w-8 h-8 mx-auto text-purple-300 mb-2" />
                <p className="font-medium text-slate-600">ยังไม่มีรายการสินค้าในชุด</p>
                <p className="text-xs text-slate-400 mt-0.5">คลิก "เพิ่มสินค้าเข้าชุด" เพื่อเลือกสินค้ามารวมเป็นเซ็ต</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {form.bundleItems.map((bi, idx) => {
                  const child = products.find((p) => p.id === bi.childProductId);
                  const childPrice = child ? Number(child.priceLevel1 ?? child.basePrice ?? 0) : 0;
                  const childStock = child ? Number(child.stock ?? 0) : 0;
                  const itemLineTotal = childPrice * (Number(bi.quantity) || 1);

                  return (
                    <div
                      key={idx}
                      className="bg-white p-3 rounded-xl border border-purple-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center gap-3"
                    >
                      <div className="flex-1 space-y-1 min-w-[200px]">
                        <label className="text-xs font-semibold text-slate-600">สินค้าส่วนประกอบ #{idx + 1}</label>
                        <select
                          value={bi.childProductId}
                          onChange={(e) => updateBundleItem(idx, "childProductId", e.target.value)}
                          className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-purple-500 font-medium text-slate-800"
                        >
                          <option value="">-- เลือกสินค้า --</option>
                          {products
                            .filter((p) => p.id !== editingProduct?.id && !p.isBundle)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.sku}) - สต็อก: {p.stock ?? 0} {p.unit || "ชิ้น"}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="w-32 space-y-1">
                        <label className="text-xs font-semibold text-slate-600">จำนวนใน 1 ชุด</label>
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            min="1"
                            value={bi.quantity}
                            onChange={(e) => updateBundleItem(idx, "quantity", e.target.value)}
                            className="h-9 border-slate-300 font-bold text-center"
                          />
                          <span className="text-xs text-slate-500 shrink-0">{child?.unit || "ชิ้น"}</span>
                        </div>
                      </div>

                      <div className="text-right sm:w-36 space-y-0.5">
                        <div className="text-[11px] text-slate-400">ราคาปกติ/ชิ้น: {formatCurrency(childPrice)}</div>
                        <div className="text-xs font-bold text-slate-700">
                          รวม {formatCurrency(itemLineTotal)}
                        </div>
                        <div className="text-[10px] text-slate-400">สต็อกคงเหลือ: {childStock}</div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-rose-500 hover:bg-rose-50 self-end sm:self-center cursor-pointer"
                        onClick={() => removeBundleItem(idx)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}

                {/* Summary card for Bundle */}
                {(() => {
                  const totalComponentPrice = form.bundleItems.reduce((sum, bi) => {
                    const child = products.find((p) => p.id === bi.childProductId);
                    const pPrice = child ? Number(child.priceLevel1 ?? child.basePrice ?? 0) : 0;
                    return sum + pPrice * (Number(bi.quantity) || 1);
                  }, 0);

                  const totalComponentCost = form.bundleItems.reduce((sum, bi) => {
                    const child = products.find((p) => p.id === bi.childProductId);
                    const pCost = child ? Number(child.costPrice ?? child.basePrice ?? 0) : 0;
                    return sum + pCost * (Number(bi.quantity) || 1);
                  }, 0);

                  const maxPossibleSets = form.bundleItems.length > 0 && form.bundleItems.every(bi => bi.childProductId)
                    ? Math.min(
                        ...form.bundleItems.map((bi) => {
                          const child = products.find((p) => p.id === bi.childProductId);
                          const childStock = child ? Number(child.stock ?? 0) : 0;
                          return Math.floor(childStock / Math.max(1, Number(bi.quantity) || 1));
                        })
                      )
                    : 0;

                  return (
                    <div className="p-3.5 bg-purple-100/60 rounded-xl border border-purple-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-slate-500 block">ราคาสินค้าปกติรวมกัน:</span>
                        <span className="text-sm font-bold text-slate-800">{formatCurrency(totalComponentPrice)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">ต้นทุนสินค้ารวมกัน:</span>
                        <span className="text-sm font-bold text-slate-800">{formatCurrency(totalComponentCost)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">สต็อกชุดที่จัดได้สูงสุด:</span>
                        <span className={`text-sm font-black ${maxPossibleSets > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                          {maxPossibleSets.toLocaleString()} ชุด
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </section>
        )}

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
                  <Input value={b.barcode} onChange={e => updateBarcode(i, "barcode", e.target.value)} className="h-9 border-slate-300 font-mono text-sm" />
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
                  <Input value={b.label || ""} onChange={e => updateBarcode(i, "label", e.target.value)} className="h-9 border-slate-300 text-sm" />
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
                    <Input type="number" min="0" step="0.01" value={entry.lastCost} onChange={e => updateSupplierEntry(i, "lastCost", e.target.value)} className="h-9 border-slate-300 text-sm text-right" />
                  </div>
                  <div className="space-y-1">
                    {i === 0 && <label className="text-xs font-medium text-slate-500">หมายเหตุ</label>}
                    <Input value={entry.notes} onChange={e => updateSupplierEntry(i, "notes", e.target.value)} className="h-9 border-slate-300 text-sm" />
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
              <Input type="number" min="0" step="0.01" value={form.basePrice} onChange={e => updateForm("basePrice", e.target.value)} className="h-10 border-slate-300 text-right max-w-[160px]" />
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
                <Input type="number" min="0" step="0.01" value={(form as any)[`priceLevel${n}`]} onChange={e => updateForm(`priceLevel${n}` as any, e.target.value)} className="h-9 border-slate-300 text-right text-sm" />
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
              <p>ยังไม่มีหน่วยบรรจุ — คลิก "เพิ่มหน่วยบรรจุ" เพื่อเพิ่ม</p>
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
                          <Input value={unit.name} onChange={e => updatePackagingUnit(idx, "name", e.target.value)} className="h-9 border-slate-300 bg-white text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-600">จำนวน {prevName} ต่อ 1 {unit.name || "หน่วยนี้"}</label>
                          <Input type="number" min="1" value={unit.qtyPerPrev} onChange={e => updatePackagingUnit(idx, "qtyPerPrev", e.target.value)} className="h-9 border-slate-300 bg-white text-sm text-right" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-600">บาร์โค้ดหน่วยนี้</label>
                          <div className="flex gap-1">
                            <Input value={unit.barcode} onChange={e => updatePackagingUnit(idx, "barcode", e.target.value)} className="h-9 border-slate-300 bg-white text-sm font-mono flex-1" />
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
                              <Input type="number" min="0" step="0.01" value={(unit as any)[`priceLevel${n}`]} onChange={e => updatePackagingUnit(idx, `priceLevel${n}` as any, e.target.value)} className="h-8 border-slate-300 bg-white text-xs text-right" />
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

          {/* Default Selling Unit Picker */}
          <div className="mt-4 pt-4 border-t border-slate-200">
            <label className="text-sm font-bold text-slate-900 block mb-1">
              🎯 หน่วยเริ่มต้นในการขาย (Default Selling Unit)
            </label>
            <p className="text-xs text-slate-500 mb-2">
              เลือกหน่วยที่จะถูกเลือกเป็นค่าเริ่มต้นเมื่อพิมพ์ค้นหาในหน้าขาย POS (หากไม่ระบุ ระบบจะใช้หน่วยย่อยสุดเป็นค่าเริ่มต้น)
            </p>
            <select
              value={form.defaultSellingUnitId || ""}
              onChange={e => updateForm("defaultSellingUnitId", e.target.value)}
              className="h-10 w-full sm:w-80 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-primary"
            >
              <option value="">หน่วยย่อยสุด ({form.unit || "ชิ้น"}) — ค่าเริ่มต้นระบบ</option>
              {form.packagingUnits.map((u, i) => (
                <option key={i} value={u.name}>
                  {u.name} (1 {u.name} = {packagingMultipliers[i]} {form.unit || "หน่วยย่อย"})
                </option>
              ))}
            </select>
          </div>
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
                    <Input type="number" min="0" value={step.minQuantity} onChange={e => updateWholesale(idx, "minQuantity", e.target.value)} className="h-8 border-slate-300 text-right text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">ราคา/ชิ้น</label>
                    <Input type="number" min="0" step="0.01" value={step.unitPrice} onChange={e => updateWholesale(idx, "unitPrice", e.target.value)} className="h-8 border-slate-300 text-right text-sm" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  // ─── Main render ───────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <Package className="w-6 h-6 text-sky-500" /> จัดการสินค้า (Products)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">จัดการรายการสินค้า ราคาขาย ขนาดบรรจุ บาร์โค้ด และนำเข้าข้อมูลสินค้า</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Hidden File Input for Excel / CSV */}
          <input
            type="file"
            ref={excelInputRef}
            accept=".xlsx, .xls, .csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelectForImport(file);
              e.target.value = "";
            }}
          />

          {/* Export Excel Button */}
          <Button
            variant="outline"
            onClick={handleExportExcel}
            className="h-10 border-emerald-300 bg-emerald-50/60 font-bold text-emerald-800 hover:bg-emerald-100 hover:border-emerald-400 shadow-2xs cursor-pointer"
            title="ส่งออกรายการสินค้าทั้งหมดเป็นไฟล์ Excel (.xlsx) เพื่อแก้ไขราคา บาร์โค้ด ชื่อ หรือสต็อก"
          >
            <Download className="w-4 h-4 mr-1.5 text-emerald-700" /> ส่งออก Excel (.xlsx)
          </Button>

          {/* Import Excel / CSV Button */}
          <Button
            variant="outline"
            onClick={() => excelInputRef.current?.click()}
            className="h-10 border-indigo-300 bg-indigo-50/60 font-bold text-indigo-800 hover:bg-indigo-100 hover:border-indigo-400 shadow-2xs cursor-pointer"
            title="นำเข้าไฟล์ Excel หรือ CSV เพื่ออัพเดตและเพิ่มสินค้าเป็นชุด"
          >
            <Upload className="w-4 h-4 mr-1.5 text-indigo-700" /> นำเข้า Excel / CSV
          </Button>

          {/* Download Template Excel Button */}
          <Button
            variant="outline"
            onClick={handleDownloadExcelTemplate}
            className="h-10 border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer"
            title="ดาวน์โหลดไฟล์แม่แบบ Excel สำหรับกรอกข้อมูลสินค้าเพื่อนำเข้า"
          >
            <FileSpreadsheet className="w-4 h-4 mr-1.5 text-sky-600" /> โหลด Template
          </Button>

          <Link href="/categories" className="w-full sm:w-auto">
            <Button variant="outline" className="h-10 w-full border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs">
              <FolderTree className="w-4 h-4 mr-1.5 text-slate-700" /> จัดการหมวดหมู่
            </Button>
          </Link>

          <Button className="h-10 w-full bg-indigo-600 px-5 font-bold text-white hover:bg-indigo-700 shadow-2xs cursor-pointer sm:w-auto" onClick={handleOpenAdd}>
            <Plus className="w-4 h-4 mr-1.5" /> เพิ่มสินค้าใหม่
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
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary">
          <option value="all">🏢 ทุกผู้จำหน่าย</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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

      {selectedProductIds.size > 0 && (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-bold text-rose-900">
            เลือกสินค้าแล้ว {selectedProductIds.size.toLocaleString()} รายการ
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              onClick={clearSelection}
            >
              ยกเลิกเลือก
            </Button>
            <Button
              type="button"
              className="h-9 bg-rose-600 text-white hover:bg-rose-700"
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {isBulkDeleting ? "กำลังลบ..." : "ลบรายการที่เลือก"}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="w-10 text-center">
                  <div className="flex justify-center">
                    <Checkbox
                      checked={isCurrentPageSelected}
                      onCheckedChange={toggleSelectCurrentPage}
                      aria-label="เลือกสินค้าทั้งหมดในหน้านี้"
                    />
                  </div>
                </TableHead>
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
                <TableRow><TableCell colSpan={15} className="text-center h-32 text-slate-500">กำลังโหลด...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={15} className="text-center h-40 text-slate-400">ไม่พบสินค้าที่ตรงกับเงื่อนไข</TableCell></TableRow>
              ) : paginatedList.map((p: any) => {
                const stock = p.stock ?? 0;
                const lowThreshold = p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : 10;
                const isNegativeStock = stock < 0;
                const isLowStock = stock > 0 && stock <= lowThreshold;
                const stockClass = isNegativeStock
                  ? "bg-rose-600 text-white border-rose-700 font-extrabold shadow-2xs"
                  : stock === 0
                  ? "bg-rose-50 text-rose-600 border-rose-200 font-bold"
                  : isLowStock
                  ? "bg-amber-100 text-amber-800 border-amber-300 font-bold"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200";
                const pkgUnits = allPackaging[p.id] || [];
                const pkgMults = computeMultipliers(pkgUnits);
                const isExpanded = expandedRows.has(p.id);
                const prodImages = allImages[p.id] || [];
                const coverImg = prodImages.find(img => img.isCover)?.dataUrl || prodImages[0]?.dataUrl || p.imageUrl || null;
                const displayBarcodes = getProductBarcodes(p);

                return (
                  <Fragment key={p.id}>
                    <TableRow className={`border-slate-100 hover:bg-slate-50 ${isExpanded ? "bg-sky-50/20" : ""}`}>
                      <TableCell className="text-center align-middle">
                        <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                          checked={selectedProductIds.has(p.id)}
                            onCheckedChange={() => toggleSelectProduct(p.id)}
                          aria-label={`เลือกสินค้า ${p.name}`}
                        />
                        </div>
                      </TableCell>
                      <TableCell className="text-center p-0 pl-2">
                        {pkgUnits.length > 0 ? (
                          <button onClick={() => toggleExpand(p.id)} className="w-7 h-7 rounded flex items-center justify-center text-sky-500 hover:bg-sky-100 transition-colors">
                            <ChevronRight className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`} />
                          </button>
                        ) : <div className="w-7 h-7" />}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col gap-1 items-center">
                          {displayBarcodes.slice(0, 3).map((barcode: string, bi: number) => (
                            <div key={bi} className="inline-flex items-center font-mono text-xs text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                              <span>{barcode}</span>
                            </div>
                          ))}
                          {displayBarcodes.length > 3 && <span className="text-xs text-slate-400">+{displayBarcodes.length - 3} อื่นๆ</span>}
                          {displayBarcodes.length === 0 && <span className="text-slate-300 text-xs">—</span>}
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
                              {p.isBundle && (
                                <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded font-bold shrink-0">
                                  🎁 ชุด ({p.bundleItems?.length || 0} ชิ้น)
                                </span>
                              )}
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
                      <TableCell className="text-right whitespace-nowrap">
                        <Badge variant="outline" className={stockClass}>
                          {isNegativeStock && <span className="mr-1 text-xs">🔻</span>}
                          {isLowStock && <span className="mr-1 text-xs">⚠️</span>}
                          {isNegativeStock ? stock : stock === 0 ? "หมด" : stock}
                        </Badge>
                      </TableCell>
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
                          <TableCell className="py-2" />
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
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Navigation */}
        {filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6">
            <div className="text-xs text-slate-500 font-medium">
              แสดง <b className="text-slate-800">{Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filtered.length)}</b> - <b className="text-slate-800">{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)}</b> จากทั้งหมด <b className="text-slate-800">{filtered.length}</b> รายการ
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="h-8 px-3 text-xs font-semibold border-slate-300"
              >
                ‹ ก่อนหน้า
              </Button>
              <div className="flex items-center gap-1 px-2">
                <span className="text-xs font-bold text-slate-700">หน้า {currentPage}</span>
                <span className="text-xs text-slate-400">/ {totalPages}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="h-8 px-3 text-xs font-semibold border-slate-300"
              >
                ถัดไป ›
              </Button>
            </div>
          </div>
        )}
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
          {/* ✅ Footer มี padding ด้านล่าง pb-7 เพื่อเว้นระยะห่างขอบล่างกับปุ่มไม่ให้ชิดกัน */}
          <DialogFooter className="border-t border-slate-200 bg-slate-50 px-6 pt-5 pb-7 shrink-0 flex-row gap-3 justify-end">
            <Button variant="outline" className="border-slate-300 text-slate-600 px-6 h-10 font-medium" onClick={() => setDialogMode(null)}>ยกเลิก</Button>
            <Button className={`px-8 h-10 font-bold ${dialogMode === "edit" ? "bg-sky-500 text-white hover:bg-sky-600" : "bg-primary text-white hover:bg-primary/90"}`} onClick={handleSave}>
              {dialogMode === "edit" ? "บันทึกการแก้ไข" : "บันทึกสินค้า"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── EXCEL IMPORT PREVIEW DIALOG (SMART SELECTIVE DIFF & CHUNKING) ─── */}
      <Dialog open={isImportPreviewOpen} onOpenChange={setIsImportPreviewOpen}>
        <DialogContent className="flex flex-col bg-white p-0 text-slate-900 sm:max-w-5xl max-h-[88vh] overflow-hidden gap-0 rounded-2xl shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-6 py-4 pr-14 shrink-0 bg-slate-50/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <DialogTitle className="flex items-center gap-2 text-lg font-black text-slate-900">
                <FileSpreadsheet className="h-5 w-5 text-indigo-600" />
                <span>ตรวจสอบข้อมูลก่อนนำเข้า (Smart Selective Import & Diff)</span>
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge className="bg-sky-100 text-sky-800 border-sky-300 font-bold">
                  🔵 แก้ไข {importPreviewData.filter((i) => i.changeType === "CHANGED").length} รายการ
                </Badge>
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold">
                  🟢 เพิ่มใหม่ {importPreviewData.filter((i) => i.changeType === "NEW").length} รายการ
                </Badge>
                <Badge className="bg-slate-100 text-slate-700 border-slate-300 font-bold">
                  ⚪ ไม่เปลี่ยน {importPreviewData.filter((i) => i.changeType === "UNCHANGED").length} รายการ (ข้าม)
                </Badge>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Selective diff summary banner */}
            <div className="bg-indigo-50/70 p-3.5 rounded-xl border border-indigo-200/90 text-xs text-indigo-950 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-sm text-indigo-950">
                    ตรวจพบรายการที่มีการเปลี่ยนแปลง/เพิ่มใหม่:{" "}
                    <span className="text-indigo-700 font-black">
                      {importPreviewData.filter((i) => i.changeType !== "UNCHANGED").length}
                    </span>{" "}
                    จากทั้งหมด {importPreviewData.length} รายการ
                  </p>
                  <p className="text-slate-600 mt-0.5">
                    💡 ระบบจะส่งเฉพาะรายการที่มีการแก้ไขหรือเพิ่มใหม่เท่านั้นไปยังฐานข้อมูล (ข้าม {importPreviewData.filter((i) => i.changeType === "UNCHANGED").length} รายการที่ตรงกับของเดิม) เพื่อประหยัดทรัพยากรและทำงานได้รวดเร็วสูงสุด
                  </p>
                </div>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 w-fit text-xs font-bold">
              {[
                { id: "all", label: `ทั้งหมด (${importPreviewData.length})` },
                { id: "changed", label: `🔵 มีการแก้ไข (${importPreviewData.filter((i) => i.changeType === "CHANGED").length})` },
                { id: "new", label: `🟢 เพิ่มใหม่ (${importPreviewData.filter((i) => i.changeType === "NEW").length})` },
                { id: "unchanged", label: `⚪ ไม่เปลี่ยน (${importPreviewData.filter((i) => i.changeType === "UNCHANGED").length})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setImportFilterTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    importFilterTab === tab.id
                      ? "bg-white text-indigo-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Table Preview */}
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <Table>
                <TableHeader className="bg-slate-100">
                  <TableRow className="text-xs">
                    <TableHead className="w-12 text-center font-bold">ลำดับ</TableHead>
                    <TableHead className="w-28 font-bold">สถานะ</TableHead>
                    <TableHead className="w-32 font-bold">รหัส (SKU)</TableHead>
                    <TableHead className="font-bold">ชื่อสินค้า</TableHead>
                    <TableHead className="w-24 font-bold text-right text-slate-700">ราคาทุน</TableHead>
                    <TableHead className="w-24 font-bold text-right text-emerald-700">ราคาขาย 1</TableHead>
                    <TableHead className="w-20 font-bold text-center">สต็อก</TableHead>
                    <TableHead className="font-bold">รายการที่เปลี่ยนแปลง</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-xs font-medium">
                  {importPreviewData
                    .filter((row) => {
                      if (importFilterTab === "changed") return row.changeType === "CHANGED";
                      if (importFilterTab === "new") return row.changeType === "NEW";
                      if (importFilterTab === "unchanged") return row.changeType === "UNCHANGED";
                      return true;
                    })
                    .slice(0, 30)
                    .map((row, idx) => (
                      <TableRow key={idx} className="hover:bg-slate-50/80">
                        <TableCell className="text-center font-mono text-slate-500">{idx + 1}</TableCell>
                        <TableCell>
                          {row.changeType === "CHANGED" ? (
                            <Badge className="bg-sky-50 text-sky-700 border-sky-200 text-[10.5px] font-bold">
                              🔵 แก้ไข
                            </Badge>
                          ) : row.changeType === "NEW" ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10.5px] font-bold">
                              🟢 เพิ่มใหม่
                            </Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-500 border-slate-200 text-[10.5px] font-medium">
                              ⚪ ไม่เปลี่ยน
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-slate-700 font-bold">{row.sku || "-"}</TableCell>
                        <TableCell className="font-bold text-slate-900 truncate max-w-[200px]">
                          {row.name}
                          {row.barcode && <span className="text-[10.5px] text-slate-400 block font-mono font-normal">บาร์โค้ด: {row.barcode}</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-slate-600">{formatCurrency(row.costPrice)}</TableCell>
                        <TableCell className="text-right font-mono text-emerald-700 font-bold">{formatCurrency(row.priceLevel1)}</TableCell>
                        <TableCell className="text-center font-mono text-slate-800">{row.stock} {row.unit}</TableCell>
                        <TableCell className="text-[11px] text-indigo-700 font-medium">
                          {row.diffs?.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {row.diffs.map((d: string, di: number) => (
                                <span key={di} className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-[10.5px]">
                                  {d}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-slate-50 px-6 pt-4 pb-7 shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-500 font-medium w-full sm:w-auto">
              {isImporting && importProgress > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-32 bg-slate-200 rounded-full h-2 overflow-hidden">
                    <div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${importProgress}%` }} />
                  </div>
                  <span className="font-bold text-indigo-700 font-mono">{importProgress}%</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsImportPreviewOpen(false)}
                disabled={isImporting}
                className="text-xs font-bold rounded-xl h-10 px-5 cursor-pointer border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                onClick={handleConfirmImport}
                disabled={isImporting || importPreviewData.filter((i) => i.changeType !== "UNCHANGED").length === 0}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl h-10 px-6 gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>กำลังอัพเดต ({importProgress}%)...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>
                      ยืนยันอัพเดตเฉพาะรายการที่เปลี่ยน ({importPreviewData.filter((i) => i.changeType !== "UNCHANGED").length} รายการ)
                    </span>
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
