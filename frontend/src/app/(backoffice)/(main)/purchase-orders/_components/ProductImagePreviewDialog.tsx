import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Image as ImageIcon, Package } from 'lucide-react';
import type { PreviewTarget } from './po-shared';

interface Props {
  previewProduct: PreviewTarget | null;
  setPreviewProduct: (p: PreviewTarget | null) => void;
  previewImages: string[];
  selectedImageIdx: number;
  setSelectedImageIdx: (idx: number) => void;
}

/** Product image preview (used by the order table, the GRN dialog and the PO details). */
export function ProductImagePreviewDialog({ previewProduct, setPreviewProduct, previewImages, selectedImageIdx, setSelectedImageIdx }: Props) {
  return (
    <Dialog open={previewProduct !== null} onOpenChange={(open) => { if (!open) setPreviewProduct(null); }}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md p-6">
        <DialogHeader className="mb-2">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <ImageIcon className="w-5 h-5 text-primary" />
            รูปภาพสินค้า: <span className="text-sky-600">{previewProduct?.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {previewImages.length > 0 ? (
            <div className="space-y-3">
              <div className="aspect-square rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-50 flex items-center justify-center shadow-inner">
                <img src={previewImages[selectedImageIdx] || previewImages[0]} alt={previewProduct?.name} className="w-full h-full object-cover" />
              </div>
              {previewImages.length > 1 && (
                <div className="flex gap-2 justify-center">
                  {previewImages.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedImageIdx(idx)}
                      className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${selectedImageIdx === idx ? "border-primary ring-2 ring-primary/20" : "border-slate-200 opacity-60 hover:opacity-100"}`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="h-56 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-400 gap-2">
              <Package className="w-12 h-12 text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">ไม่มีรูปภาพสินค้าสำหรับรายการนี้</p>
              <p className="text-xs text-slate-400">สามารถเพิ่มรูปได้ในหน้าแก้ไขสินค้า</p>
            </div>
          )}

          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
            <span>รหัส SKU: <b className="font-mono text-slate-700">{previewProduct?.sku}</b></span>
            <span>คงเหลือ: <b className="text-slate-900">{previewProduct?.stock ?? '-'}</b></span>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setPreviewProduct(null)} className="w-full border-slate-300">
            ปิดหน้าต่าง (Esc)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
