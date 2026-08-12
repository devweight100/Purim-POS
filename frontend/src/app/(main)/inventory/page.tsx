'use client';

import { useState, useEffect } from 'react';
import { categories } from '@/lib/mock-data';
import { useProductStore } from '@/lib/store/product-store';
import { formatStockDisplay } from '@/lib/inventory-logic';
import { formatCurrency } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, Filter, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all');
  const { products, fetchProducts, isLoading } = useProductStore();

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const filteredProducts = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const matchCategory = activeCategory === 'all' || p.categoryId === activeCategory;
    return matchSearch && matchCategory;
  });

  const getCategoryName = (id: string) => categories.find(c => c.id === id)?.name || 'ไม่ระบุ';

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">คลังสินค้า (Inventory)</h1>
          <p className="text-slate-500 mt-1">จัดการสต๊อกสินค้า หน่วยสินค้า และระบบ FIFO</p>
        </div>
        <Button 
          className="w-full bg-primary text-white hover:bg-primary/90 sm:w-auto"
          onClick={() => toast.info('ระบบรับเข้าสินค้า (GRN) จะเปิดใช้งานใน Phase 4 (ระบบจัดการหลังร้าน)')}
        >
          <Plus className="w-4 h-4 mr-2" />
          รับสินค้าเข้า (GRN)
        </Button>
      </div>

      {/* Toolbar */}
      <div className="mb-6 flex flex-col gap-3 xl:flex-row xl:gap-4">
        <div className="relative flex-1 xl:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input 
            placeholder="ค้นหาชื่อสินค้า, SKU..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-white border-slate-300 focus-visible:ring-primary"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto rounded-md border border-slate-200 bg-white p-1 no-scrollbar">
          <Button 
            variant={activeCategory === 'all' ? 'secondary' : 'ghost'}
            className={activeCategory === 'all' ? 'bg-sky-50 text-sky-700' : 'text-slate-500'}
            size="sm"
            onClick={() => setActiveCategory('all')}
          >
            ทั้งหมด
          </Button>
          {categories.map(c => (
            <Button 
              key={c.id}
              variant={activeCategory === c.id ? 'secondary' : 'ghost'}
              className={activeCategory === c.id ? 'bg-sky-50 text-sky-700' : 'text-slate-500'}
              size="sm"
              onClick={() => setActiveCategory(c.id)}
            >
              {c.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <tr>
              <th className="p-4 font-medium">รหัส (SKU)</th>
              <th className="p-4 font-medium">ชื่อสินค้า</th>
              <th className="p-4 font-medium">หมวดหมู่</th>
              <th className="p-4 font-medium text-right">สต๊อกรวม (หน่วยฐาน)</th>
              <th className="p-4 font-medium">สรุปจำนวน (ตามโครงสร้างแพ็คเกจ)</th>
              <th className="p-4 font-medium">สถานะ</th>
              <th className="p-4 font-medium text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  ไม่พบข้อมูลสินค้า
                </td>
              </tr>
            ) : (
              filteredProducts.map(p => {
                const lowStock = p.stock < 20; // Hardcode threshold for now
                return (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">{p.sku}</td>
                    <td className="p-4 font-medium text-slate-900">{p.name}</td>
                    <td className="p-4">
                      <Badge variant="outline" className="border-slate-300 text-slate-500 bg-white">
                        {getCategoryName(p.categoryId!)}
                      </Badge>
                    </td>
                    <td className="p-4 text-right font-bold text-slate-900">
                      {p.stock}
                    </td>
                    <td className="p-4 text-amber-600">
                      {formatStockDisplay(p)}
                    </td>
                    <td className="p-4">
                      {lowStock ? (
                        <Badge variant="destructive" className="bg-red-50 text-red-600 border-red-200 flex items-center w-fit">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          ใกล้หมด
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50">
                          ปกติ
                        </Badge>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                        onClick={() => toast.info(`ระบบประวัติล็อตของ ${p.name} จะอยู่ใน Phase 4`)}
                      >
                        ดูประวัติล็อต
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
