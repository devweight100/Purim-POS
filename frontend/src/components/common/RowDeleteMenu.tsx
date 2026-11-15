'use client';

import { MoreVertical, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/**
 * "⋮" menu at the end of a table row holding the row's delete action, so delete is never a one-click
 * button next to edit. `onDelete` still asks for confirmation itself.
 */
export function RowDeleteMenu({ label, onDelete, title = 'เพิ่มเติม' }: { label: string; onDelete: () => void; title?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={title}
        title={title}
        className="inline-flex items-center justify-center h-8 w-8 p-0 text-slate-500 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer outline-none"
      >
        <MoreVertical className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 p-1.5 rounded-xl bg-white shadow-xl border border-slate-200 text-xs">
        <DropdownMenuItem onClick={onDelete} className="font-bold text-rose-700 py-2 rounded-lg cursor-pointer gap-2">
          <Trash2 className="w-4 h-4" /> {label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
