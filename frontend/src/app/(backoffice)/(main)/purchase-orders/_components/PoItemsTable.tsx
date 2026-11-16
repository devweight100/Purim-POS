import { normVatType, type PoVatType } from '@shared/po-calc';
import { formatCurrency } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PackageOpen, Trash2, Image as ImageIcon } from 'lucide-react';
import { qtyInputMode, qtyStep } from '@/lib/qty';
import type { DiscountKind, PoCartItem, PoProductLike, PreviewTarget } from './po-shared';

interface Props {
  cartItems: PoCartItem[];
  supplierProducts: PoProductLike[];
  getItemTotal: (item: PoCartItem) => number;
  allowDecimalQty: boolean;
  openImagePreview: (product: PreviewTarget, e?: React.MouseEvent) => void;
  updateProductUnitCost: (product: PoProductLike, cost: number) => void;
  updateProductQuantity: (product: PoProductLike, quantity: number) => void;
  updateProductDiscount: (product: PoProductLike, key: 'discountType' | 'discountValue', value: DiscountKind | number) => void;
  updateItemVat: (productId: string, patch: { vatType?: PoVatType; vatRate?: number }) => void;
  removeCartItem: (productId: string) => void;
}

/** The order table (ตารางสั่งของ) of the PO being created / edited. */
export function PoItemsTable({
  cartItems, supplierProducts, getItemTotal, allowDecimalQty, openImagePreview,
  updateProductUnitCost, updateProductQuantity, updateProductDiscount, updateItemVat, removeCartItem,
}: Props) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="hidden grid-cols-[40px_minmax(0,1.6fr)_70px_96px_80px_140px_150px_112px_44px] items-center gap-3 border-b border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-600 lg:grid">
        <div className="text-center">#</div>
        <div>สินค้า</div>
        <div className="text-right">คงเหลือ</div>
        <div className="text-right">ต้นทุน/หน่วย</div>
        <div className="text-right">จำนวน</div>
        <div>ส่วนลดรายการ</div>
        <div>VAT / อัตรา %</div>
        <div className="text-right">รวม (รวม VAT)</div>
        <div className="text-center">ลบ</div>
      </div>

      {cartItems.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center text-center text-slate-500 space-y-3">
          <PackageOpen className="h-14 w-14 text-slate-300" />
          <p className="font-semibold text-base text-slate-700">ยังไม่มีสินค้าในตารางสั่งของ</p>
          <p className="text-sm text-slate-400">พิมพ์ค้นหาสินค้าด้านบนแล้วกด Enter หรือคลิก &quot;ดูสินค้าจากผู้จำหน่ายทั้งหมด&quot;</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {cartItems.map((item, index) => {
            const product = supplierProducts.find(p => p.id === item.productId) || { ...item, id: item.productId };
            const unitCost = item.unitCost;
            const quantity = item.quantity;
            const discountType = item.discountType;
            const discountValue = item.discountValue;
            const rowTotal = getItemTotal(item);

            return (
              <div
                key={item.productId}
                className="grid grid-cols-1 gap-3 px-4 py-3 transition-colors hover:bg-sky-50/30 lg:grid-cols-[40px_minmax(0,1.6fr)_70px_96px_80px_140px_150px_112px_44px] lg:items-center"
              >
                {/* Col 1: ลำดับ */}
                <div className="hidden lg:block text-center font-semibold text-slate-400 text-sm">
                  {index + 1}
                </div>

                {/* Col 2: สินค้า + รูป */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="lg:hidden text-xs font-bold text-slate-400">#{index + 1}</span>
                    <button
                      type="button"
                      onClick={(e) => openImagePreview(product, e)}
                      className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-400 hover:text-sky-600 hover:border-sky-300 transition-colors shadow-sm"
                      title="กดเพื่อดูรูปภาพสินค้า"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                        <span>{product.name}</span>
                        <Badge className="bg-sky-100 text-sky-800 border-sky-300 text-xs font-bold shrink-0">
                          {item.unitName || item.baseUnit || 'ชิ้น'} {(item.multiplier ?? 0) > 1 ? `(×${item.multiplier})` : ''}
                        </Badge>
                      </div>
                      <div className="truncate text-xs text-slate-500 font-mono">{product.sku}</div>
                    </div>
                  </div>
                </div>

                {/* Col 3: คงเหลือ */}
                <div className="flex items-center justify-between text-sm text-slate-600 lg:block lg:text-right">
                  <span className="text-xs font-medium text-slate-500 lg:hidden">คงเหลือ</span>
                  <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                    {item.stock ?? product.stock ?? '-'}
                  </Badge>
                </div>

                {/* Col 4: ต้นทุน */}
                <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs font-medium text-slate-500 lg:block">
                  <span className="lg:hidden">ต้นทุน</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={unitCost}
                    onChange={(e) => updateProductUnitCost(product, Number(e.target.value))}
                    className="h-9 bg-white text-right text-sm border-slate-300 focus-visible:ring-sky-500 font-semibold text-slate-900"
                  />
                </label>

                {/* Col 5: จำนวน */}
                <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs font-medium text-slate-500 lg:block">
                  <span className="lg:hidden">จำนวน</span>
                  <Input
                    type="number"
                    min={qtyStep(allowDecimalQty)}
                    step={qtyStep(allowDecimalQty)}
                    inputMode={qtyInputMode(allowDecimalQty)}
                    value={quantity}
                    onChange={(e) => updateProductQuantity(product, Number(e.target.value))}
                    className="h-9 bg-white text-right text-sm border-slate-300 focus-visible:ring-sky-500 font-bold text-sky-600"
                  />
                </label>

                {/* Col 6: ส่วนลด */}
                <div className="grid grid-cols-[84px_1fr] items-center gap-2 lg:block">
                  <span className="text-xs font-medium text-slate-500 lg:hidden">ส่วนลด</span>
                  <div className="grid grid-cols-[1fr_54px] gap-1.5">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={discountValue}
                      onChange={(e) => updateProductDiscount(product, 'discountValue', Number(e.target.value))}
                      className="h-9 bg-white text-right text-sm border-slate-300"
                    />
                    <select
                      value={discountType}
                      onChange={(e) => updateProductDiscount(product, 'discountType', e.target.value as 'baht' | 'percent')}
                      className="h-9 rounded-lg border border-slate-300 bg-white px-1.5 text-xs font-medium text-slate-700 outline-none focus:border-sky-500"
                    >
                      <option value="baht">บาท</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                </div>

                {/* Col 6b: VAT ของรายการนี้ */}
                <div className="grid grid-cols-[84px_1fr] items-center gap-2 lg:block">
                  <span className="text-xs font-medium text-slate-500 lg:hidden">VAT</span>
                  <div className="grid grid-cols-[1fr_46px] gap-1.5">
                    <select
                      value={normVatType(item.vatType)}
                      onChange={(e) => updateItemVat(item.productId, { vatType: e.target.value as PoVatType })}
                      className={`h-9 rounded-lg border px-1.5 text-xs font-bold outline-none focus:border-sky-500 ${normVatType(item.vatType) === 'NONE' ? 'border-slate-300 bg-white text-slate-600' : normVatType(item.vatType) === 'INCLUDED' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
                      title="VAT ของรายการนี้ตามบิลผู้จำหน่าย"
                    >
                      <option value="NONE">ไม่มี VAT</option>
                      <option value="INCLUDED">รวม VAT แล้ว</option>
                      <option value="EXCLUDED">+VAT แยก</option>
                    </select>
                    <Input
                      type="number"
                      min="0"
                      max="30"
                      step="0.01"
                      disabled={normVatType(item.vatType) === 'NONE'}
                      value={normVatType(item.vatType) === 'NONE' ? '' : (item.vatRate ?? 7)}
                      onChange={(e) => updateItemVat(item.productId, { vatRate: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
                      className="h-9 bg-white text-right text-xs border-slate-300 px-1.5"
                      title="อัตรา VAT (%)"
                    />
                  </div>
                </div>

                {/* Col 7: รวมสุทธิ */}
                <div className="flex items-center justify-between text-base font-bold text-slate-900 lg:block lg:text-right">
                  <span className="text-xs font-medium text-slate-500 lg:hidden">รวม</span>
                  {formatCurrency(rowTotal)}
                </div>

                {/* Col 8: ปุ่มลบ */}
                <div className="text-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => removeCartItem(item.productId)}
                    title="ลบรายการนี้"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
