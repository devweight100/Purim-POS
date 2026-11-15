import { useEffect, useEffectEvent, useId, useState } from 'react';

/**
 * Open dialogs in the order they opened. Base UI handles nesting inside one React tree, but dialogs opened
 * as siblings over each other (approval / receipt / numpad over the payment window, a sheet over the POS...)
 * each saw the same Escape or backdrop click and all closed. Only the topmost one may close on Escape /
 * outside press (round 2 keyboard audit).
 */
const stack: string[] = [];

export function isTopDialog(id: string) {
  return stack.length === 0 || stack[stack.length - 1] === id;
}

type Details = { reason?: string; cancel?: () => void };

/** For a Base UI Dialog.Root wrapper: returns the props to pass on (open / onOpenChange). */
export function useDialogStack<D extends Details>(
  open: boolean | undefined,
  defaultOpen: boolean | undefined,
  onOpenChange: ((open: boolean, details: D) => void) | undefined,
) {
  const id = useId();
  const [innerOpen, setInnerOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? innerOpen;
  useEffect(() => {
    if (!isOpen) return;
    stack.push(id);
    return () => {
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [isOpen, id]);

  const handleOpenChange = (next: boolean, details: D) => {
    if (!next && (details?.reason === 'escape-key' || details?.reason === 'outside-press') && !isTopDialog(id)) {
      details.cancel?.();
      return;
    }
    if (open === undefined) setInnerOpen(next);
    onOpenChange?.(next, details);
  };
  return { open: open === undefined ? undefined : open, onOpenChange: handleOpenChange };
}

/**
 * For hand-made overlays (not Base UI): Escape closes it when it is the topmost open dialog; it also takes
 * part in the stack so a Base UI dialog under it stays open.
 */
export function useStackedEscape(open: boolean, onClose: () => void) {
  const id = useId();
  const close = useEffectEvent(() => onClose());
  useEffect(() => {
    if (!open) return;
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !isTopDialog(id)) return;
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open, id]);
}
