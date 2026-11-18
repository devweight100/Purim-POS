'use client';

import type { ComponentType } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export interface RowAction {
  /** menu text */
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onSelect: () => void;
  /** red text, placed after a separator (cancel / rollback) */
  danger?: boolean;
  /** leave the action out (no permission / not possible for this row) */
  hidden?: boolean;
  testId?: string;
}

/**
 * One "⋯" button at the end of a table row that lists the row's actions (round 4, owner: payables).
 * Keyboard: Tab reaches the button, Enter / Space / ↓ open the menu with the focus on the first item, ↑/↓ move,
 * Enter chooses, Escape closes and gives the focus back to the button. Clicks and keys on the button or the menu never
 * reach the row (useRowNav ignores buttons and menu items), so the row click / Enter keeps opening the details.
 * Each action keeps its own confirmation (askConfirm / askReason inside onSelect).
 */
export function RowActionsMenu({ label, actions, testId }: { label: string; actions: RowAction[]; testId?: string }) {
  const shown = actions.filter((a) => !a.hidden);
  if (!shown.length) return null;
  const normal = shown.filter((a) => !a.danger);
  const danger = shown.filter((a) => a.danger);
  const item = (a: RowAction) => {
    const Icon = a.icon;
    return (
      <DropdownMenuItem
        key={a.label}
        onClick={a.onSelect}
        data-testid={a.testId}
        className={`gap-2 rounded-lg py-2 text-[13px] font-semibold cursor-pointer ${a.danger ? 'text-rose-700' : 'text-slate-700'}`}
      >
        {Icon && <Icon className="h-4 w-4" />}
        {a.label}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-400 data-popup-open:bg-slate-100 cursor-pointer"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
        {normal.map(item)}
        {normal.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
        {danger.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
