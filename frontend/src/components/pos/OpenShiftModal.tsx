import { useState } from 'react';
import { useShiftStore } from '@/lib/store/shift-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LogIn } from 'lucide-react';

interface OpenShiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OpenShiftModal({ open, onOpenChange }: OpenShiftModalProps) {
  const { openShift } = useShiftStore();
  const { user } = useAuthStore();
  const [openingCash, setOpeningCash] = useState<string>('');

  const handleOpenShift = () => {
    const cash = parseFloat(openingCash);
    if (!isNaN(cash) && cash >= 0) {
      openShift(user?.name || 'พนักงานขาย', cash);
      onOpenChange(false);
      setOpeningCash('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] bg-white border-slate-200 text-slate-900">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-primary flex items-center">
            <LogIn className="w-5 h-5 mr-2" />
            เปิดกะ (Open Shift)
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-medium text-slate-500">ชื่อพนักงาน</label>
            <Input 
              value={user?.name || 'พนักงานขาย'} 
              disabled 
              className="bg-slate-50 border-slate-300 h-12 text-lg text-slate-900"
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-slate-500">เงินสดตั้งต้นในลิ้นชัก (บาท)</label>
            <Input 
              type="number"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              className="bg-slate-50 border-slate-300 h-12 text-lg text-slate-900"
              placeholder="0.00"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1 border-slate-300 text-slate-700" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button 
            className="flex-1 bg-primary hover:bg-primary/90 text-white" 
            onClick={handleOpenShift}
            disabled={!openingCash}
          >
            ยืนยันเปิดกะ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
