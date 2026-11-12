import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Search, Package, PackageOpen, Image as ImageIcon } from 'lucide-react';
import { formatQty } from '@/lib/qty';
import {
  defaultUnitCost, getProductUnits,
  type PoCartItem, type PoProductLike, type PoSupplier, type PreviewTarget,
} from './po-shared';

interface Props {
  isSupplierCatalogOpen: boolean;
  setIsSupplierCatalogOpen: (open: boolean) => void;
  selectedSupplier: PoSupplier | null;
  catalogSearch: string;
  setCatalogSearch: (v: string) => void;
  filteredCatalogProducts: PoProductLike[];
  cartItems: PoCartItem[];
  openImagePreview: (product: PreviewTarget, e?: React.MouseEvent) => void;
  addCartItemWithUnit: (product: PoProductLike, unitName: string, multiplier: number, deltaQty?: number) => void;
}

/** Larger list of every product bound to the selected supplier. */
export function PoSupplierCatalogDialog({
  isSupplierCatalogOpen, setIsSupplierCatalogOpen, selectedSupplier, catalogSearch, setCatalogSearch,
  filteredCatalogProducts, cartItems, openImagePreview, addCartItemWithUnit,
}: Props) {
  return (
    <Dialog open={isSupplierCatalogOpen} onOpenChange={setIsSupplierCatalogOpen}>
      <DialogContent className="max-h-[92dvh] max-w-[95vw] lg:max-w-6xl xl:max-w-7xl overflow-hidden bg-white p-0 text-slate-900 flex flex-col border-slate-200">
        <DialogHeader className="border-b border-slate-200 px-6 py-4 flex flex-row items-center justify-between shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Package className="h-6 w-6 text-sky-500" />
            รายการสินค้าจากผู้จำหน่าย: <span className="text-sky-600">{selectedSupplier?.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input
              placeholder="ค้นหาชื่อ หรือ SKU สินค้า..."
              className="pl-9 bg-white border-slate-300 h-10 text-sm"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="hidden grid-cols-[48px_minmax(0,1.8fr)_110px_120px_130px_140px] items-center gap-4 rounded-t-xl border border-slate-200 bg-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
            <div className="text-center">ลำดับ</div>
            <div>สินค้า</div>
            <div className="text-right">คงเหลือ</div>
            <div className="text-right">ต้นทุน/หน่วย</div>
            <div className="text-center">สถานะสั่งซื้อ</div>
            <div className="text-right">จัดการ</div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 lg:rounded-t-none lg:border-t-0 bg-white">
            {filteredCatalogProducts.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center text-center text-slate-500 space-y-2 p-6">
                <PackageOpen className="h-12 w-12 text-slate-300" />
                <p className="font-bold text-base text-slate-800">ไม่พบสินค้าที่ผูกกับผู้จำหน่าย &quot;{selectedSupplier?.name}&quot;</p>
                <p className="text-xs text-slate-400 max-w-md">
                  คำแนะนำ: ท่านสามารถผูกผู้จำหน่ายกับสินค้าได้ใน <b>หน้ารายละเอียดสินค้า (การจัดการสินค้า)</b> โดยระบุผู้จำหน่ายในช่องบาร์โค้ดหรือต้นทุนสินค้า
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredCatalogProducts.map((product, idx: number) => {
                  const units = getProductUnits(product);
                  return (
                    <div
                      key={product.id}
                      className="grid grid-cols-1 gap-3 px-4 py-3.5 hover:bg-sky-50/40 transition-colors lg:grid-cols-[48px_minmax(0,1.8fr)_110px_120px_auto] lg:items-center"
                    >
                      <div className="hidden lg:block text-center font-semibold text-slate-400 text-sm">
                        {idx + 1}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={(e) => openImagePreview(product, e)}
                            className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400 hover:text-sky-600 hover:border-sky-300 transition-colors shadow-sm"
                            title="กดเพื่อดูรูปสินค้า"
                          >
                            <ImageIcon className="w-5 h-5" />
                          </button>
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-slate-900">{product.name}</div>
                            <div className="truncate text-xs text-slate-500 font-mono">{product.sku}</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-sm font-semibold text-slate-700 lg:block lg:text-right">
                        <span className="text-xs font-medium text-slate-500 lg:hidden">คงเหลือ</span>
                        {Number(product.stock ?? 0) < 0 ? (
                          <span className="inline-flex items-center gap-1 font-extrabold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                            🔻 {product.stock} {product.unit || 'ชิ้น'}
                          </span>
                        ) : (
                          <span>{product.stock ?? '-'} {product.unit || 'ชิ้น'}</span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-sm font-bold text-slate-900 lg:block lg:text-right">
                        <span className="text-xs font-medium text-slate-500 lg:hidden">ต้นทุน</span>
                        {formatCurrency(defaultUnitCost(product))}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {units.map((u, ui) => {
                          const existing = cartItems.find(i => i.productId === product.id && (i.unitName === u.name || (!i.unitName && u.name === (product.unit || 'ชิ้น'))));
                          return (
                            <Button
                              key={ui}
                              size="sm"
                              className={`h-8 text-xs font-semibold px-2.5 ${
                                existing
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-sky-500 text-white hover:bg-sky-600 shadow-xs"
                              }`}
                              onClick={() => addCartItemWithUnit(product, u.name, u.mult, 1)}
                            >
                              +1 {u.name} {u.mult > 1 ? `(×${u.mult})` : ''} {existing ? `[สั่งแล้ว ${formatQty(existing.quantity)}]` : ''}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 px-6 py-4 bg-slate-50 shrink-0">
          <Button onClick={() => setIsSupplierCatalogOpen(false)} className="bg-slate-900 text-white hover:bg-slate-800">
            ปิดหน้าต่าง (Esc)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
