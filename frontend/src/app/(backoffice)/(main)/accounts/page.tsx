'use client';

import { RowDeleteMenu } from '@/components/common/RowDeleteMenu';
import { useState, useEffect, useRef } from 'react';
import { BankAccount, fetchBankAccountsFromBackend } from '@/lib/bank-account-storage';
import { api } from '@/lib/api';
import { LoadErrorState, errorMessage } from '@/components/common/LoadErrorState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { 
  Building2, Plus, QrCode, Edit, 
  CheckCircle2, Info, Star, Upload, CreditCard 
} from 'lucide-react';
import { toast } from 'sonner';
import { PromptPayQr } from '@/components/common/PromptPayQr';
import { promptPayOf } from '@/lib/promptpay-qr';
import { maskPromptPayId, normalizePromptPayId, PROMPTPAY_TYPE_LABELS, type PromptPayIdType } from '@shared/promptpay';
import { askConfirm } from '@/lib/ask-dialog';

const PROMPTPAY_PLACEHOLDER: Record<PromptPayIdType, string> = {
  MOBILE: 'เช่น 081-234-5678',
  NATIONAL_ID: 'เลข 13 หลัก เช่น 1-2345-67890-12-1',
  EWALLET: 'เลข 15 หลัก',
};

const BANK_PRESETS = [
  { name: 'ธนาคารกสิกรไทย (KBank)', color: '#10b981' },
  { name: 'ธนาคารไทยพาณิชย์ (SCB)', color: '#8b5cf6' },
  { name: 'ธนาคารกรุงเทพ (BBL)', color: '#1e40af' },
  { name: 'ธนาคารกรุงไทย (KTB)', color: '#0284c7' },
  { name: 'ธนาคารกรุงศรีอยุธยา (BAY)', color: '#eab308' },
  { name: 'พร้อมเพย์ (PromptPay)', color: '#3b82f6' },
  { name: 'ธนาคารออมสิน (GSB)', color: '#ec4899' },
];

