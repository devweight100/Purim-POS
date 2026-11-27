'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState, useEffect, useMemo } from 'react';
import { Search, UserPlus, MapPin, CheckCircle2 } from 'lucide-react';
import { useCartStore } from '@/lib/store/cart-store';
import { Customer, fetchCustomers, upsertCustomer } from '@/lib/customer-service';
import { LoadErrorState, errorMessage } from '@/components/common/LoadErrorState';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import { useHasChanged } from '@/lib/pos/use-has-changed';
import { canUseWalkInLevel, usePosLevels } from '@/lib/pos/pos-add';
import type { PriceLevel } from '@shared/price-level';
import { useEnterSubmit } from '@/lib/keyboard/enter-submit';
import { memberAddress, memberSearchText } from '@/lib/pos/member-scan';

interface CustomerSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** opened by the POS after a sale (setting posPickMemberAfterSale, docs/pos-member-picker.md) */
  autoOpened?: boolean;
}

/** search box of the picker (focus rescue after a sale) */
const SEARCH_ID = 'pos-member-search';

export function CustomerSelectModal({ open, onOpenChange, autoOpened = false }: CustomerSelectModalProps) {
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickType, setQuickType] = useState<'INDIVIDUAL' | 'COMPANY'>('INDIVIDUAL');
  const [quickTaxId, setQuickTaxId] = useState('');
  const [quickPriceLevel, setQuickPriceLevel] = useState<number>(1);
  /** keyboard highlight in the member list */
  const [hi, setHi] = useState(0);
  const [hiMoved, setHiMoved] = useState(false);

  const cart = useCartStore();
  const levels = usePosLevels();

  const [loadError, setLoadError] = useState<string | null>(null);
  const reloadData = async () => {
    try {
      setCustomers(await fetchCustomers());
      setLoadError(null);
    } catch (err) {
      setCustomers([]);
      setLoadError(errorMessage(err, 'ติดต่อเซิร์ฟเวอร์ไม่ได้'));
    }
  };

  const resetForm = () => {
    setSearch('');
    setHi(0);
    setHiMoved(false);
    setIsQuickAddOpen(false);
    setQuickName('');
    setQuickPhone('');
    setQuickType('INDIVIDUAL');
    setQuickTaxId('');
    setQuickPriceLevel(1);
  };

  // opening or closing clears the search and the quick-add form
  const openChanged = useHasChanged(open);
  if (openChanged) resetForm();

  // load the customer list from the server when opening
  useEffect(() => {
    if (!open) return;
    const load = async () => {
      await reloadData();
    };
    void load();
  }, [open]);

  const handleModalClose = (isOpen: boolean) => {
    if (!isOpen) {
      resetForm();
    }
    onOpenChange(isOpen);
  };

  // name, phone, member code, tax id, company and address (the list is in memory: cheap)
  const searchable = useMemo(() => customers.map((c) => ({ c, text: memberSearchText(c) })), [customers]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return customers;
    return searchable.filter((r) => r.text.includes(q)).map((r) => r.c);
  }, [customers, searchable, search]);

  // opened after a sale: the search keeps the focus (the receipt print frame / the payment dialog's focus return
  // may take it a moment later); only while nothing else in the picker has it
  useEffect(() => {
    if (!open || !autoOpened) return;
    const rescue = () => {
      const input = document.getElementById(SEARCH_ID) as HTMLInputElement | null;
      if (!input) return;
      const a = document.activeElement as HTMLElement | null;
      const lost = !a || a === document.body || a.tagName === 'IFRAME' || a.hasAttribute('data-barcode-input') || !a.closest('[role="dialog"]');
      if (lost) input.focus({ preventScroll: true });
    };
    const timers = [0, 60, 150, 400, 1000, 1800, 3000].map((ms) => setTimeout(rescue, ms));
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.hasAttribute?.('data-barcode-input')) setTimeout(rescue, 0);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, autoOpened]);

  const handleSelect = (customer: Customer | null) => {
    if (!customer) {
      cart.setCustomer(null, '');
      toast.info('เปลี่ยนเป็นลูกค้าทั่วไป (Walk-in)');
    } else {
      cart.setCustomer(customer.id, customer.name, customer.priceLevel);
      toast.success(
        `เลือกลูกค้า: ${customer.name} (${levels.names[(customer.priceLevel || 1) as PriceLevel]} • แต้มสะสม ${customer.points || 0})`
      );
    }
    onOpenChange(false);
  };

  const handleWalkIn = (level: number) => {
    cart.setWalkInLevel(level);
    toast.info(`ลูกค้าทั่วไป · ${levels.names[level as PriceLevel]}`);
    onOpenChange(false);
  };

  // keyboard: ↑/↓ in the search box moves the highlight, Enter picks it (docs/pos-keyboard-scan.md)
  const hiIndex = Math.min(hi, Math.max(0, filtered.length - 1));
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!filtered.length) return;
      e.preventDefault();
      const next = (hiIndex + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
      setHi(next);
      setHiMoved(true);
      document.querySelector(`[data-customer-row="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      // Enter picks the highlighted member once something was typed or the highlight was moved
      if (filtered.length && (search.trim() || hiMoved)) handleSelect(filtered[hiIndex]);
    }
  };

  const handleQuickAdd = async () => {
    if (!quickName.trim()) {
      toast.error('กรุณากรอกชื่อลูกค้า / ชื่อบริษัท');
      return;
    }
    if (!quickPhone.trim()) {
      toast.error('กรุณากรอกเบอร์โทรศัพท์');
      return;
    }

    try {
    const res = await upsertCustomer({
      type: quickType,
      name: quickName.trim(),
      phone: quickPhone.trim(),
      taxId: quickTaxId.trim(),
      priceLevel: quickPriceLevel as Customer['priceLevel'],
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
    } catch (error) { toast.error('บันทึกลูกค้าไม่ได้: ' + (error instanceof Error ? error.message : String(error))); }
  };

  // quick add form: Enter = บันทึก (the search box handles its own Enter)
  const onEnter = useEnterSubmit(handleQuickAdd, { disabled: !isQuickAddOpen });

  return (
    <Dialog open={open} onOpenChange={handleModalClose}>
      <DialogContent
        onKeyDown={onEnter}
        data-testid="pos-member-picker"
        className="flex flex-col gap-0 bg-white text-slate-900 border-slate-200 w-[calc(100vw-2rem)] sm:max-w-[920px] h-[min(820px,calc(100dvh-2rem))] p-0 overflow-hidden rounded-2xl shadow-2xl"
      >
        <DialogHeader className="border-b border-slate-200 pl-6 pr-16 py-4 bg-slate-50 shrink-0">
          <DialogTitle className="text-xl font-semibold text-slate-900 flex items-center gap-2.5">
            <UserPlus className="w-6 h-6 text-sky-500 shrink-0" />
            เลือกลูกค้าสมาชิก
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500 mt-0.5">
            {autoOpened
              ? 'รับชำระเงินแล้ว · เลือกสมาชิกสำหรับบิลถัดไป (พิมพ์/สแกนรหัสสมาชิกหรือเบอร์โทร) · สแกนสินค้าได้เลย · Esc = ไม่ระบุสมาชิก'
              : 'เลือกลูกค้าสำหรับบิลนี้ เพื่อสะสมแต้ม ใช้วงเงินเครดิต และดึงระดับราคาขาย'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 sm:p-5">
          {!isQuickAddOpen ? (
            <>
              {/* Search & Quick Add Toggle */}
              <div className="flex gap-2 shrink-0">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    id={SEARCH_ID}
                    placeholder="พิมพ์ค้นหาชื่อ, เบอร์โทร, รหัสสมาชิก, ที่อยู่, เลขผู้เสียภาษี..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setHi(0);
                    }}
                    onKeyDown={onSearchKeyDown}
                    aria-label="ค้นหาลูกค้า (↑/↓ เลือก · Enter = เลือกลูกค้า)"
                    className="pl-11 bg-slate-50 border-slate-300 h-12 text-base font-medium rounded-xl placeholder:font-normal"
                    autoFocus
                  />
                </div>
                <Button
                  onClick={() => setIsQuickAddOpen(true)}
                  size="lg"
                  className="shrink-0 h-12 rounded-xl"
                  title="สมัครสมาชิกด่วนหน้าร้าน"
                >
                  <UserPlus className="w-4 h-4" />
                  เพิ่มด่วน
                </Button>
              </div>

              {/* Customer List */}
              <div
                className="flex-1 min-h-0 border border-slate-200 rounded-xl overflow-y-auto overflow-x-hidden bg-white divide-y divide-slate-200/80"
                data-testid="pos-member-list"
              >
                {filtered.map((c, idx) => {
                  const isCompany = c.type === 'COMPANY';
                  const isSelected = cart.customerId === c.id;
                  const isHi = idx === hiIndex && (!!search.trim() || hiMoved);
                  const address = memberAddress(c);

                  return (
                    <div
                      key={c.id}
                      data-customer-row={idx}
                      data-highlighted={isHi || undefined}
                      className={`px-4 py-3 cursor-pointer flex items-center gap-4 min-w-0 ${isHi ? 'ring-2 ring-inset ring-sky-500 ' : ''}${
                        isSelected ? 'bg-sky-50 border-l-4 border-l-sky-600' : 'hover:bg-slate-50'
                      }`}
                      onClick={() => handleSelect(c)}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-semibold text-slate-900 text-base truncate" title={c.name}>{c.name}</span>
                          <span className="text-sub text-muted-foreground shrink-0">{isCompany ? 'บริษัท' : 'บุคคล'}</span>
                        </div>
                        <div className="text-sm text-slate-600 flex items-center gap-x-3 gap-y-0.5 min-w-0 flex-wrap">
                          <span className="tabular-nums font-medium text-slate-800">{c.phone || '-'}</span>
                          {c.code && <span className="doc-no text-muted-foreground">{c.code}</span>}
                          {c.taxId && <span className="text-muted-foreground">Tax ID {c.taxId}</span>}
                          {c.creditLimit > 0 && (
                            <span className="text-muted-foreground">วงเงินเครดิต {formatCurrency(c.creditLimit)}</span>
                          )}
                        </div>
                        <div
                          className={`text-sm flex items-center gap-1.5 min-w-0 ${address ? 'text-slate-600' : 'text-subtle'}`}
                          title={address || undefined}
                          data-testid="pos-member-address"
                        >
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{address || 'ไม่มีที่อยู่'}</span>
                        </div>
                      </div>

                      {/* points and price level */}
                      <div className="flex flex-col items-end gap-0.5 shrink-0 text-right">
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">{(c.points || 0).toLocaleString()} แต้ม</span>
                        <span className="text-sub text-muted-foreground">{levels.names[(c.priceLevel || 1) as PriceLevel]}</span>
                      </div>
                    </div>
                  );
                })}

                {loadError && (
                  <LoadErrorState message={loadError} onRetry={() => void reloadData()} className="m-3" />
                )}

                {!loadError && filtered.length === 0 && (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    ไม่พบข้อมูลลูกค้าที่ค้นหา สามารถกดปุ่ม <b>&quot;เพิ่มด่วน&quot;</b> ด้านบนเพื่อสมัครสมาชิกได้ทันที
                  </div>
                )}
              </div>

              {/* Walk-in customer at a price level (no member): also clears the member */}
              <div className="space-y-2 shrink-0">
                <div className="text-sm font-medium text-slate-700">ลูกค้าทั่วไป (ไม่ระบุชื่อ) · ล้างการเลือกสมาชิก</div>
                <div className="flex flex-wrap gap-btn">
                  {levels.used.map((l) => (
                    <Button
                      key={l}
                      variant={!cart.customerId && cart.priceLevel === l ? 'default' : 'outline'}
                      data-testid={`pos-walkin-btn-${l}`}
                      disabled={!canUseWalkInLevel(l)}
                      title={canUseWalkInLevel(l) ? undefined : 'ต้องมีสิทธิ์ให้ส่วนลด'}
                      onClick={() => handleWalkIn(l)}
                    >
                      ลูกค้าทั่วไป · {levels.names[l]}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            /* Quick Add Customer Form */
            <div className="space-y-3.5 text-sm overflow-y-auto min-h-0">
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
                  {([1, 2, 3, 4, 5] as PriceLevel[]).map((l) => (
                    <option key={l} value={l}>ราคา {l} · {levels.names[l]}</option>
                  ))}
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
