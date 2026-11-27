'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
  /** small text before the label (an emoji icon) */
  icon?: string;
}

/**
 * A select you can type into (combobox, docs/po-grid-entry.md): typing filters the options (any part of the name,
 * any case), ↑/↓ move, Enter picks, Esc closes the list (and puts the chosen name back), click / Alt+↓ opens.
 * Enter / Esc are kept by the list only while it is open, so a form's "Enter = save" and a dialog's "Esc = close"
 * work as before when it is closed. `emptyLabel` is the "none" choice (value '').
 */
export function SearchableSelect({
  id, value, options, onChange, placeholder = 'พิมพ์เพื่อค้นหา', emptyLabel, noMatchText = 'ไม่พบรายการ', className = '', testId,
}: {
  id?: string;
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  noMatchText?: string;
  className?: string;
  testId?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value) || null;
  const all = useMemo(() => (emptyLabel !== undefined ? [{ value: '', label: emptyLabel }, ...options] : options), [options, emptyLabel]);
  const shown = useMemo(() => {
    const q = (typed ?? '').trim().toLowerCase();
    return q ? all.filter((o) => o.value !== '' && o.label.toLowerCase().includes(q)) : all;
  }, [all, typed]);
  const text = typed ?? (selected ? `${selected.icon ? selected.icon + ' ' : ''}${selected.label}` : '');

  const openList = () => {
    const i = shown.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    setOpen(true);
  };
  const close = () => { setOpen(false); setTyped(null); };
  const pick = (o: SearchableOption) => { onChange(o.value); close(); };
  const move = (dir: 1 | -1) => {
    if (!open) { openList(); return; }
    if (!shown.length) return;
    const i = (active + dir + shown.length) % shown.length;
    setActive(i);
    listRef.current?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && open) {
      e.preventDefault();
      e.stopPropagation();
      const o = shown[active];
      if (o) pick(o);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab' && open) {
      close();
    }
  };

  return (
    <div className={`relative ${className}`} data-testid={testId}>
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        value={text}
        placeholder={selected ? '' : emptyLabel || placeholder}
        onChange={(e) => { setTyped(e.target.value); setActive(0); setOpen(true); }}
        onFocus={(e) => e.currentTarget.select()}
        onClick={() => (open ? undefined : openList())}
        onBlur={() => setTimeout(close, 120)}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-sm text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{noMatchText}</li>}
          {shown.map((o, i) => (
            <li
              key={o.value || '__none'}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ${i === active ? 'bg-sky-50 text-fg ring-1 ring-sky-300' : 'text-fg hover:bg-slate-50'} ${o.value === value ? 'font-medium' : ''} ${o.value === '' ? 'text-muted-foreground' : ''}`}
            >
              {o.icon ? `${o.icon} ` : ''}{o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