/** Card preview of a generated PromptPay QR (a ฿1.00 sample). */
function AccountPromptPayPreview({ acc }: { acc: BankAccount }) {
  const pp = promptPayOf(acc);
  if (!pp) return null;
  return (
    <div className="flex flex-col items-center py-2" data-testid="account-promptpay">
      <PromptPayQr type={pp.type} id={pp.id} amount={1} size={128} compact />
      <span className="mt-1 text-[11px] text-slate-500">ตัวอย่าง QR พร้อมเพย์ล็อกยอด (ยอดจริงสร้างตอนรับเงิน)</span>
    </div>
  );
}

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
  const [promptpayType, setPromptpayType] = useState<PromptPayIdType | ''>('');
  const [promptpayId, setPromptpayId] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Loads the data; state is only updated after the request. */
  const load = async () => {
    try {
      setAccounts(await fetchBankAccountsFromBackend());
      setLoadError(null);
    } catch (err) {
      setAccounts([]);
      setLoadError(errorMessage(err, 'ติดต่อเซิร์ฟเวอร์ไม่ได้'));
    } finally {
      setLoading(false);
    }
  };

  const reload = async () => {
    setLoading(true);
    await load();
  };

  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, []);

  const handleOpenAdd = () => {
    setEditingAccount(null);
    setBankName(BANK_PRESETS[0].name);
    setAccountName('');
    setAccountNumber('');
    setQrImageUrl(null);
    setColor(BANK_PRESETS[0].color);
    setIsDefault(accounts.length === 0);
    setPromptpayType('');
    setPromptpayId('');
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
    const pp = promptPayOf(acc);
    setPromptpayType(pp?.type ?? '');
    setPromptpayId(pp?.id ?? '');
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

  // PromptPay ID typed in the form: checked as the user types (the server checks again)
  const promptpayCheck = promptpayType && promptpayId.trim() ? normalizePromptPayId(promptpayType, promptpayId) : null;

  const handleSave = async () => {
    if (!accountName.trim()) { toast.error('กรุณาระบุชื่อบัญชี'); return; }
    if (!accountNumber.trim()) { toast.error('กรุณาระบุเลขที่บัญชี / เบอร์พร้อมเพย์'); return; }
    if (promptpayType && !promptpayId.trim()) { toast.error('กรุณาระบุหมายเลขพร้อมเพย์ หรือเลือก "ไม่ใช้"'); return; }
    if (promptpayCheck && !promptpayCheck.ok) { toast.error(promptpayCheck.error); return; }
    if (saving) return;

    const body = {
      bankName: bankName.trim(),
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      qrCodeUrl: qrImageUrl || null,
      promptpayType: promptpayCheck?.ok ? promptpayType || null : null,
      promptpayId: promptpayCheck?.ok ? promptpayCheck.id : null,
      // the first account always becomes the default one
      // (and the shop always keeps one default account)
      isDefault: isDefault || accounts.length === 0 || !!editingAccount?.isDefault,
    };

    setSaving(true);
    try {
      if (editingAccount) await api.bankAccounts.update(editingAccount.id, body);
      else await api.bankAccounts.create({ ...body, qrCodeUrl: body.qrCodeUrl || undefined, promptpayType: body.promptpayType || undefined, promptpayId: body.promptpayId || undefined });
      toast.success(`${editingAccount ? 'แก้ไข' : 'เพิ่ม'}บัญชีการเงินสำเร็จ`);
      setIsDialogOpen(false);
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, 'บันทึกบัญชีการเงินไม่สำเร็จ'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (accounts.length <= 1) {
      toast.error('ต้องมีบัญชีการเงินอย่างน้อย 1 บัญชี');
      return;
    }
    // deleting used to happen on one click, with no question
    const target = accounts.find(a => a.id === id);
    if (!(await askConfirm({ title: `ต้องการลบบัญชี "${target?.bankName || ''} ${target?.accountNumber || ''}" ใช่หรือไม่?`, confirmLabel: 'ลบบัญชี', danger: true }))) return;
    try {
      const deleting = accounts.find(a => a.id === id);
      await api.bankAccounts.delete(id);
      if (deleting?.isDefault) {
        const next = accounts.find(a => a.id !== id);
        if (next) await api.bankAccounts.setDefault(next.id);
      }
      toast.success('ลบบัญชีการเงินเรียบร้อย');
    } catch (err) {
      toast.error(errorMessage(err, 'ลบบัญชีการเงินไม่สำเร็จ'));
    }
    await reload();
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.bankAccounts.setDefault(id);
      toast.success('ตั้งเป็นบัญชีหลักเรียบร้อย');
    } catch (err) {
      toast.error(errorMessage(err, 'ตั้งบัญชีหลักไม่สำเร็จ'));
    }
    await reload();
  };

  return (
    <div className="page-shell">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="page-title">
            <Building2 /> จัดการบัญชีการเงิน & QR Code (Accounts)
          </h1>
          <p className="page-subtitle">ตั้งค่าและจัดการบัญชีธนาคารสำหรับรับโอนเงินและ QR PromptPay หน้าร้าน</p>
        </div>
        <Button onClick={handleOpenAdd} className="bg-sky-500 hover:bg-sky-600 text-white">
          <Plus className="w-4 h-4 mr-1.5" /> เพิ่มบัญชีการเงิน
        </Button>
      </div>

      {loadError && <LoadErrorState message={loadError} onRetry={() => void reload()} retrying={loading} />}

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
                <span className="tabular-nums font-bold text-xl text-slate-900">
                  {acc.accountNumber}
                </span>
              </div>

              {/* QR Code Preview: generated PromptPay QR (฿1.00 sample) first, else the uploaded image */}
              {promptPayOf(acc) ? (
                <AccountPromptPayPreview acc={acc} />
              ) : acc.qrImageUrl ? (
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
                  className="border-slate-300 text-slate-600 hover:bg-sky-50 hover:text-sky-600"
                  onClick={() => handleSetDefault(acc.id)}
                >
                  <Star className="w-3.5 h-3.5 mr-1 text-amber-500" /> ตั้งเป็นบัญชีหลัก
                </Button>
              )}
              {acc.isDefault && <div />}
              
              <div className="flex gap-btn">
                <Button variant="ghost" size="icon" aria-label={`แก้ไขบัญชี ${acc.bankName}`} className="h-8 w-8 text-slate-500 hover:text-sky-600" onClick={() => handleOpenEdit(acc)}>
                  <Edit className="w-4 h-4" />
                </Button>
                <RowDeleteMenu label="ลบบัญชีนี้" onDelete={() => handleDelete(acc.id)} />
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
                className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium outline-none focus:border-sky-500"
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
                className="border-slate-300"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">เลขที่บัญชี / เบอร์พร้อมเพย์ *</label>
              <Input
                placeholder="เช่น 081-234-5678 หรือ 123-4-56789-0"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="border-slate-300 tabular-nums"
              />
            </div>

            {/* PromptPay ID: QR with the amount locked, generated offline */}
            <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3 space-y-2">
              <label htmlFor="promptpayType" className="text-sm font-semibold text-slate-700 block">
                พร้อมเพย์สำหรับสร้าง QR ล็อกยอด (ไม่บังคับ)
              </label>
              <select
                id="promptpayType"
                data-testid="promptpay-type"
                value={promptpayType}
                onChange={(e) => setPromptpayType(e.target.value as PromptPayIdType | '')}
                className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <option value="">ไม่ใช้ (แสดงรูป QR ที่อัปโหลด)</option>
                {(Object.keys(PROMPTPAY_TYPE_LABELS) as PromptPayIdType[]).map((t) => (
                  <option key={t} value={t}>{PROMPTPAY_TYPE_LABELS[t]}</option>
                ))}
              </select>
              {promptpayType && (
                <>
                  <Input
                    aria-label="หมายเลขพร้อมเพย์"
                    data-testid="promptpay-id"
                    inputMode="numeric"
                    placeholder={PROMPTPAY_PLACEHOLDER[promptpayType]}
                    value={promptpayId}
                    onChange={(e) => setPromptpayId(e.target.value)}
                    aria-invalid={promptpayCheck ? !promptpayCheck.ok : undefined}
                    className="border-slate-300 bg-white tabular-nums"
                  />
                  {promptpayCheck && !promptpayCheck.ok && (
                    <p role="alert" className="text-xs font-semibold text-red-600">{promptpayCheck.error}</p>
                  )}
                  {promptpayCheck?.ok && (
                    <div className="flex items-center gap-3">
                      <PromptPayQr type={promptpayType} id={promptpayCheck.id} amount={1} accountName={accountName.trim() || undefined} size={120} compact />
                      <p className="text-xs text-slate-600">
                        ตัวอย่าง QR ฿1.00 ลองสแกนด้วยแอปธนาคารได้ (ไม่ต้องโอน) ตอนรับเงินระบบจะสร้าง QR ตามยอดจริง
                        <br />แสดงหมายเลขแบบซ่อน: <b className="tabular-nums">{maskPromptPayId(promptpayType, promptpayCheck.id)}</b>
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* QR Code Upload (fallback, e.g. merchant QR such as K Shop that cannot be generated) */}
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">
                รูป QR Code สแกนจ่าย {promptpayType ? '(สำรอง)' : ''}
              </label>
              <p className="text-xs text-slate-500 mb-1.5">ใช้เมื่อไม่ได้ตั้งพร้อมเพย์ เช่น QR ร้านค้า K Shop / แม่มณี</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-300 rounded-xl p-4 bg-slate-50 hover:bg-slate-100 cursor-pointer flex flex-col items-center justify-center gap-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
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
              </button>
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

          <DialogFooter className="gap-btn pt-3 border-t border-slate-100">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="border-slate-300 text-slate-600">
              ยกเลิก
            </Button>
            <Button onClick={handleSave} disabled={saving} data-testid="account-save" className="bg-sky-500 hover:bg-sky-600 text-white">
              บันทึกบัญชี
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
