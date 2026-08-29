'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useState, useEffect, useMemo } from 'react';
import { Search, UserPlus, Building2, User, Coins, CreditCard, Tag, CheckCircle2 } from 'lucide-react';
import { useCartStore } from '@/lib/store/cart-store';
import { Customer, loadCustomers, upsertCustomer } from '@/lib/customer-service';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

interface CustomerSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CustomerSelectModal({ open, onOpenChange }: CustomerSelectModalProps) {
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickType, setQuickType] = useState<'INDIVIDUAL' | 'COMPANY'>('INDIVIDUAL');
  const [quickTaxId, setQuickTaxId] = useState('');
  const [quickPriceLevel, setQuickPriceLevel] = useState<number>(1);

  const cart = useCartStore();

  const reloadData = () => {
    setCustomers(loadCustomers());
  };

  useEffect(() => {
    if (open) {
      reloadData();
      setIsQuickAddOpen(false);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.taxId && c.taxId.includes(q)) ||
        (c.companyName && c.companyName.toLowerCase().includes(q)) ||
        (c.code && c.code.toLowerCase().includes(q))
    );
  }, [customers, search]);

  const handleSelect = (customer: Customer | null) => {
    if (!customer) {
      cart.setCustomer(null, '');
      toast.info('เปลี่ยนเป็นลูกค้าทั่วไป (Walk-in)');
    } else {
      cart.setCustomer(customer.id, customer.name);
      toast.success(
        `เลือกลูกค้า: ${customer.name} (ระดับราคา ${customer.priceLevel || 1} • แต้มสะสม ${customer.points || 0})`
      );
    }
    onOpenChange(false);
  };

  const handleQuickAdd = () => {
    if (!quickName.trim()) {
      toast.error('กรุณากรอกชื่อลูกค้า / ชื่อบริษัท');
      return;
    }
    if (!quickPhone.trim()) {
      toast.error('กรุณากรอกเบอร์โทรศัพท์');
      return;
    }

    const res = upsertCustomer({
      type: quickType,
      name: quickName.trim(),
      phone: quickPhone.trim(),
      taxId: quickTaxId.trim(),
      priceLevel: quickPriceLevel as any,
    });

    if (res.success) {
      toast.success(`เพิ่มลูกค้า "${res.customer.name}" สำเร็จ`);
      reloadData();
      handleSelect(res.customer);
      setQuickName('');
      setQuickPhone('');
      setQuickTaxId('');
      setIsQuickAddOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white text-slate-900 border-slate-200 w-[95vw] sm:max-w-lg p-0 overflow-hidden rounded-2xl shadow-2xl">
        <DialogHeader className="border-b border-slate-200 px-6 py-4.5 bg-slate-50 shrink-0">
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2.5">
            <UserPlus className="w-6 h-6 text-sky-500" />
            เลือกลูกค้าสมาชิก (POS Member Select)
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500 font-medium mt-0.5">
            เลือกลูกค้าสำหรับบิลนี้ เพื่อสะสมแต้ม ใช้วงเงินเครดิต และดึงระดับราคาขาย
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 space-y-4">
          {!isQuickAddOpen ? (
            <>
              {/* Search & Quick Add Toggle */}
              <div className="flex gap-2 shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    placeholder="พิมพ์ค้นหาชื่อ, เบอร์โทร, เลขผู้เสียภาษี Tax ID..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-11 bg-slate-50 border-slate-300 h-12 text-base font-semibold rounded-xl placeholder:font-normal"
                    autoFocus
                  />
                </div>
                <Button
                  onClick={() => setIsQuickAddOpen(true)}
                  className="bg-sky-500 hover:bg-sky-600 text-white font-extrabold h-12 text-sm px-4 shadow-xs rounded-xl gap-1.5"
                  title="สมัครสมาชิกด่วนหน้าร้าน"
                >
                  <UserPlus className="w-4 h-4" />
                  เพิ่มด่วน
                </Button>
              </div>

              {/* Customer List */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50 max-h-80 overflow-y-auto divide-y divide-slate-200/80">
                {filtered.map((c) => {
                  const isCompany = c.type === 'COMPANY';
                  const isSelected = cart.customerId === c.id;

                  return (
                    <div
                      key={c.id}
                      className={`p-3.5 sm:p-4 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-sky-100/90 border-l-4 border-l-sky-600'
                          : 'hover:bg-slate-100/90'
                      }`}
                      onClick={() => handleSelect(c)}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-900 text-base sm:text-lg truncate">{c.name}</span>
                          {isCompany ? (
                            <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 text-xs px-2 py-0.5 font-bold shrink-0">
                              🏢 บริษัท
                            </Badge>
                          ) : (
                            <Badge className="bg-slate-200 text-slate-700 border-slate-300 text-xs px-2 py-0.5 font-semibold shrink-0">
                              บุคคล
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-slate-600 font-medium mt-1 flex flex-wrap items-center gap-2.5">
                          <span className="font-bold text-slate-800">📞 {c.phone}</span>
                          {c.taxId && <span>• Tax ID: <b className="font-mono text-slate-700">{c.taxId}</b></span>}
                          {c.creditLimit > 0 && (
                            <span className="text-indigo-700 font-bold">
                              • วงเงินเครดิต: {formatCurrency(c.creditLimit)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right Badges: Price Level & Points */}
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-black bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                          <Coins className="w-4 h-4 text-amber-600" />
                          <span>{(c.points || 0).toLocaleString()} แต้ม</span>
                        </div>
                        <span className="text-xs text-sky-800 font-extrabold bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
                          ราคา {c.priceLevel ? `ระดับ ${c.priceLevel}` : 'ปกติ'}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {filtered.length === 0 && (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    ไม่พบข้อมูลลูกค้าที่ค้นหา สามารถกดปุ่ม <b>"เพิ่มด่วน"</b> ด้านบนเพื่อสมัครสมาชิกได้ทันที
                  </div>
                )}
              </div>

              {/* Reset to Walk-in Customer */}
              <Button
                variant="ghost"
                className="w-full text-slate-700 hover:text-slate-900 border border-slate-300 hover:bg-slate-100 h-11 text-sm font-bold rounded-xl"
                onClick={() => handleSelect(null)}
              >
                ล้างการเลือกลูกค้า (เป็นลูกค้าทั่วไป Walk-in)
              </Button>
            </>
          ) : (
            /* Quick Add Customer Form */
            <div className="space-y-3.5 text-sm">
              <div className="font-black text-slate-900 text-base flex items-center justify-between">
                <span>สมัครสมาชิกลูกค้าใหม่ (ด่วน)</span>
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="text-sm font-bold text-slate-400 hover:text-slate-600"
                >
                  ย้อนกลับ
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setQuickType('INDIVIDUAL')}
                  className={`p-2.5 rounded-xl border text-sm font-bold text-center transition-all ${
                    quickType === 'INDIVIDUAL'
                      ? 'border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-400/30'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  👤 บุคคลธรรมดา
                </button>
                <button
                  type="button"
                  onClick={() => setQuickType('COMPANY')}
                  className={`p-2.5 rounded-xl border text-sm font-bold text-center transition-all ${
                    quickType === 'COMPANY'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-800 ring-2 ring-indigo-400/30'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  🏢 นิติบุคคล/บริษัท
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 text-sm">ชื่อลูกค้า / ชื่อบริษัท *</label>
                <Input
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  placeholder="เช่น คุณสมศรี / บริษัท ปุริม จำกัด"
                  className="h-11 text-sm font-medium rounded-xl"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-700 text-sm">เบอร์โทรศัพท์ *</label>
                  <Input
                    value={quickPhone}
                    onChange={(e) => setQuickPhone(e.target.value)}
                    placeholder="เช่น 081-999-8888"
                    className="h-11 font-mono text-sm rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-slate-700 text-sm">เลขผู้เสียภาษี (Tax ID)</label>
                  <Input
                    maxLength={13}
                    value={quickTaxId}
                    onChange={(e) => setQuickTaxId(e.target.value)}
                    placeholder="13 หลัก (ถ้ามี)"
                    className="h-11 font-mono text-sm rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 text-sm">ระดับราคาขายเริ่มต้น</label>
                <select
                  value={quickPriceLevel}
                  onChange={(e) => setQuickPriceLevel(Number(e.target.value))}
                  className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3 font-bold text-slate-800 text-sm outline-none"
                >
                  <option value={1}>ระดับ 1 (ราคาปกติทั่วไป)</option>
                  <option value={2}>ระดับ 2 (ราคาสมาชิก)</option>
                  <option value={3}>ระดับ 3 (ช่าง / ขายส่ง)</option>
                  <option value={4}>ระดับ 4 (ลูกค้า VIP)</option>
                  <option value={5}>ระดับ 5 (ตัวแทน)</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="flex-1 h-9 text-xs"
                >
                  ยกเลิก
                </Button>
                <Button
                  onClick={handleQuickAdd}
                  className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-bold h-9 text-xs"
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" /> บันทึกและเลือกลูกค้า
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
