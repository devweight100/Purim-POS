'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCartStore } from '@/lib/store/cart-store';
import { useDocumentSearchStore } from '@/lib/store/document-search-store';
import { convertThaiToEnBarcode } from '@/lib/thai-barcode-converter';
import { findProductByScannedCode, useGlobalBarcodeScanner } from '@/lib/use-scanner';
import type { Product } from '@/lib/types';
import { findDocumentCode, resolveScannedUnit } from './pos-scan';
import type { PosVariant } from './pos-variant';

interface PosScannerOptions {
  variant: PosVariant;
  /** listen for the hardware scanner once the page is mounted */
  enabled: boolean;
  products: Product[];
  /** scans are ignored while a blocking dialog is open */
  blocked: boolean;
  /** called after a product was added (the page clears its search box) */
  onProductAdded: () => void;
}

/**
 * Barcode handling of a POS screen: the hidden scanner input, the global scanner listener and the
 * scan processor (product -> cart, document number -> document search, else an error toast).
 */
export function usePosScanner({ variant, enabled, products, blocked, onProductAdded }: PosScannerOptions) {
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const [scannerInputValue, setScannerInputValue] = useState('');

  const focusScanner = (delayMs: number) => {
    setTimeout(() => scannerInputRef.current?.focus(), delayMs);
  };

  const processBarcodeScan = (scannedBarcode: string) => {
    if (blocked) return;

    const raw = scannedBarcode.trim();
    if (!raw) return;

    // Try the raw code first (ASCII SKUs like "RICE-JAS-5KG" stay intact), then the Thai-keyboard conversion
    const convertedCode = convertThaiToEnBarcode(raw).trim();
    const match = findProductByScannedCode(products, raw);

    if (match) {
      const { product } = match;
      const unit = resolveScannedUnit(product, match.code);
      const cart = useCartStore.getState();
      // Check if item is already in cart to provide clear feedback
      const existingItem = cart.items.find((i) => i.productId === product.id && i.unitId === unit.id);

      cart.addItem(product, unit);
      onProductAdded();

      if (existingItem) {
        toast.success(variant.scanRepeatToast(product.name, existingItem.quantity + 1, unit.unitName));
      } else {
        toast.success(variant.scanFirstToast(product.name, unit.unitName));
      }
    } else {
      const docCode = findDocumentCode(raw, convertedCode);
      if (docCode) {
        toast.info(`🔍 ตรวจพบบาร์โค้ดเอกสาร: ${docCode.toUpperCase()} เปิดหน้าค้นหาทันที...`);
        useDocumentSearchStore.getState().openSearch(docCode.toUpperCase());
      } else {
        const thaiHint = convertedCode !== raw ? ` (ลองแปลงจากแป้นไทยเป็น "${convertedCode}" แล้ว)` : '';
        toast.error(`❌ ไม่พบสินค้าบาร์โค้ด: "${raw}"${thaiHint}`);
      }
    }

    // Always reset scanner input and refocus
    setScannerInputValue('');
    focusScanner(10);
  };

  // Scanner keys typed while nothing is focused (useGlobalBarcodeScanner always calls the latest callback)
  useGlobalBarcodeScanner(processBarcodeScan, enabled);

  /** props for the hidden <input> that receives scanner keystrokes */
  const scannerInputProps = {
    ref: scannerInputRef,
    value: scannerInputValue,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setScannerInputValue(e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const raw = scannerInputValue.trim();
        setScannerInputValue('');
        if (raw) processBarcodeScan(raw);
      }
    },
  };

  return { scannerInputRef, scannerInputProps, processBarcodeScan, focusScanner };
}

export type PosScanner = ReturnType<typeof usePosScanner>;
