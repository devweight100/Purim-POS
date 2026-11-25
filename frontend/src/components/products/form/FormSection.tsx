"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

const STORE_KEY = "purim-product-form-collapsed";

function readCollapsed(): string[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function writeCollapsed(ids: string[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(ids));
  } catch {
    // private window / blocked storage: the sections simply open again next time
  }
}

/**
 * One section of the product form's "ข้อมูลเพิ่มเติม" (docs/product-form-bank-logos.md): a card whose title is a
 * button (Enter / Space opens / closes it, Tab reaches it like any field). Open by default; a section the user
 * closed stays closed on this computer (a per-viewer convenience in localStorage, nothing else depends on it).
 */
export function FormSection({ id, icon, title, note, actions, children, className = "", testId }: {
  /** stable key for the remembered open / closed state */
  id: string;
  icon: ReactNode;
  title: ReactNode;
  /** muted text after the title (counts, hints) */
  note?: ReactNode;
  /** buttons on the right of the header (only while open) */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const bodyId = useId();
  const [open, setOpen] = useState(() => (typeof window === "undefined" ? true : !readCollapsed().includes(id)));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    const ids = readCollapsed().filter((x) => x !== id);
    writeCollapsed(next ? ids : [...ids, id]);
  };
  return (
    <section data-testid={testId} data-section={id} className={`rounded-xl border border-slate-200 bg-white ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-btn px-5 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="-mx-1 flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
          <span className="shrink-0 text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
          <h3 className="font-semibold text-slate-900">{title}</h3>
          {note && <span className="truncate text-sub text-muted-foreground">{note}</span>}
        </button>
        {open && actions && <div className="flex flex-wrap items-center gap-btn">{actions}</div>}
      </div>
      {open && (
        <div id={bodyId} className="px-5 pb-5">
          {children}
        </div>
      )}
    </section>
  );
}
