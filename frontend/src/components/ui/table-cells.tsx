import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared column classes of back-office tables (owner 2026-11-18, round 3: no wasted width, no columns pushed to the
 * far right, document numbers / dates / money never broken over lines, names never squeezed to one word per line,
 * action buttons side by side). Use with <TableHead> / <TableCell> (or plain th / td):
 *
 *   <TableHead className={tc.doc}>เลขที่บิล</TableHead>     <TableCell className={tc.doc}>IN2611-0006</TableCell>
 *   <TableHead className={tc.num}>ยอดรวม</TableHead>        <TableCell className={tc.num}>฿4,803</TableCell>
 *   <TableCell className={tc.name}><ClampText>{name}</ClampText></TableCell>
 *   <TableCell className={tc.actions}><RowActions>...</RowActions></TableCell>
 */
export const tc = {
  /** numbers / money: right aligned, one line, digits of equal width */
  num: 'text-right whitespace-nowrap tabular-nums',
  /** small centred value (status badge, count, row number) on one line */
  center: 'text-center whitespace-nowrap',
  /** document / bill / PO numbers, codes: one line, tabular digits (no monospace font) */
  doc: 'doc-no whitespace-nowrap',
  /** dates and times: one line (date + time may stack with <TwoLine>); body size, tabular digits */
  date: 'whitespace-nowrap tabular-nums',
  /** row number column */
  index: 'w-10 text-center whitespace-nowrap',
  /** text column (name, supplier, customer): wraps, but never narrower than ~11 rem */
  name: 'min-w-44 whitespace-normal',
  /** long text column (product name with details, address, note) */
  wide: 'min-w-56 whitespace-normal',
  /** action buttons: as narrow as its buttons, on one line */
  actions: 'w-px whitespace-nowrap',
} as const;

/** Text clamped to `lines` lines with the full text as tooltip. */
export function ClampText({ children, title, lines = 2, className }: { children: React.ReactNode; title?: string; lines?: 1 | 2 | 3; className?: string }) {
  const clamp = lines === 1 ? 'truncate block' : lines === 2 ? 'line-clamp-2' : 'line-clamp-3';
  return (
    <span className={cn(clamp, 'break-words', className)} title={title ?? (typeof children === 'string' ? children : undefined)}>
      {children}
    </span>
  );
}

/** Main value with a small grey second line (e.g. date over time, name over phone). */
export function TwoLine({ main, sub, className, subClassName }: { main: React.ReactNode; sub?: React.ReactNode; className?: string; subClassName?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div>{main}</div>
      {sub != null && sub !== '' && <div className={cn('mt-0.5 text-sub font-normal text-muted-foreground', subClassName)}>{sub}</div>}
    </div>
  );
}

/** Row action buttons side by side (8 px apart), never wrapped under each other. */
export function RowActions({ children, className, align = 'end' }: { children: React.ReactNode; className?: string; align?: 'start' | 'center' | 'end' }) {
  return (
    <div
      className={cn(
        'flex flex-nowrap items-center gap-2',
        align === 'end' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start',
        className,
      )}
    >
      {children}
    </div>
  );
}
