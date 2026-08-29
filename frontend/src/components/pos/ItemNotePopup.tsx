import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StickyNote, Tag } from 'lucide-react';

interface ItemNotePopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string) => void;
  title?: string;
  initialNote?: string;
}

export function ItemNotePopup({
  open,
  onOpenChange,
  onConfirm,
  title = "ระบุโน้ตประจำรายการสินค้า",
  initialNote = ""
}: ItemNotePopupProps) {
  const [note, setNote] = useState(initialNote);

  useEffect(() => {
    if (open) {
      setNote(initialNote || '');
    }
  }, [open, initialNote]);

  const handleQuickAdd = (tag: string) => {
    setNote(prev => (prev ? `${prev}, ${tag}` : tag));
  };

  const handleConfirm = () => {
    onConfirm(note.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] sm:max-w-md bg-white border-slate-200 text-slate-900 rounded-2xl p-6 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold flex items-center justify-center gap-2">
            <StickyNote className="w-5 h-5 text-amber-500" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="py-3 space-y-4">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น แถมฟรี 1 ชิ้น, เปลี่ยนสี, ส่งแยก..."
            className="h-12 bg-white text-base font-medium border-slate-300 focus:border-amber-500 rounded-xl"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
              }
            }}
          />

          {/* Quick Tags */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <Tag className="w-3.5 h-3.5 text-amber-500" /> แท็กโน้ตด่วน:
            </span>
            <div className="flex flex-wrap gap-2">
              {['แถมฟรี', 'สินค้าตัวอย่าง', 'แพ็กพิเศษ', 'ส่งแยก', 'ลดราคาพิเศษ'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleQuickAdd(tag)}
                  className="px-3 py-2 text-sm bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg font-semibold transition-colors"
                >
                  + {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1 h-12 border-slate-300 text-slate-600 font-semibold"
              onClick={() => {
                setNote('');
                onConfirm('');
                onOpenChange(false);
              }}
            >
              ล้างโน้ต
            </Button>
            <Button
              className="flex-1 h-12 bg-amber-500 hover:bg-amber-600 text-white font-bold text-base shadow-md"
              onClick={handleConfirm}
            >
              บันทึกโน้ต (Enter ↵)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
