'use client';

import { useId, useRef, type KeyboardEvent } from 'react';
import { DOC_NAME_MODES, DOC_NAME_MODE_LABELS, type DocNameMode } from '@shared/product-names';

/**
 * "ใช้ชื่อร้าน / ใช้ชื่อผู้ผลิต": which product names a supplier document prints (docs/product-names.md).
 * A radio group: Tab reaches the selected choice, ←/→ (or ↑/↓) switch, Space / Enter / click pick.
 */
export function DocNameModeToggle({
  value,
  onChange,
  disabled,
  label = 'ชื่อสินค้าบนเอกสาร',
  className = '',
}: {
  value: DocNameMode;
  onChange: (mode: DocNameMode) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelId = useId();
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + DOC_NAME_MODES.length) % DOC_NAME_MODES.length;
    refs.current[next]?.focus();
    onChange(DOC_NAME_MODES[next]);
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span id={labelId} className="text-xs font-bold text-slate-600 whitespace-nowrap">{label}</span>
      <div role="radiogroup" aria-labelledby={labelId} data-testid="doc-name-mode" className="inline-flex gap-2 rounded-lg bg-slate-100 p-1">
        {DOC_NAME_MODES.map((mode, i) => {
          const on = value === mode;
          return (
            <button
              key={mode}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(mode)}
              onKeyDown={(e) => onKey(e, i)}
              title={mode === 'SUPPLIER' ? 'ชื่อ/รหัสสินค้าของผู้ขายรายนี้ → ชื่อผู้ผลิต → ชื่อร้าน' : 'ชื่อสินค้าของร้าน'}
              className={`h-8 rounded-md px-3 text-xs font-bold whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-50 ${
                on ? 'bg-white text-sky-700 shadow-sm ring-1 ring-sky-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {DOC_NAME_MODE_LABELS[mode]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
