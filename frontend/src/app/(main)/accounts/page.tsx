'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  BankAccount, loadBankAccounts, saveBankAccounts 
} from '@/lib/bank-account-storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { 
  Building2, Plus, QrCode, Trash2, Edit, 
  CheckCircle2, Info, Star, Upload, CreditCard 
} from 'lucide-react';
import { toast } from 'sonner';

const BANK_PRESETS = [
  { name: 'ธนาคารกสิกรไทย (KBank)', color: '#10b981' },
  { name: 'ธนาคารไทยพาณิชย์ (SCB)', color: '#8b5cf6' },
  { name: 'ธนาคารกรุงเทพ (BBL)', color: '#1e40af' },
  { name: 'ธนาคารกรุงไทย (KTB)', color: '#0284c7' },
  { name: 'ธนาคารกรุงศรีอยุธยา (BAY)', color: '#eab308' },
  { name: 'พร้อมเพย์ (PromptPay)', color: '#3b82f6' },
  { name: 'ธนาคารออมสิน (GSB)', color: '#ec4899' },
];

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Form state
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [color, setColor] = useState('#3b82f6');
  const [isDefault, setIsDefault] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAccounts(loadBankAccounts());
  }, []);

  const handleOpenAdd = () => {
    setEditingAccount(null);
    setBankName(BANK_PRESETS[0].name);
    setAccountName('');
    setAccountNumber('');
    setQrImageUrl(null);
    setColor(BANK_PRESETS[0].color);
    setIsDefault(accounts.length === 0);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (acc: BankAccount) => {
    setEditingAccount(acc);
    setBankName(acc.bankName);
    setAccountName(acc.accountName);
    setAccountNumber(acc.accountNumber);
    setQrImageUrl(acc.qrImageUrl || null);
    setColor(acc.color || '#3b82f6');
    setIsDefault(!!acc.isDefault);
    setIsDialogOpen(true);
  };

  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round((h * MAX) / w); w = MAX; }
          else { w = Math.round((w * MAX) / h); h = MAX; }
        }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setQrImageUrl(dataUrl);
        toast.success('อัปโหลดรูป QR Code สำเร็จ');
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!accountName.trim()) { toast.error('กรุณาระบุชื่อบัญชี'); return; }
    if (!accountNumber.trim()) { toast.error('กรุณาระบุเลขที่บัญชี / เบอร์พร้อมเพย์'); return; }

    let updatedList: BankAccount[];
    const newId = editingAccount?.id || `bank_${Date.now()}`;

    const newObj: BankAccount = {
      id: newId,
      bankName: bankName.trim(),
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      qrImageUrl: qrImageUrl,
      color: color,
      isDefault: isDefault,
    };

    if (isDefault) {
      // Unset other defaults
      accounts.forEach(a => a.isDefault = false);
    }

    if (editingAccount) {
      updatedList = accounts.map(a => a.id === editingAccount.id ? newObj : a);
    } else {
      updatedList = [newObj, ...accounts];
    }

    // Ensure at least 1 default exists
    if (!updatedList.some(a => a.isDefault) && updatedList.length > 0) {
      updatedList[0].isDefault = true;
    }

    setAccounts(updatedList);
    saveBankAccounts(updatedList);
    toast.success(`${editingAccount ? 'แก้ไข' : 'เพิ่ม'}บัญชีการเงินสำเร็จ`);
    setIsDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    if (accounts.length <= 1) {
      toast.error('ต้องมีบัญชีการเงินอย่างน้อย 1 บัญชี');
      return;
    }
    const filtered = accounts.filter(a => a.id !== id);
    if (!filtered.some(a => a.isDefault) && filtered.length > 0) {
      filtered[0].isDefault = true;
    }
    setAccounts(filtered);
    saveBankAccounts(filtered);
    toast.success('ลบบัญชีการเงินเรียบร้อย');
  };

  const handleSetDefault = (id: string) => {
    const updated = accounts.map(a => ({
      ...a,
      isDefault: a.id === id
    }));
    setAccounts(updated);
    saveBankAccounts(updated);
    toast.success('ตั้งเป็นบัญชีหลักเรียบร้อย');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl flex items-center gap-2">
            <Building2 className="w-8 h-8 text-sky-500" /> จัดการบัญชีการเงิน & QR Code
          </h1>
          <p className="text-slate-500 mt-1">ตั้งค่าและจัดการบัญชีธนาคารสำหรับรับโอนเงินและ QR PromptPay หน้าร้าน</p>
        </div>
        <Button onClick={handleOpenAdd} className="bg-sky-500 hover:bg-sky-600 text-white font-bold h-11 px-5 shadow-sm">
          <Plus className="w-5 h-5 mr-2" /> เพิ่มบัญชีการเงิน
        </Button>
      </div>

      {/* Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {accounts.map((acc) => (
          <div 
            key={acc.id}
            className={`bg-white border-2 rounded-2xl p-5 shadow-sm transition-all flex flex-col justify-between relative ${
              acc.isDefault ? "border-sky-500 ring-2 ring-sky-500/10" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            {acc.isDefault && (
              <Badge className="absolute -top-3 right-4 bg-sky-500 text-white font-bold px-3 py-0.5 shadow-sm">
                ★ บัญชีหลัก
              </Badge>
            )}

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div 
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-sm"
                  style={{ backgroundColor: acc.color || '#3b82f6' }}
                >
                  <CreditCard className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-slate-900 text-base truncate">{acc.bankName}</h3>
                  <p className="text-xs text-slate-500 truncate">{acc.accountName}</p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                <span className="text-xs text-slate-400 block mb-0.5">เลขที่บัญชี / พร้อมเพย์</span>
                <span className="font-mono font-bold text-xl text-slate-900 tracking-wider">
                  {acc.accountNumber}
                </span>
              </div>

              {/* QR Code Preview */}
              {acc.qrImageUrl ? (
                <div className="flex justify-center py-2">
                  <div className="w-36 h-36 border-2 border-slate-200 rounded-xl overflow-hidden bg-white p-1 shadow-inner flex items-center justify-center">
                    <img src={acc.qrImageUrl} alt="QR Code" className="w-full h-full object-contain" />
                  </div>
                </div>
              ) : (
                <div className="h-28 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 flex flex-col items-center justify-center text-slate-400 gap-1 text-xs">
                  <QrCode className="w-8 h-8 text-slate-300" />
                  <span>ยังไม่ได้อัปโหลดรูป QR Code</span>
                </div>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
              {!acc.isDefault && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-xs border-slate-300 text-slate-600 hover:bg-sky-50 hover:text-sky-600"
                  onClick={() => handleSetDefault(acc.id)}
                >
                  <Star className="w-3.5 h-3.5 mr-1 text-amber-500" /> ตั้งเป็นบัญชีหลัก
                </Button>
              )}
              {acc.isDefault && <div />}
              
              <div className="flex gap-1.5">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-sky-600" onClick={() => handleOpenEdit(acc)}>
                  <Edit className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:bg-red-50 hover:text-red-600" onClick={() => handleDelete(acc.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md bg-white border-slate-200 text-slate-900">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Building2 className="w-5 h-5 text-sky-500" />
              {editingAccount ? 'แก้ไขบัญชีการเงิน' : 'เพิ่มบัญชีการเงินใหม่'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">ธนาคาร / ช่องทาง *</label>
              <select
                value={bankName}
                onChange={(e) => {
                  setBankName(e.target.value);
                  const preset = BANK_PRESETS.find(p => p.name === e.target.value);
                  if (preset) setColor(preset.color);
                }}
                className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-500"
              >
                {BANK_PRESETS.map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">ชื่อบัญชี *</label>
              <Input
                placeholder="เช่น ร้านปุริม โดย นายปุริม"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="h-10 border-slate-300 text-sm font-medium"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">เลขที่บัญชี / เบอร์พร้อมเพย์ *</label>
              <Input
                placeholder="เช่น 081-234-5678 หรือ 123-4-56789-0"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="h-10 border-slate-300 font-mono text-sm font-bold"
              />
            </div>

            {/* QR Code Upload */}
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">รูป QR Code สแกนจ่าย</label>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-xl p-4 bg-slate-50 hover:bg-slate-100 cursor-pointer flex flex-col items-center justify-center gap-2 text-center transition-colors"
              >
                {qrImageUrl ? (
                  <div className="relative group">
                    <img src={qrImageUrl} alt="QR Code" className="w-32 h-32 object-contain rounded-lg border border-slate-200" />
                    <span className="text-xs text-sky-600 block mt-2 font-medium">กดเพื่อเปลี่ยนรูปภาพ</span>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-slate-400" />
                    <p className="text-sm text-slate-600 font-medium">คลิกเพื่ออัปโหลดรูป QR Code</p>
                    <p className="text-xs text-slate-400">ไฟล์รูปภาพ (JPG, PNG)</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleImageFile(e.target.files[0]);
                  e.target.value = '';
                }}
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="isDefaultCheck"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
              />
              <label htmlFor="isDefaultCheck" className="text-sm font-semibold text-slate-700 cursor-pointer">
                ตั้งเป็นบัญชีหลักสำหรับการรับโอนเงิน
              </label>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-slate-100">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="border-slate-300 text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleSave} className="bg-sky-500 hover:bg-sky-600 text-white font-bold">
              บันทึกบัญชี
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
