import { Product, ProductUnit } from '@/lib/types';
import { getProductPackagingUnits } from '@/lib/cart-pricing';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Package, Check, ArrowRight } from 'lucide-react';

interface SelectUnitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onSelectUnit: (unit: ProductUnit) => void;
}

export function SelectUnitModal({ open, onOpenChange, product, onSelectUnit }: SelectUnitModalProps) {
  if (!product) return null;

  // Gather all available units (from product.units + packaging units)
  const pkgUnits = getProductPackagingUnits(product.id, product.units);
  
  const allUnits: ProductUnit[] = (pkgUnits && pkgUnits.length > 0)
    ? pkgUnits.map(u => ({
        id: `unit-${product.id}-${u.name}`,
        unitName: u.name,
        factor: u.multiplier,
        price: u.priceLevel1 > 0 ? u.priceLevel1 : (product.units[0]?.price * u.multiplier),
        barcode: u.barcode || product.units[0]?.barcode,
      }))
    : product.units;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] sm:max-w-md bg-white border-slate-200 text-slate-900 rounded-3xl p-5 shadow-2xl">
        <DialogHeader className="pb-3 border-b border-slate-100">
          <DialogTitle className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-sky-600" />
            <span>เลือกหน่วยบรรจุภัณฑ์สำหรับขาย</span>
          </DialogTitle>
        </DialogHeader>

        <div className="py-3 space-y-4">
          {/* Product Summary Banner */}
          <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
            <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-2xl overflow-hidden shrink-0">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                '📦'
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-extrabold text-sm text-slate-900 truncate">{product.name}</h4>
              <p className="text-xs text-slate-500 font-mono">SKU: {product.sku}</p>
            </div>
          </div>

          <div className="text-xs font-bold text-slate-700">
            เลือกหน่วยที่ต้องการหยิบใส่ตะกร้า:
          </div>

          {/* Units Selection List */}
          <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
            {allUnits.map((u) => {
              const isBase = u.factor === 1;
              return (
                <button
                  key={u.id || u.unitName}
                  type="button"
                  onClick={() => {
                    onSelectUnit(u);
                    onOpenChange(false);
                  }}
                  className="w-full flex items-center justify-between p-3.5 bg-white hover:bg-sky-50 hover:border-sky-400 border-2 border-slate-200 rounded-2xl transition-all shadow-2xs group text-left cursor-pointer"
                >
                  <div className="space-y-0.5">
                    <div className="font-black text-base text-slate-900 group-hover:text-sky-700 flex items-center gap-2">
                      <span>{u.unitName}</span>
                      {isBase ? (
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                          หน่วยหลัก (Base)
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full border border-sky-200">
                          1 {u.unitName} = {u.factor} {allUnits[0]?.unitName || 'หน่วย'}
                        </span>
                      )}
                    </div>
                    {u.barcode && (
                      <p className="text-[11px] text-slate-400 font-mono">บาร์โค้ด: {u.barcode}</p>
                    )}
                  </div>

                  <div className="text-right flex items-center gap-2 shrink-0">
                    <div className="text-lg font-black text-sky-600">
                      {formatCurrency(u.price)}
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
