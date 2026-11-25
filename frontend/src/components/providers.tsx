'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AskDialogHost } from '@/components/common/AskDialogHost';
import { ExportPinHost } from '@/components/common/ExportPinHost';
import { PadFieldKeys } from '@/components/common/PadFieldKeys';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  // Global Date Picker Full-Click Support: Clicking anywhere in a date input opens the calendar picker
  useEffect(() => {
    const handleGlobalDateClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const dateInput = target.closest('input[type="date"]') as HTMLInputElement | null;
      if (dateInput && typeof dateInput.showPicker === 'function') {
        try {
          dateInput.showPicker();
        } catch {
          // Ignore if already open or not supported
        }
      }
    };

    document.addEventListener('click', handleGlobalDateClick);
    return () => {
      document.removeEventListener('click', handleGlobalDateClick);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {children}
        {/* askReason() / askConfirm(): in-page prompt / confirm (lib/ask-dialog.ts) */}
        <AskDialogHost />
        {/* manager PIN of every data export (lib/export-approval.ts) */}
        <ExportPinHost />
        {/* keyboard digits go to the number field of the topmost dialog (lib/keyboard/pad-field.ts) */}
        <PadFieldKeys />
        <Toaster theme="light" position="bottom-right" duration={2000} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
