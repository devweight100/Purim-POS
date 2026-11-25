'use client';

import { useEffect } from 'react';
import { handlePadFieldKey } from '@/lib/keyboard/pad-field';

/**
 * Keyboard digits reach the number field of the topmost dialog wherever the focus is (lib/keyboard/pad-field.ts).
 * Mounted once for the whole app (components/providers.tsx). Document capture phase: after the POS scanner detector
 * (window capture) and before the focused element's own handlers.
 */
export function PadFieldKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      handlePadFieldKey(e);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  return null;
}
