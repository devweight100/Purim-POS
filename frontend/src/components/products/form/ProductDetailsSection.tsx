"use client";

import { AlertTriangle, Gift, Package, Tags } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NAME_LIMITS } from "@shared/product-names";
import type { CategoryOption, ProductForm, UpdateForm } from "../types";
import { FormSection } from "./FormSection";

/**
 * "ข้อมูลเพิ่มเติม" first section: unit, category, low-stock alert, manufacturer name, size, color and the product type
 * (standard / bundle). Name, SKU and stock are at the top of the form (MainFieldsSection).
 */
export function ProductDetailsSection({ form, updateForm, categories, onCreateCategory }: {
  form: ProductForm;
  updateForm: UpdateForm;
  categories: CategoryOption[];
  /** opens the "new category" dialog; omitted when the user may not create categories */
  onCreateCategory?: () => void;
}) {
  return (
    <FormSection id="details" icon={<Tags />} title="หน่วย หมวดหมู่ และรายละเอียด" testId="product-details-section">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="product-form-unit" className="text-sm font-medium text-slate-700">หน่วยย่อยสุด</label>
          <Input id="product-form-unit" placeholder="เช่น ชิ้น ถุง กล่อง" value={form.unit} onChange={e => updateForm("unit", e.target.value)} className="border-slate-300" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-btn">
            <label htmlFor="product-form-category" className="text-sm font-medium text-slate-700">หมวดหมู่</label>
            {onCreateCategory && (
              <button type="button" onClick={onCreateCategory} className="rounded text-xs font-bold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-sky-400 outline-none">
                + สร้างหมวดหมู่
              </button>
            )}
          </div>
          <select id="product-form-category" value={form.categoryId} onChange={e => updateForm("categoryId", e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary">
            <option value="">{categories.length === 0 ? "ยังไม่มีหมวดหมู่ (กด + สร้างหมวดหมู่)" : "เลือกหมวดหมู่"}</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="product-form-min-stock" className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            จำนวนสต๊อกเตือนใกล้หมด ({form.unit || 'ชิ้น'})
          </label>
          <Input
            id="product-form-min-stock"
            type="number"
            min="0"
            value={form.minStockAlert}
            onChange={e => updateForm("minStockAlert", e.target.value)}
            className="border-slate-300 text-slate-800"
          />
          <p className="text-xs text-slate-400">เมื่อสต๊อกเหลือน้อยกว่าหรือเท่ากับจำนวนนี้ ระบบจะแสดงสถานะใกล้หมด</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">ขนาด</label>
          <Input value={form.size} onChange={e => updateForm("size", e.target.value)} className="border-slate-300" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">สี</label>
          <Input value={form.color} onChange={e => updateForm("color", e.target.value)} className="border-slate-300" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="product-form-manufacturer" className="text-sm font-medium text-slate-700">ชื่อผู้ผลิต <span className="font-normal text-slate-400">(ไม่บังคับ)</span></label>
          <Input id="product-form-manufacturer" maxLength={NAME_LIMITS.manufacturerName} value={form.manufacturerName} onChange={e => updateForm("manufacturerName", e.target.value)} placeholder="เช่น ชื่อบนกล่อง / ชื่อจากโรงงาน" className="border-slate-300" />
          <p className="text-[11px] text-slate-500">ค้นหาด้วยชื่อนี้ได้ทุกหน้า · เลือกพิมพ์ชื่อนี้บนใบสั่งซื้อ / ใบคืนสินค้าถึงผู้ขายได้</p>
        </div>
        <div className="space-y-1.5 sm:col-span-2 pt-3 border-t border-slate-100">
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

      </div>
    </FormSection>
  );
}
