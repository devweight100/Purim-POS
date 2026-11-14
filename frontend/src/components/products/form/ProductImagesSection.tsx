"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Crown, ImagePlus, Info, Trash2, Upload } from "lucide-react";
import { compressImage, generateId } from "../product-helpers";
import { imageSrc, type ProductImageItem, type SetForm } from "../types";

const THUMB_PX = 240;

/** Up to 3 product images (drag & drop or file picker), compressed to JPEG data URLs; one is the cover. */
export function ProductImagesSection({ images, setForm }: { images: ProductImageItem[]; setForm: SetForm }) {
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [imgDragOver, setImgDragOver] = useState(false);

  const handleImageFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const remaining = 3 - images.length;
    if (remaining <= 0) { toast.warning("เพิ่มรูปได้สูงสุด 3 รูป"); return; }
    const toProcess = Array.from(files).filter(f => f.type.startsWith("image/")).slice(0, remaining);
    for (const file of toProcess) {
      try {
        const dataUrl = await compressImage(file);
        // small copy for product lists / POS cards (served as GET /api/product-images/:id?size=thumb)
        const thumbDataUrl = await compressImage(file, THUMB_PX).catch(() => undefined);
        setForm(prev => ({
          ...prev,
          images: [...prev.images, { id: generateId(), dataUrl, ...(thumbDataUrl ? { thumbDataUrl } : {}), name: file.name, isCover: prev.images.length === 0 }],
        }));
      } catch { toast.error(`ไม่สามารถโหลดรูป ${file.name}`); }
    }
  }, [images.length, setForm]);

  const setCoverImage = (id: string) =>
    setForm(prev => ({ ...prev, images: prev.images.map(img => ({ ...img, isCover: img.id === id })) }));

  const removeImage = (id: string) =>
    setForm(prev => {
      const remaining = prev.images.filter(img => img.id !== id);
      if (remaining.length > 0 && !remaining.some(img => img.isCover)) remaining[0] = { ...remaining[0], isCover: true };
      return { ...prev, images: remaining };
    });

  return (
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
        {images.map(img => (
          <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden border-2 border-slate-200">
            {/* eslint-disable-next-line @next/next/no-img-element -- base64 preview of a new upload or the saved photo's API URL, next/image cannot optimise them */}
            <img src={imageSrc(img)} alt={img.name} className="w-full h-full object-cover" />
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
        {images.length < 3 && (
          <button
            onClick={() => imgInputRef.current?.click()}
            className="aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-primary transition-colors cursor-pointer"
          >
            <Upload className="w-7 h-7" />
            <span className="text-xs font-medium">{images.length === 0 ? "เพิ่มรูปภาพ" : "เพิ่มรูปอีก"}</span>
            <span className="text-[10px]">{3 - images.length} ช่องเหลือ</span>
          </button>
        )}

        {/* Placeholder empty slots (visual) */}
        {Array.from({ length: Math.max(0, 2 - images.length) }).map((_, i) => (
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
        <p>ลากวางรูปที่นี่ได้เลย · รูปถูกบีบอัดและบันทึกลงฐานข้อมูลเมื่อกดบันทึกสินค้า</p>
      </div>
    </section>
  );
}
