import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { useCartStore } from '@/lib/store/cart-store';

interface CustomerSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Mock customers for now
const MOCK_CUSTOMERS = [
  { id: '1', name: 'คุณสมชาย ใจดี', phone: '0812345678', points: 150 },
  { id: '2', name: 'คุณสมหญิง รักสวย', phone: '0898765432', points: 420 },
  { id: '3', name: 'ลูกค้าทั่วไป', phone: '-', points: 0 },
];

export function CustomerSelectModal({ open, onOpenChange }: CustomerSelectModalProps) {
  const [search, setSearch] = useState('');
  const cart = useCartStore();

  const filtered = MOCK_CUSTOMERS.filter(c => 
    c.name.includes(search) || c.phone.includes(search)
  );

  const handleSelect = (customer: any) => {
    cart.setCustomer(customer.id === '3' ? null : customer.id, customer.id === '3' ? '' : customer.name);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white text-slate-900 border-slate-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>เลือกลูกค้า</DialogTitle>
          <DialogDescription className="text-slate-500">
            เลือกลูกค้าสำหรับบิลนี้ เพื่อสะสมแต้มหรือให้ส่วนลดพิเศษ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input 
                placeholder="ค้นหาชื่อ, เบอร์โทร..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-slate-50 border-slate-300"
              />
            </div>
            <Button variant="outline" className="border-slate-300 bg-slate-50" title="เพิ่มลูกค้าใหม่">
              <UserPlus className="w-4 h-4" />
            </Button>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 max-h-64 overflow-y-auto">
            {filtered.map(c => (
              <div 
                key={c.id} 
                className="flex items-center justify-between p-3 border-b border-slate-200 last:border-0 hover:bg-slate-100 cursor-pointer transition-colors"
                onClick={() => handleSelect(c)}
              >
                <div>
                  <div className="font-medium text-slate-900">{c.name}</div>
                  <div className="text-xs text-slate-500">เบอร์โทร: {c.phone}</div>
                </div>
                {c.points > 0 && (
                  <div className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-md">
                    {c.points} แต้ม
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-sm">ไม่พบลูกค้าที่ค้นหา</div>
            )}
          </div>
          
          <Button variant="ghost" className="w-full text-slate-500 hover:text-slate-900" onClick={() => handleSelect(MOCK_CUSTOMERS[2])}>
            ล้างการเลือกลูกค้า (เป็นลูกค้าทั่วไป)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
