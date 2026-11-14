'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** "rows a-b of N" + first / previous / page x of y / next / last, for server-paged tables. */
export function SimplePager({
  page,
  pageSize,
  total,
  onPage,
  unit = 'รายการ',
  testId,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  unit?: string;
  testId?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 text-xs sm:text-sm text-slate-600" data-testid={testId}>
      <div>
        แสดง <span className="font-bold text-slate-800">{from.toLocaleString()}-{to.toLocaleString()}</span> จากทั้งหมด{' '}
        <span className="font-bold text-slate-800">{total.toLocaleString()}</span> {unit}
      </div>
      <div className="flex items-center gap-0.5">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(1)} className="h-7.5 w-7.5 p-0 rounded-md" title="หน้าแรก">
          <ChevronsLeft className="w-3.5 h-3.5" />
        </Button>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))} className="h-7.5 w-7.5 p-0 rounded-md" title="หน้าก่อนหน้า">
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <div className="px-2 font-bold text-slate-800">
          หน้า {page} / {totalPages}
        </div>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(Math.min(totalPages, page + 1))} className="h-7.5 w-7.5 p-0 rounded-md" title="หน้าถัดไป">
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(totalPages)} className="h-7.5 w-7.5 p-0 rounded-md" title="หน้าสุดท้าย">
          <ChevronsRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
