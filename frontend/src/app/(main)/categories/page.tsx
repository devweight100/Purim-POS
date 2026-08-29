"use client";

import { useEffect, useState, useMemo } from "react";
import { api, apiFetch } from "@/lib/api";
import { loadCategories, saveCategories, CategoryItem } from "@/lib/category-storage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FolderTree, Plus, Pencil, Trash2, Search, Tag, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";

const emojiPresets = ["🥤", "🥬", "🍿", "🏠", "✏️", "📦", "👕", "💊", "⚡", "📱", "🚗", "🍔", "🍺", "🎨", "🐾", "🛍️"];

const colorPresets = [
  { label: "ฟ้า", hex: "#3b82f6", bg: "bg-blue-500" },
  { label: "เขียว", hex: "#22c55e", bg: "bg-green-500" },
  { label: "ส้ม", hex: "#f59e0b", bg: "bg-amber-500" },
  { label: "ชมพู", hex: "#ec4899", bg: "bg-pink-500" },
  { label: "ม่วง", hex: "#8b5cf6", bg: "bg-purple-500" },
  { label: "แดง", hex: "#f43f5e", bg: "bg-rose-500" },
  { label: "ฟ้าคราม", hex: "#06b6d4", bg: "bg-cyan-500" },
  { label: "เทา", hex: "#64748b", bg: "bg-slate-500" },
];

