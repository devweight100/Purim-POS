'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * In-page "ask for a reason" dialog, the replacement for window.prompt() (owner 2026-11-17: the desktop app could
 * not cancel an online order). Never use the browser's own prompt / confirm / alert in the back office or the POS:
 * Electron does not support prompt() at all (it throws), and after a native confirm() / alert() the desktop window
 * stops passing keystrokes to the page until it is re-focused, so the next text field cannot be typed into.
 *
 * Keyboard: the field has the focus when the dialog opens (default text selected), Enter confirms, Escape closes only
 * this dialog (lib/dialog-stack.ts), also when it is opened over another dialog / sheet / row-nav list.
 * `required`: the confirm button stays disabled (and Enter does nothing) while the field is blank.
 * The field is reset to `defaultValue` every time the dialog opens.
 */
export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** called with the trimmed text (may be '' when not required); the caller closes the dialog when it is done */
  onConfirm: (reason: string) => void | Promise<void>;
  title: ReactNode;
  /** label above the field */
  label?: ReactNode;
  description?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** red confirm button (cancel / delete actions); default true */
  danger?: boolean;
  busy?: boolean;
  /** id of the text field (tests / labels) */
  inputId?: string;
  maxLength?: number;
}

export function ReasonDialog(props: ReasonDialogProps) {
  // the form is mounted only while open: a fresh field (default text, no leftovers) every time
  return (
    <Dialog open={props.open} onOpenChange={(o) => props.onOpenChange(o)}>
      {props.open && <ReasonForm {...props} />}
    </Dialog>
  );
}

function ReasonForm({
  onOpenChange,
  onConfirm,
  title,
  label,
  description,
  defaultValue = '',
  placeholder,
  required = true,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  danger = true,
  busy = false,
  inputId,
  maxLength = 500,
}: ReasonDialogProps) {
  const autoId = useId();
  const id = inputId || `reason-${autoId}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const blank = !value.trim();
  const disabled = busy || (required && blank);

  const submit = () => {
    if (disabled) return;
    void onConfirm(value.trim());
  };
  // Enter belongs to this dialog: React bubbles keys through the portal to the components that opened it (row-nav
  // lists open a row on Enter, an outer dialog may confirm on Enter), so it stops at the form. Escape is left to
  // Base UI (its handler sits on the popup) and lib/dialog-stack.ts closes only the topmost dialog.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') e.stopPropagation();
  };

  return (
    <DialogContent
      className="max-w-md"
      data-testid="reason-dialog"
      initialFocus={inputRef}
    >
      <form
        className="grid gap-4"
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-8 text-lg font-bold leading-snug">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-1.5">
          {label && (
            <label className="text-sm font-semibold" htmlFor={id}>
              {label}
              {required && <span className="text-rose-600"> *</span>}
            </label>
          )}
          <Input
            ref={inputRef}
            id={id}
            value={value}
            maxLength={maxLength}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder={placeholder}
            aria-required={required || undefined}
            autoComplete="off"
          />
          {required && blank && <p className="text-xs text-slate-500">ต้องระบุเหตุผล</p>}
        </div>
        <DialogFooter className="gap-btn">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button type="submit" disabled={disabled} className={cn(danger && 'bg-rose-600 hover:bg-rose-700 text-white')}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
