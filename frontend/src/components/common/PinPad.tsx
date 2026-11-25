'use client';

import { forwardRef, useEffect, useEffectEvent, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Delete } from 'lucide-react';
import { applyPinKey, cleanPin, PIN_MAX_LENGTH, readPadKey } from '@/lib/keyboard/pad-keys';
import { subscribeBurstAware } from '@/lib/pos/scan-burst';
import { cn } from '@/lib/utils';

interface PinPadProps {
  value: string;
  onChange: (pin: string) => void;
  /** Enter (keyboard or the field): the dialog's primary action */
  onSubmit: () => void;
  /** label of the PIN field (screen readers, tests) */
  label?: string;
  id?: string;
  disabled?: boolean;
  maxLength?: number;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

/**
 * The one PIN pad of the app (manager approval at payment / claims / cash drawer, data export), docs/pos-keyboard-scan.md.
 * The PIN field takes the keyboard: digits from the main row (also in the Thai layout) and the numeric keypad,
 * Backspace, Delete = clear, Enter = onSubmit; Escape is left to the dialog (cancel). The on-screen keys do the same
 * and keep the focus in the field, so mouse and keyboard can be mixed. Give the field the dialog's initial focus
 * (forwarded ref).
 */
export const PinPad = forwardRef<HTMLInputElement, PinPadProps>(function PinPad(
  { value, onChange, onSubmit, label = 'PIN', id = 'pin-pad-input', disabled = false, maxLength = PIN_MAX_LENGTH },
  ref,
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const setRefs = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  // a barcode scanner burst on the POS page must not leave digits in the PIN (lib/pos/scan-burst.ts)
  const currentValue = useEffectEvent(() => value);
  const changeTo = useEffectEvent((pin: string) => onChange(pin));
  useEffect(() => {
    let saved = '';
    return subscribeBurstAware({
      snapshot: () => {
        saved = currentValue();
      },
      restore: () => changeTo(saved),
    });
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const k = readPadKey(e);
    if (!k || k.kind === 'escape') return; // Escape: the dialog closes (cancel)
    e.preventDefault();
    if (e.repeat && k.kind === 'enter') return;
    if (k.kind === 'enter') {
      e.stopPropagation();
      if (!disabled) onSubmit();
      return;
    }
    if (disabled) return;
    onChange(applyPinKey(value, k, maxLength));
  };

  const press = (key: (typeof KEYS)[number]) => {
    if (disabled) return;
    if (key === 'back') onChange(value.slice(0, -1));
    else if (key === 'clear') onChange('');
    else onChange(applyPinKey(value, { kind: 'digit', digit: key }, maxLength));
    innerRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-2" data-testid="pin-pad">
      <input
        ref={setRefs}
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        maxLength={maxLength}
        value={value}
        disabled={disabled}
        // typing is handled in onKeyDown (by physical key); onChange only sees paste / autofill
        onChange={(e) => onChange(cleanPin(e.target.value, maxLength))}
        onKeyDown={onKeyDown}
        placeholder={`PIN 4-${maxLength} หลัก`}
        className="h-11 [@media(max-height:700px)]:h-9 w-full rounded-xl border border-slate-300 bg-white text-center text-2xl tracking-[0.5em] text-slate-900 outline-none placeholder:text-sm placeholder:tracking-normal placeholder:text-slate-400 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/30"
      />
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="แป้นตัวเลข">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            // keep the focus (and so the keyboard) in the PIN field
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => press(k)}
            aria-label={k === 'back' ? 'ลบตัวท้าย' : k === 'clear' ? 'ล้าง PIN' : k}
            className={cn(
              'h-10 [@media(max-height:700px)]:h-8 rounded-xl border text-lg font-semibold transition-colors disabled:opacity-50',
              k === 'back' || k === 'clear'
                ? 'border-slate-200 bg-slate-50 text-sm text-slate-600 hover:bg-slate-100'
                : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-100',
            )}
          >
            {k === 'back' ? <Delete className="mx-auto h-5 w-5" /> : k === 'clear' ? 'ล้าง' : k}
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-slate-500">พิมพ์ PIN ด้วยแป้นตัวเลขได้เลย · Enter = ยืนยัน · Esc = ยกเลิก</p>
    </div>
  );
});
