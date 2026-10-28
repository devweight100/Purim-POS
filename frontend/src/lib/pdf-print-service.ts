import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { getCashDrawerConfig } from './cash-drawer-service';

/**
 * Universal Print & PDF Export Utility for Purim POS
 * Guarantees 100% WYSIWYG matching between screen preview and physical print/PDF.
 */

export function printDocumentIframe(
  element: HTMLElement,
  title: string,
  format: '80mm' | 'a4' = 'a4'
) {
  const isSlip = format === '80mm';

  // Clone all application stylesheets and <style> tags from parent document with absolute URLs
  const headStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((node) => {
      if (node.tagName === 'LINK') {
        const link = node as HTMLLinkElement;
        return `<link rel="stylesheet" href="${link.href}" />`;
      }
      return node.outerHTML;
    })
    .join('\n');

  const pageMargin = isSlip ? '0mm' : '8mm';
  const pageSize = isSlip ? '80mm auto' : 'A4 portrait';
  const containerMaxWidth = isSlip ? '100%' : '210mm';
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const fullHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <meta charset="utf-8" />
        <base href="${baseUrl}/" />
        ${headStyles}
        <style>
          @page {
            size: ${pageSize};
            margin: 0mm !important;
          }
          *, *::before, *::after {
            box-sizing: border-box !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            font-family: 'Prompt', 'Sarabun', -apple-system, BlinkMacSystemFont, sans-serif !important;
            ${isSlip ? `width: 100% !important; max-width: 100% !important;` : `width: 210mm !important; max-width: 210mm !important;`}
          }
          .no-print {
            display: none !important;
          }
          .print-wrapper {
            width: 100% !important;
            max-width: ${containerMaxWidth} !important;
            margin: 0 auto !important;
            padding: ${isSlip ? '0 1.5mm' : '0'} !important;
            background: #ffffff !important;
            box-sizing: border-box !important;
          }

          ${isSlip ? `
          /* Standalone Thermal Receipt Layout Fallback CSS */
          .flex { display: flex !important; }
          .flex-col { flex-direction: column !important; }
          .justify-between { justify-content: space-between !important; }
          .justify-center { justify-content: center !important; }
          .items-center { align-items: center !important; }
          .items-start { align-items: flex-start !important; }
          .text-center { text-align: center !important; }
          .text-right { text-align: right !important; }
          .text-left { text-align: left !important; }
          .font-bold { font-weight: 700 !important; }
          .font-black, .font-extrabold { font-weight: 900 !important; }
          .font-semibold { font-weight: 600 !important; }
          .border-b { border-bottom: 1px solid #000000 !important; }
          .border-b-2 { border-bottom: 2px solid #000000 !important; }
          .border-t { border-top: 1px solid #000000 !important; }
          .border-t-2 { border-top: 2px solid #000000 !important; }
          .border-dashed { border-style: dashed !important; }
          .border-black { border-color: #000000 !important; }
          .border-2 { border: 2px solid #000000 !important; }
          .w-full { width: 100% !important; }
          .w-1\\/2 { width: 50% !important; }
          .w-1\\/4 { width: 25% !important; }
          .w-3\\/4 { width: 75% !important; }
          .shrink-0 { flex-shrink: 0 !important; }
          .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .break-words { word-break: break-word; overflow-wrap: break-word; }
          .whitespace-pre-wrap { white-space: pre-wrap !important; }
          .space-y-0\\.5 > * + * { margin-top: 2px !important; }
          .space-y-1 > * + * { margin-top: 4px !important; }
          .space-y-1\\.5 > * + * { margin-top: 6px !important; }
          .space-y-2 > * + * { margin-top: 8px !important; }
          .py-1 { padding-top: 4px !important; padding-bottom: 4px !important; }
          .pb-1 { padding-bottom: 4px !important; }
          .pt-1 { padding-top: 4px !important; }
          .px-2\\.5 { padding-left: 10px !important; padding-right: 10px !important; }
          .py-0\\.5 { padding-top: 2px !important; padding-bottom: 2px !important; }
          .leading-tight { line-height: 1.25 !important; }
          .tracking-wider { letter-spacing: 0.05em !important; }
          .uppercase { text-transform: uppercase !important; }
          .inline-block { display: inline-block !important; }

          @media print {
            @page {
              size: 80mm auto;
              margin: 0mm !important;
            }
            html, body {
              width: 100% !important;
              max-width: 100% !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            .print-wrapper {
              width: 100% !important;
              max-width: 100% !important;
              margin: 0 !important;
              padding: 0 1.5mm !important;
            }
            .print-wrapper > div {
              width: 100% !important;
              max-width: 100% !important;
              margin: 0 !important;
              border: none !important;
            }
            * {
              color: #000000 !important;
              border-color: #000000 !important;
              text-shadow: none !important;
            }
          }
          * {
            color: #000000 !important;
            border-color: #000000 !important;
          }
          ` : `
          @media print {
            @page {
              size: A4 portrait;
              margin: 0mm !important;
            }
            html, body {
              width: 210mm !important;
              height: 297mm !important;
              max-height: 297mm !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
              background: #ffffff !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .print-wrapper {
              width: 210mm !important;
              max-width: 210mm !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
            }
            .a4-container {
              width: 210mm !important;
              max-width: 210mm !important;
              height: 297mm !important;
              max-height: 297mm !important;
              margin: 0 !important;
              padding: 8mm 10mm !important;
              border: none !important;
              box-shadow: none !important;
              page-break-inside: avoid !important;
              page-break-after: avoid !important;
              break-inside: avoid !important;
              overflow: hidden !important;
              display: flex !important;
              flex-direction: column !important;
              justify-content: space-between !important;
            }
            .break-inside-avoid {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
          }
          `}
        </style>
      </head>
      <body>
        <div class="print-wrapper">
          ${element.outerHTML || element.innerHTML}
        </div>
        <script>
          (function() {
            function triggerPrint() {
              try {
                window.focus();
                window.print();
              } catch (e) {}
            }
            if (document.fonts && document.fonts.ready) {
              document.fonts.ready.then(function() {
                setTimeout(triggerPrint, 150);
              });
            } else if (document.readyState === 'complete') {
              setTimeout(triggerPrint, 200);
            } else {
              window.addEventListener('load', function() {
                setTimeout(triggerPrint, 200);
              });
              setTimeout(triggerPrint, 500);
            }
          })();
        </script>
      </body>
    </html>
  `;

  // 1. If running in Electron Native Desktop App -> 100% Silent Direct Print (0 dialogs!)
  if (typeof window !== 'undefined' && (window as any).electronAPI?.printSilent) {
    let targetPrinter = '';
    try {
      const drawerCfg = getCashDrawerConfig();
      if (drawerCfg?.selectedPrinter) {
        targetPrinter = drawerCfg.selectedPrinter;
      }
    } catch (e) {}

    (window as any).electronAPI.printSilent({
      html: fullHtml,
      printerName: targetPrinter || undefined
    }).catch((err: any) => console.error('Electron silent print failed:', err));
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = isSlip ? '80mm' : '210mm';
  iframe.style.height = isSlip ? '297mm' : '297mm';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    window.print();
    return;
  }

  doc.open();
  doc.write(fullHtml);
  doc.close();

  // Failsafe direct call from parent window
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.warn('Iframe print error', e);
    }
    // Clean up iframe after print dialog completes
    setTimeout(() => {
      try {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      } catch (e) {}
    }, 3000);
  }, 200);
}

export async function exportElementToPdf(
  element: HTMLElement,
  filename: string,
  format: '80mm' | 'a4' = 'a4'
): Promise<boolean> {
  try {
    const isSlip = format === '80mm';

    // Capture the target element with high DPI and zero scroll offset distortion
    const canvas = await html2canvas(element, {
      scale: 2.5,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollX: 0,
      scrollY: -window.scrollY,
      windowWidth: document.documentElement.offsetWidth,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.98);

    if (isSlip) {
      const mmWidth = 80;
      const mmHeight = (canvas.height * mmWidth) / canvas.width;
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [mmWidth, Math.max(120, mmHeight + 6)],
      });
      pdf.addImage(imgData, 'JPEG', 0, 2, mmWidth, mmHeight);
      pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
    } else {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = 210;
      const pdfHeight = 297;
      const margin = 8;
      const printWidth = pdfWidth - margin * 2;
      const printHeight = (canvas.height * printWidth) / canvas.width;

      if (printHeight <= pdfHeight - margin * 2) {
        // Fits comfortably on 1 single page
        pdf.addImage(imgData, 'JPEG', margin, margin, printWidth, printHeight);
      } else {
        // Multi-page document handling
        let heightLeft = printHeight;
        let position = margin;
        pdf.addImage(imgData, 'JPEG', margin, position, printWidth, printHeight);
        heightLeft -= (pdfHeight - margin * 2);

        while (heightLeft > 0) {
          position = heightLeft - printHeight + margin;
          pdf.addPage();
          pdf.addImage(imgData, 'JPEG', margin, position, printWidth, printHeight);
          heightLeft -= (pdfHeight - margin * 2);
        }
      }
      pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
    }
    return true;
  } catch (err) {
    console.error('Failed to generate PDF:', err);
    return false;
  }
}
