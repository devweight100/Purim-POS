"use client";

import Link from "next/link";
import { AlertTriangle, Gift, Package, RefreshCw, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateEAN13 } from "../product-helpers";
import type { CategoryOption, ProductForm, UpdateForm } from "../types";

/** Product type (standard / bundle), name, unit, category, size, color, stock (read only), low-stock alert, EAN-13 SKU. */
export function ProductDetailsSection({ form, updateForm, categories, currentStock }: {
  form: ProductForm;
  updateForm: UpdateForm;
  categories: CategoryOption[];
  /** stock of the product being edited (0 for a new one) */
  currentStock: number;
}) {
  return (
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
              {currentStock.toLocaleString()} {form.unit || 'ชิ้น'}
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
  );
}
