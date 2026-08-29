import { useEffect, useRef } from 'react';

/**
 * Passive Global Barcode Scanner Listener Hook
 * Listens for barcode scanning without blocking native input navigation or key events.
 */
export function useGlobalBarcodeScanner(
  onScan: (barcode: string) => void,
  enabled = true
) {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input/textarea element
      const activeEl = document.activeElement as HTMLElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }

      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.startsWith('F') && e.key.length > 1) return;

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTimeRef.current;
      lastKeyTimeRef.current = currentTime;

      if (e.key === 'Enter' || e.key === 'Tab') {
        const scannedCode = bufferRef.current.trim();
        bufferRef.current = '';
        if (scannedCode.length >= 2) {
          e.preventDefault();
          onScanRef.current(scannedCode);
        }
        return;
      }

      // Reset buffer if delay > 200ms (human typing)
      if (timeDiff > 200 && bufferRef.current.length > 0) {
        bufferRef.current = '';
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);

  return '';
}
