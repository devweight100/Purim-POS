import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState, useRef, useEffect } from 'react';
import { ScanLine } from 'lucide-react';
import { useCartStore } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';
import { toast } from 'sonner';

interface BarcodeScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BarcodeScanModal({ open, onOpenChange }: BarcodeScanModalProps) {
  const [barcode, setBarcode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cart = useCartStore();
  const { products } = useProductStore();

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setBarcode('');
    }
  }, [open]);

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim()) return;

    // Find product with this barcode
    const product = products.find(p => p.sku === barcode || p.units.some(u => u.barcode === barcode));
    
    if (product) {
      // Find specific unit
      const unit = product.units.find(u => u.barcode === barcode) || product.units[0];
      cart.addItem(product, unit);
      toast.success(`เพิ่ม ${product.name} ลงตะกร้าแล้ว`);
      setBarcode('');
      // Keep modal open for continuous scanning, or close it
      // onOpenChange(false); 
    } else {
      toast.error('ไม่พบสินค้าจากบาร์โค้ดนี้');
      setBarcode('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white text-slate-900 border-slate-200 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <ScanLine className="w-5 h-5 mr-2 text-primary" />
            สแกนบาร์โค้ด
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            ใช้เครื่องสแกนบาร์โค้ด หรือพิมพ์รหัสบาร์โค้ดด้วยตนเอง
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleScan} className="space-y-4 pt-4">
          <Input 
            ref={inputRef}
            placeholder="รหัสบาร์โค้ด..." 
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className="bg-slate-50 border-slate-300 h-14 text-xl text-center focus-visible:ring-amber-500"
          />
          <Button type="submit" className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-bold">
            ตกลง
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
