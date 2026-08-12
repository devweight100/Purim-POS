import { useEffect, useRef } from 'react';

/**
 * Global Barcode Scanner Listener Hook
 * Automatically captures rapid keystrokes from USB/Bluetooth Barcode Scanners 
 * regardless of current cursor focus on the page.
 */
export function useGlobalBarcodeScanner(onScan: (barcode: string) => void, enabled = true) {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if modifier keys are pressed (Ctrl, Alt, Cmd)
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTimeRef.current;
      lastKeyTimeRef.current = currentTime;

      // If time diff > 75ms and we have a partial buffer, it's manual human typing -> reset buffer
      if (timeDiff > 75 && bufferRef.current.length > 0) {
        bufferRef.current = '';
      }

      if (e.key === 'Enter') {
        // Scanners terminate input with Enter
        if (bufferRef.current.length >= 3) {
          const scannedCode = bufferRef.current.trim();
          bufferRef.current = '';
          onScan(scannedCode);
        }
      } else if (e.key.length === 1) {
        // Collect single character keys
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onScan, enabled]);
}
