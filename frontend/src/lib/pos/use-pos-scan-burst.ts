'use client';

import { useEffect, useEffectEvent } from 'react';
import { toast } from 'sonner';
import {
  PAYMENT_OPEN_SCAN_NOTICE,
  ScanBurstDetector,
  editableField,
  isBarcodeField,
  isPaymentOpen,
  restoreBurstAware,
  setFieldValue,
  snapshotBurstAware,
  type EditableField,
} from './scan-burst';

/** Is any dialog / sheet open on the page (Base UI popups and hand-made overlays use these roles)? */
export function anyDialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [data-slot="dialog-content"]');
}

/**
 * The POS page's global scanner detector (lib/pos/scan-burst.ts, docs/pos-keyboard-scan.md). Only the POS page
 * mounts it. Registered on window in the capture phase, so it sees every key before the fields, the dialogs and
 * the numpad, and can keep a scanner's Enter away from them.
 */
export function usePosScanBurst({ enabled, onScan }: { enabled: boolean; onScan: (code: string) => void }) {
  const scanned = useEffectEvent((code: string) => onScan(code));

  useEffect(() => {
    if (!enabled) return;
    const detector = new ScanBurstDetector();
    /** the field the current run of fast keys started in, and its value before the first of them */
    let snap: { el: EditableField; value: string } | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const step = detector.step({
        key: e.key || '',
        time: e.timeStamp || performance.now(),
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        isComposing: e.isComposing || e.keyCode === 229,
      });
      if (step.kind === 'char') {
        if (step.runStart) {
          const field = editableField(active);
          snap = field && !isBarcodeField(field) ? { el: field, value: field.value } : null;
          snapshotBurstAware();
        }
        return;
      }
      if (step.kind !== 'end') return;
      const code = step.code.trim();
      // the scan box / a barcode field handles its own Enter (normal behaviour)
      if (!code || isBarcodeField(active)) {
        snap = null;
        return;
      }
      const inField = !!editableField(active) || !!(active as HTMLElement | null)?.isContentEditable;
      // the slower legacy rule only counts when nothing is focused and no dialog is open (as before)
      if (!step.strict && (inField || anyDialogOpen())) {
        snap = null;
        return;
      }
      // the scanner's Enter / Tab must not submit, confirm or move anything
      e.preventDefault();
      e.stopImmediatePropagation();
      if (step.strict) {
        // take the scanned characters out of the field / numpad / PIN pad again
        if (snap && snap.el.isConnected) setFieldValue(snap.el, snap.value);
        restoreBurstAware();
      }
      snap = null;
      if (isPaymentOpen()) {
        toast.warning(PAYMENT_OPEN_SCAN_NOTICE, { id: 'scan-payment-open' });
        return;
      }
      scanned(code);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}
