"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Small "create one" dialog opened from the product form (BUG-11): a new category or supplier without
 * leaving the form. Enter saves, Escape closes only this dialog (the product form and its input stay).
 */
export function QuickCreateDialog({ open, onOpenChange, title, label, placeholder, onCreate }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  placeholder?: string;
  /** saves the name on the server; throw to show the error here */
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (o: boolean) => {
    if (saving) return;
    if (!o) { setName(""); setError(null); }
    onOpenChange(o);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const n = name.trim();
    if (!n) { setError(`กรุณาใส่${label}`); return; }
    setSaving(true);
    setError(null);
    try {
      await onCreate(n);
      setName("");
      onOpenChange(false);
    } catch (err) {
      setError((err as Error)?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="bg-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>บันทึกแล้วจะถูกเลือกในฟอร์มสินค้าให้ทันที ข้อมูลที่กรอกไว้ในฟอร์มยังอยู่ครบ</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="quick-create-name" className="text-sm font-medium text-slate-700">{label} *</label>
            <Input id="quick-create-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} className="h-10" />
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          </div>
          <div className="flex justify-end gap-btn-lg">
            <Button type="button" variant="outline" onClick={() => change(false)} disabled={saving}>ยกเลิก</Button>
            <Button type="submit" disabled={saving} className="bg-primary text-white hover:bg-primary/90">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}บันทึก (Enter)
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