export default function CategoriesPage() {
  const [categories, setCategoriesState] = useState<CategoryItem[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Dialog state
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editingCategory, setEditingCategory] = useState<CategoryItem | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📦");
  const [color, setColor] = useState("#3b82f6");

  // Delete confirm dialog
  const [deletingCat, setDeletingCat] = useState<CategoryItem | null>(null);

  useEffect(() => {
    Promise.all([
      api.getProducts().catch(() => []),
    ]).then(([prods]) => {
      setProducts(prods || []);
      setCategoriesState(loadCategories());
      setLoading(false);
    });
  }, []);

  const productCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    products.forEach(p => {
      if (p.categoryId) {
        map[p.categoryId] = (map[p.categoryId] || 0) + 1;
      }
    });
    return map;
  }, [products]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    return categories.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  }, [categories, search]);

  const updateAndSaveCategories = (next: CategoryItem[]) => {
    setCategoriesState(next);
    saveCategories(next);
  };

  const handleOpenAdd = () => {
    setName("");
    setIcon("📦");
    setColor("#3b82f6");
    setEditingCategory(null);
    setDialogMode("add");
  };

  const handleOpenEdit = (cat: CategoryItem) => {
    setEditingCategory(cat);
    setName(cat.name);
    setIcon(cat.icon || "📦");
    setColor(cat.color || "#3b82f6");
    setDialogMode("edit");
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("กรุณาระบุชื่อหมวดหมู่");
      return;
    }

    if (dialogMode === "add") {
      const newCat: CategoryItem = {
        id: "cat_" + Date.now(),
        name: name.trim(),
        icon,
        color,
      };
      updateAndSaveCategories([...categories, newCat]);
      toast.success(`เพิ่มหมวดหมู่ "${newCat.name}" เรียบร้อยแล้ว`);
    } else if (dialogMode === "edit" && editingCategory) {
      const updated = categories.map(c =>
        c.id === editingCategory.id ? { ...c, name: name.trim(), icon, color } : c
      );
      updateAndSaveCategories(updated);
      toast.success(`บันทึกการแก้ไขหมวดหมู่ "${name}" เรียบร้อยแล้ว`);
    }

    setDialogMode(null);
  };

  const handleDelete = () => {
    if (!deletingCat) return;
    const next = categories.filter(c => c.id !== deletingCat.id);
    updateAndSaveCategories(next);
    toast.success(`ลบหมวดหมู่ "${deletingCat.name}" เรียบร้อยแล้ว`);
    setDeletingCat(null);
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
            <FolderTree className="w-6 h-6 text-sky-500" /> จัดการหมวดหมู่สินค้า (Categories)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">เพิ่ม แก้ไข หรือลบหมวดหมู่สำหรับจัดกลุ่มสินค้าในร้าน</p>
        </div>
        <Button className="bg-sky-500 hover:bg-sky-600 text-white font-bold h-10 px-5 text-xs shadow-sm rounded-xl" onClick={handleOpenAdd}>
          <Plus className="w-4 h-4 mr-1.5" /> เพิ่มหมวดหมู่ใหม่
        </Button>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap gap-3 items-center justify-between">
        <div className="relative min-w-[240px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="ค้นหาชื่อหมวดหมู่..."
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

        <div className="text-sm text-slate-500">
          หมวดหมู่ทั้งหมด <b className="text-slate-900">{categories.length}</b> หมวด
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="w-16 text-center text-slate-500">ไอคอน</TableHead>
                <TableHead className="text-slate-500">ชื่อหมวดหมู่</TableHead>
                <TableHead className="text-slate-500 text-center">สีหมวดหมู่</TableHead>
                <TableHead className="text-slate-500 text-center">จำนวนสินค้า</TableHead>
                <TableHead className="text-slate-500 text-center w-32">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-32 text-slate-500">กำลังโหลด...</TableCell>
                </TableRow>
              ) : filteredCategories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-36 text-slate-400">ไม่พบหมวดหมู่สินค้า</TableCell>
                </TableRow>
              ) : (
                filteredCategories.map(cat => {
                  const count = productCountMap[cat.id] || 0;
                  return (
                    <TableRow key={cat.id} className="border-slate-100 hover:bg-slate-50">
                      <TableCell className="text-center">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-xl mx-auto shadow-sm">
                          {cat.icon || "📦"}
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold text-slate-900 text-base">
                        {cat.name}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium" style={{ backgroundColor: `${cat.color}15`, borderColor: `${cat.color}40`, color: cat.color }}>
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                          {cat.color}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 px-3 py-1 font-semibold">
                          {count} รายการ
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-400 hover:text-sky-600 hover:bg-sky-50"
                            onClick={() => handleOpenEdit(cat)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                            onClick={() => setDeletingCat(cat)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={open => { if (!open) setDialogMode(null); }}>
        <DialogContent className="bg-white p-6 text-slate-900 sm:max-w-md border-slate-200">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              {dialogMode === "edit" ? <><Pencil className="w-5 h-5 text-primary" /> แก้ไขหมวดหมู่</> : <><Plus className="w-5 h-5 text-primary" /> เพิ่มหมวดหมู่ใหม่</>}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">ชื่อหมวดหมู่ *</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="เช่น เครื่องดื่ม, ของใช้ในบ้าน"
                className="h-10 border-slate-300 bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">ไอคอนหมวดหมู่</label>
              <div className="flex items-center gap-2 mb-2">
                <Input
                  value={icon}
                  onChange={e => setIcon(e.target.value)}
                  className="h-10 w-16 text-center text-xl border-slate-300 bg-white shrink-0"
                />
                <span className="text-xs text-slate-400">เลือกจาก Preset หรือพิมพ์ emoji เอง</span>
              </div>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200">
                {emojiPresets.map((e, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setIcon(e)}
                    className={`w-8 h-8 rounded text-lg flex items-center justify-center hover:bg-white transition-colors ${icon === e ? "bg-white ring-2 ring-primary shadow-sm" : ""}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">ธีมสีหมวดหมู่</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {colorPresets.map(c => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setColor(c.hex)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${color === c.hex ? "ring-2 ring-primary ring-offset-2 font-bold shadow-sm" : "hover:bg-slate-50"}`}
                    style={{ borderColor: c.hex, color: c.hex }}
                  >
                    <div className={`w-3 h-3 rounded-full ${c.bg}`} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6 flex-row gap-2 justify-end">
            <Button variant="outline" className="border-slate-300 text-slate-600" onClick={() => setDialogMode(null)}>ยกเลิก</Button>
            <Button className={dialogMode === "edit" ? "bg-sky-500 text-white hover:bg-sky-600" : "bg-primary text-white hover:bg-primary/90"} onClick={handleSave}>
              {dialogMode === "edit" ? "บันทึกการแก้ไข" : "บันทึกหมวดหมู่"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deletingCat !== null} onOpenChange={open => { if (!open) setDeletingCat(null); }}>
        <DialogContent className="bg-white p-6 text-slate-900 sm:max-w-md border-slate-200">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-red-600">
              <AlertTriangle className="w-5 h-5 text-red-500" /> ยืนยันการลบหมวดหมู่
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 text-sm text-slate-600 space-y-2">
            <p>คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่ <b className="text-slate-900">{deletingCat?.name}</b>?</p>
            {deletingCat && (productCountMap[deletingCat.id] || 0) > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                ⚠️ มีสินค้า <b>{productCountMap[deletingCat.id]}</b> รายการอยู่ในหมวดหมู่นี้ การลบจะทำให้สินค้าดังกล่าวไม่มีหมวดหมู่ระบุ
              </div>
            )}
          </div>

          <DialogFooter className="mt-4 flex-row gap-2 justify-end">
            <Button variant="outline" className="border-slate-300" onClick={() => setDeletingCat(null)}>ยกเลิก</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete}>ยืนยันลบหมวดหมู่</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
