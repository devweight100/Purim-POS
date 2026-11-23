'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, UserRound, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { fetchCustomers, loadCustomers, type Customer } from '@/lib/customer-service';
import { useCartStore } from '@/lib/store/cart-store';
import { canUseWalkInLevel, finishStart, usePosLevels, usePosStart } from '@/lib/pos/pos-add';
import type { PriceLevel } from '@shared/price-level';

/**
 * Start-of-bill choice (setting "เลือกลูกค้าก่อนเริ่มบิลทุกครั้ง", docs/pos-price-level.md): opened by the first item
 * of a new bill, which waits and goes in after the choice. Keyboard: type to search members, ↑/↓ + Enter picks one;
 * Enter on an empty search (or Escape) = ลูกค้าทั่วไป · ราคาปลีก; Tab reaches the walk-in level buttons (Alt+1..5).
 */
export function PosStartDialog() {
  const open = usePosStart((s) => s.open);
  const pending = usePosStart((s) => s.pending);
  const { names, used } = usePosLevels();
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>(() => loadCustomers());
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchCustomers().then((list) => alive && setCustomers(list), () => undefined);
    return () => {
      alive = false;
    };
  }, [open]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q) || (c.code || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [customers, search]);

  const close = () => {
    setSearch('');
    setActive(0);
  };

  const pickMember = (c: Customer) => {
    useCartStore.getState().setCustomer(c.id, c.name, c.priceLevel);
    close();
    finishStart();
  };
  const pickWalkIn = (level: PriceLevel) => {
    if (!canUseWalkInLevel(level)) {
      toast.error('ขายราคานี้ให้ลูกค้าทั่วไปต้องมีสิทธิ์ให้ส่วนลด (ตั้งค่า > การขายและใบเสร็จ)');
      return;
    }
    useCartStore.getState().setWalkInLevel(level);
    close();
    finishStart();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey && /^[1-5]$/.test(e.key)) {
      const l = Number(e.key) as PriceLevel;
      if (used.includes(l)) {
        e.preventDefault();
        pickWalkIn(l);
      }
      return;
    }
    if (e.target !== inputRef.current) return;
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length) pickMember(results[Math.min(active, results.length - 1)]);
      else if (!search.trim()) pickWalkIn(1);
      else toast.error(`ไม่พบสมาชิก "${search.trim()}"`);
    }
  };

  const first = pending[0];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Escape / outside click = the default: walk-in, retail (the waiting item still goes in)
        if (!o && usePosStart.getState().open) pickWalkIn(1);
      }}
    >
      <DialogContent className="w-[95vw] sm:max-w-xl" data-testid="pos-start-dialog" initialFocus={inputRef} onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">เริ่มบิลใหม่: ลูกค้าและราคา</DialogTitle>
          <DialogDescription>
            {first ? (
              <>
                รายการแรก <b className="font-medium text-slate-900">{first.product.name}</b>
                {pending.length > 1 ? ` และอีก ${pending.length - 1} รายการ` : ''} จะใส่ตะกร้าหลังเลือก
              </>
            ) : (
              'เลือกสมาชิก หรือขายลูกค้าทั่วไปตามระดับราคา'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label htmlFor="pos-start-search" className="text-sm font-medium text-slate-700">สมาชิก</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="pos-start-search"
              ref={inputRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActive(0);
              }}
              placeholder="ค้นหาชื่อ เบอร์โทร หรือรหัสสมาชิก"
              className="h-11 pl-9 text-base"
              autoComplete="off"
            />
          </div>
          {results.length > 0 && (
            <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200" role="listbox" aria-label="สมาชิกที่ค้นพบ">
              {results.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => pickMember(c)}
                    onMouseEnter={() => setActive(i)}
                    className={cn('flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left', i === active ? 'bg-sky-50' : 'hover:bg-slate-50')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{c.name}</span>
                      <span className="block text-sub text-muted-foreground">{c.phone || '-'}{c.code ? ` · ${c.code}` : ''}</span>
                    </span>
                    <span className="shrink-0 text-sub text-muted-foreground">{names[c.priceLevel as PriceLevel] ?? `ราคา ${c.priceLevel}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.trim() && results.length === 0 && <p className="text-sub text-muted-foreground">ไม่พบสมาชิก</p>}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-700">ลูกค้าทั่วไป (ไม่ระบุชื่อ)</div>
          <div className={cn('grid gap-btn', used.length > 3 ? 'grid-cols-2 sm:grid-cols-3' : used.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
            {used.map((l) => {
              const allowed = canUseWalkInLevel(l);
              return (
                <button
                  key={l}
                  type="button"
                  data-testid={`pos-start-level-${l}`}
                  disabled={!allowed}
                  onClick={() => pickWalkIn(l)}
                  title={allowed ? `Alt+${l}` : 'ต้องมีสิทธิ์ให้ส่วนลด'}
                  className={cn(
                    'flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border px-3 py-2 text-center outline-none transition-colors',
                    'focus-visible:ring-3 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-50',
                    l === 1 ? 'border-indigo-300 bg-indigo-50 text-indigo-900 hover:bg-indigo-100' : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sub text-muted-foreground">
                    {l === 1 ? <UserRound className="size-3.5" /> : <Users className="size-3.5" />}
                    ลูกค้าทั่วไป · Alt+{l}
                  </span>
                  <span className="text-base font-semibold">{names[l]}</span>
                </button>
              );
            })}
          </div>
          <p className="text-sub text-muted-foreground">Enter (ช่องค้นหาว่าง) หรือ Esc = ลูกค้าทั่วไป · {names[1]}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
