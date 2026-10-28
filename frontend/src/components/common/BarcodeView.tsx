'use client';

import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeViewProps {
  value: string;
  format?: 'CODE128' | 'CODE39' | 'EAN13';
  width?: number;
  height?: number;
  displayValue?: boolean;
  fontSize?: number;
  className?: string;
}

export function BarcodeView({
  value,
  format = 'CODE128',
  width = 1.7,
  height = 42,
  displayValue = true,
  fontSize = 12,
  className = '',
}: BarcodeViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value && typeof window !== 'undefined') {
      try {
        JsBarcode(svgRef.current, String(value).trim(), {
          format,
          width,
          height,
          displayValue,
          fontSize,
          font: 'monospace',
          textMargin: 3,
          margin: 0,
          background: '#ffffff',
          lineColor: '#000000',
        });
      } catch (err) {
        console.warn('Barcode render error for:', value, err);
      }
    }
  }, [value, format, width, height, displayValue, fontSize]);

  if (!value) return null;

  return (
    <div className={`flex flex-col items-center justify-center select-none ${className}`}>
      <svg ref={svgRef} className="max-w-full overflow-visible" />
    </div>
  );
}
