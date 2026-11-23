'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ReasonDialog } from '@/components/common/ReasonDialog';
import { registerAskHost, settleAsk, useAskQueue, type AskConfirmOptions } from '@/lib/ask-dialog';
import { cn } from '@/lib/utils';

/** Shows askReason() / askConfirm() requests (lib/ask-dialog.ts), one at a time. Mounted once in Providers. */
export function AskDialogHost() {
  const queue = useAskQueue();
  useEffect(() => registerAskHost(), []);
  const req = queue[0];
  if (!req) return null;
  if (req.kind === 'reason') {
    const o = req.options;
    return (
      <ReasonDialog
        key={req.id}
        open
        onOpenChange={(open) => !open && settleAsk(req.id, null)}
        onConfirm={(text) => settleAsk(req.id, text)}
        title={o.title}
        label={o.label}
        description={o.description}
        defaultValue={o.defaultValue}
        placeholder={o.placeholder}
        required={o.required ?? true}
        confirmLabel={o.confirmLabel}
        cancelLabel={o.cancelLabel}
        danger={o.danger}
        inputId={o.inputId}
      />
    );
  }
  return <ConfirmDialog key={req.id} options={req.options} onAnswer={(ok) => settleAsk(req.id, ok)} />;
}

function ConfirmDialog({ options, onAnswer }: { options: AskConfirmOptions; onAnswer: (ok: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  const { title, description, confirmLabel = 'ตกลง', cancelLabel = 'ยกเลิก', danger = false, alertOnly = false, testId = 'confirm-dialog' } = options;
  return (
    <Dialog open onOpenChange={(open) => !open && onAnswer(false)}>
      {/* Enter on the focused confirm button = OK (as the native confirm), Escape = cancel */}
      <DialogContent className="max-w-md" data-testid={testId} initialFocus={okRef}>
        <DialogHeader>
          <DialogTitle className="pr-8 text-lg font-bold leading-snug whitespace-pre-line">{title}</DialogTitle>
          {description && <DialogDescription className="whitespace-pre-line text-slate-700">{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-btn">
          {!alertOnly && (
            <Button type="button" variant="outline" onClick={() => onAnswer(false)}>
              {cancelLabel}
            </Button>
          )}
          <Button ref={okRef} type="button" onClick={() => onAnswer(true)} className={cn(danger && 'bg-rose-600 hover:bg-rose-700 text-white')}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
