import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The one chip style of the back office (docs/ui-style.md): only for a STATUS (paid / unpaid, active / inactive,
 * order / claim / PO status, movement type). Plain values (category, quantity, unit, price, numbers) are plain text,
 * never a chip. Tone = meaning: success (done / paid / active), warning (waiting / partly paid / low), danger (overdue /
 * cancelled / out of stock), info (in progress), neutral (draft / closed / other).
 */
export type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

const TONES: Record<ChipTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  danger: 'bg-red-50 text-red-700 ring-red-600/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  primary: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
};

export const chipClass = (tone: ChipTone = 'neutral') =>
  cn('status-chip inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-sub font-medium ring-1 ring-inset [&>svg]:size-3.5', TONES[tone]);

export function StatusChip({ tone = 'neutral', className, children, ...rest }: React.ComponentProps<'span'> & { tone?: ChipTone }) {
  return (
    <span data-slot="status-chip" className={cn(chipClass(tone), className)} {...rest}>
      {children}
    </span>
  );
}
