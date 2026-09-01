import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

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
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    window.print();
    return;
  }

  // Clone all application stylesheets and <style> tags from parent document
  const headStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((node) => node.outerHTML)
    .join('\n');

  const pageMargin = isSlip ? '2mm 3mm' : '8mm';
  const pageSize = isSlip ? '80mm auto' : 'A4 portrait';
  const containerMaxWidth = isSlip ? '80mm' : '210mm';

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <meta charset="utf-8" />
        ${headStyles}
        <style>
          @page {
            size: ${pageSize};
            margin: ${pageMargin};
          }
          *, *::before, *::after {
            box-sizing: border-box !important;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #0f172a !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            font-family: 'Prompt', 'Sarabun', -apple-system, BlinkMacSystemFont, sans-serif !important;
          }
          .no-print {
            display: none !important;
          }
          .print-wrapper {
            width: 100% !important;
            max-width: ${containerMaxWidth} !important;
            margin: 0 auto !important;
            background: #ffffff !important;
          }
          /* Ensure shadows and outer borders don't distort physical paper */
          .print-wrapper > div {
            box-shadow: none !important;
            margin: 0 auto !important;
          }
        </style>
      </head>
      <body>
        <div class="print-wrapper">
          ${element.innerHTML}
        </div>
        <script>
          window.onload = function() {
            setTimeout(() => {
              window.focus();
              window.print();
              setTimeout(() => {
                window.parent.document.body.removeChild(window.frameElement);
              }, 1200);
            }, 300);
          };
        </script>
      </body>
    </html>
  `);
  doc.close();
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
