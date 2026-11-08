import { useEffect, useRef } from 'react';
import { convertThaiToEnBarcode } from './thai-barcode-converter';
import { getProductPackagingUnits } from './cart-pricing';
import type { Product } from './types';

/** Hardware barcode scanners type characters much faster than people. */
export const SCANNER_KEY_INTERVAL_MS = 50;

let lastPrintableKeyAt = 0;

/**
 * Call once per keydown (at the top of a POS shortcut handler). Returns the ms elapsed since the
 * previous printable key, or Infinity for non-printable keys / the first key.
 */
export function msSincePreviousPrintableKey(e: KeyboardEvent): number {
  if (!e.key || e.key.length !== 1) return Infinity;
  const now = Date.now();
  const diff = lastPrintableKeyAt ? now - lastPrintableKeyAt : Infinity;
  lastPrintableKeyAt = now;
  return diff;
}

/**
 * Whether a single-character POS shortcut such as `+` / `-` may change the cart.
 * It must NOT when the user (or a scanner) is typing a code:
 *  - any real text field (search box, note, textarea, select, contenteditable) is focused;
 *  - the hidden scanner input already holds part of a code (e.g. "X-Y-Z", "RICE-JAS-5KG");
 *  - the key arrived at scanner speed right after another printable key.
 * An EMPTY hidden scanner input still allows the shortcut (it is focused almost all the time).
 */
export function canUseCartCharShortcut(
  activeEl: Element | null,
  scannerEl: HTMLInputElement | null,
  sincePrevKeyMs: number,
): boolean {
  if (sincePrevKeyMs < SCANNER_KEY_INTERVAL_MS) return false;
  if (!activeEl || activeEl === document.body) return true;
  const el = activeEl as HTMLElement;
  if (el.isContentEditable) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (tag === 'INPUT') {
    if (scannerEl && el === scannerEl) return scannerEl.value === '';
    return false;
  }
  return true;
}

/**
 * Finds the product for a scanned / typed code. The raw code is tried first (ASCII SKUs such as
 * "RICE-JAS-5KG" must stay intact); the Thai-keyboard conversion is only a fallback.
 * Returns the matched product and the (lower-cased) code that matched.
 */
export function findProductByScannedCode(
  products: Product[],
  raw: string,
): { product: Product; code: string } | null {
  const candidates: string[] = [];
  const push = (c: string) => {
    const v = c.trim().toLowerCase();
    if (v && !candidates.includes(v)) candidates.push(v);
  };
  push(raw);
  push(convertThaiToEnBarcode(raw));

  for (const code of candidates) {
    const product = products.find(p => {
      if (p.sku?.toLowerCase().trim() === code) return true;
      if (p.units?.some(u => u.barcode?.toLowerCase().trim() === code)) return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((p as any).barcodes?.some((b: any) => b.barcode?.toLowerCase().trim() === code)) return true;
      return getProductPackagingUnits(p.id).some(u => u.barcode?.toLowerCase().trim() === code);
    });
    if (product) return { product, code };
  }
  return null;
}

/**
 * Passive Global Barcode Scanner Listener Hook
 * Listens for barcode scanning without blocking native input navigation or key events.
 * The raw buffered code is passed on unchanged; callers decide about Thai-keyboard conversion.
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
        const rawCode = bufferRef.current.trim();
        bufferRef.current = '';
        if (rawCode.length >= 2) {
          e.preventDefault();
          onScanRef.current(rawCode);
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
