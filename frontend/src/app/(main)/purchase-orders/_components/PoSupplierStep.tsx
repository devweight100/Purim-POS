import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Building2 } from 'lucide-react';
import type { PoSupplier, PurchaseOrder } from './po-shared';

interface Props {
  editingPo: PurchaseOrder | null;
  searchSupplier: string;
  setSearchSupplier: (v: string) => void;
  filteredSuppliers: PoSupplier[];
  /** skip to the order table (editing only) */
  onSkip: () => void;
  onCancel: () => void;
  handleSelectSupplier: (supplier: PoSupplier) => void;
}

/** Step 1 of creating / editing a PO: pick the supplier. */
export function PoSupplierStep({ editingPo, searchSupplier, setSearchSupplier, filteredSuppliers, onSkip, onCancel, handleSelectSupplier }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            {editingPo ? `แก้ไขใบสั่งซื้อ (PO: ${editingPo.poNumber})` : 'เปิดใบสั่งซื้อ (PO) ใหม่'}
            {editingPo && (
              <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs font-bold ml-2">
                กำลังแก้ไข
              </Badge>
            )}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {editingPo ? 'ขั้นตอนที่ 1: เปลี่ยนผู้จำหน่าย (หรือกดปุ่มเพื่อข้ามไปขั้นตอนถัดไป)' : 'ขั้นตอนที่ 1: เลือกผู้จำหน่ายที่ต้องการสั่งซื้อสินค้า'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editingPo && (
            <Button variant="outline" onClick={onSkip} className="border-slate-300 text-slate-700">
              ข้ามไปตารางสินค้า →
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel} className="text-slate-500 hover:bg-slate-100">
            ยกเลิก (Esc)
          </Button>
        </div>
      </div>
      <div className="bg-white px-4 py-4 border-b border-slate-200 shrink-0 sm:px-6">
        <div className="relative max-w-2xl mx-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <Input 
            placeholder="ค้นหาชื่อผู้จำหน่าย หรือ เบอร์โทร..." 
            className="pl-12 bg-slate-50 border-slate-300 focus-visible:ring-sky-500 h-12 text-lg rounded-full"
            value={searchSupplier}
            onChange={(e) => setSearchSupplier(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto grid max-w-7xl grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 sm:gap-6">
          {filteredSuppliers.map((supplier) => (
            <div 
              key={supplier.id}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-sky-400 cursor-pointer transition-all flex flex-col items-center text-center group"
              onClick={() => handleSelectSupplier(supplier)}
            >
              <div className="w-14 h-14 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-inner">
                <Building2 className="w-7 h-7" />
              </div>
              <h3 className="font-semibold text-slate-900 text-lg mb-1">{supplier.name}</h3>
              <p className="text-slate-500 text-sm">{supplier.phone || 'ไม่มีเบอร์ติดต่อ'}</p>
              {supplier.creditTerms && (
                <Badge variant="outline" className="mt-3 text-xs text-sky-700 border-sky-200 bg-sky-50">
                  เครดิต {supplier.creditTerms} วัน
                </Badge>
              )}
            </div>
          ))}
          {filteredSuppliers.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-500">
              ไม่พบผู้จำหน่ายที่ค้นหา
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
