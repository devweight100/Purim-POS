/**
 * Cash Drawer Service for Purim POS
 * Supports:
 * 1. Print Pulse via lightweight zero-height print document (Triggers Windows Driver cash drawer kick)
 * 2. Web Serial API direct ESC/POS command (0x1B 0x70 0x00 0x19 0xFA) for instant silent kick without dialog
 * 3. Audio cash register chime feedback
 */

export interface CashDrawerConfig {
  enabled: boolean;
  method: 'print_pulse' | 'web_serial';
  openOnCashPayment: boolean; // Automatically kick drawer when cash payment is confirmed
  soundFeedback: boolean; // Play cash register chime
}

const STORAGE_KEY = 'pos_cash_drawer_config';

const DEFAULT_CONFIG: CashDrawerConfig = {
  enabled: true,
  method: 'print_pulse',
  openOnCashPayment: true,
  soundFeedback: true,
};

export function getCashDrawerConfig(): CashDrawerConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveCashDrawerConfig(config: Partial<CashDrawerConfig>): CashDrawerConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const current = getCashDrawerConfig();
    const updated = { ...current, ...config };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return DEFAULT_CONFIG;
  }
}

// Active Serial Port reference for direct Web Serial ESC/POS communication
let activeSerialPort: any = null;

/**
 * Check if Web Serial API is supported in current browser (Chrome / Edge)
 */
export function isWebSerialSupported(): boolean {
  return typeof window !== 'undefined' && 'serial' in navigator;
}

/**
 * Request user to pick and connect a USB / Serial thermal receipt printer
 */
export async function connectWebSerialPrinter(): Promise<{ success: boolean; message: string }> {
  if (!isWebSerialSupported()) {
    return { 
      success: false, 
      message: 'เบราว์เซอร์นี้ไม่รองรับ Web Serial API (แนะนำให้ใช้ Google Chrome หรือ Microsoft Edge)' 
    };
  }

  try {
    const port = await (navigator as any).serial.requestPort();
    await port.open({ baudRate: 9600 });
    activeSerialPort = port;
    return { success: true, message: 'เชื่อมต่อเครื่องพิมพ์ผ่าน Serial Port สำเร็จ' };
  } catch (err: any) {
    if (err.name === 'NotFoundError') {
      return { success: false, message: 'ยกเลิกการเลือกอุปกรณ์' };
    }
    return { success: false, message: err.message || 'ไม่สามารถเชื่อมต่อพอร์ตได้' };
  }
}

/**
 * Send raw ESC/POS kick pulse directly through Web Serial
 */
export async function triggerSerialKick(): Promise<boolean> {
  if (!activeSerialPort) return false;
  try {
    const writer = activeSerialPort.writable.getWriter();
    // ESC p 0 25 250 (Pin 2 standard drawer kick)
    const escPosKick = new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA]);
    await writer.write(escPosKick);
    writer.releaseLock();
    return true;
  } catch (err) {
    console.warn('Failed to write serial kick:', err);
    return false;
  }
}

/**
 * Play authentic cash register bell chime sound
 */
export function playCashDrawerChime() {
  try {
    if (typeof window !== 'undefined' && ('AudioContext' in window || (window as any).webkitAudioContext)) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();

      // Main ding (B5 note)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(987.77, ctx.currentTime);
      gain1.gain.setValueAtTime(0.2, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.35);

      // Bell overtone resonance (E6 note)
      setTimeout(() => {
        try {
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.type = 'triangle';
          osc2.frequency.setValueAtTime(1318.51, ctx.currentTime);
          gain2.gain.setValueAtTime(0.18, ctx.currentTime);
          gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.start();
          osc2.stop(ctx.currentTime + 0.45);
        } catch {}
      }, 60);
    }
  } catch {}
}

/**
 * Sends a minimal print job through a hidden iframe to trigger the Windows printer driver's
 * "Open Cash Drawer Before/After Printing" mechanism.
 */
export function triggerPrintPulseKick(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }

    try {
      // Remove any existing kick iframe
      const oldIframe = document.getElementById('pos-cash-drawer-kick-frame');
      if (oldIframe) oldIframe.remove();

      const iframe = document.createElement('iframe');
      iframe.id = 'pos-cash-drawer-kick-frame';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';

      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) {
        resolve(false);
        return;
      }

      doc.open();
      // Zero-height print document with ESC/POS kick character entity
      doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Cash Drawer Kick Pulse</title>
          <style>
            @page {
              size: 80mm 1mm;
              margin: 0;
            }
            body {
              margin: 0;
              padding: 0;
              height: 0;
              overflow: hidden;
              font-size: 1px;
              color: transparent;
            }
          </style>
        </head>
        <body>
          <span style="display:none">&#27;&#112;&#0;&#25;&#250;</span>
          <script>
            window.onload = function() {
              try {
                window.print();
              } catch (e) {}
              setTimeout(function() {
                try {
                  window.frameElement.remove();
                } catch(e) {}
              }, 1200);
            };
          </script>
        </body>
        </html>
      `);
      doc.close();
      resolve(true);
    } catch (err) {
      console.warn('Failed to trigger print pulse kick:', err);
      resolve(false);
    }
  });
}

/**
 * Main execution function to kick the cash drawer open.
 * Can be called from any button (POS F9, Cash Drawer Modal, or payment confirmation).
 */
export async function kickCashDrawer(options?: {
  reason?: string;
}): Promise<{ success: boolean; methodUsed: string }> {
  const config = getCashDrawerConfig();
  if (!config.enabled) {
    return { success: false, methodUsed: 'disabled' };
  }

  // 1. Audio feedback
  if (config.soundFeedback) {
    playCashDrawerChime();
  }

  // 2. If Web Serial configured & connected, kick directly via ESC/POS
  if (config.method === 'web_serial' && activeSerialPort) {
    const ok = await triggerSerialKick();
    if (ok) return { success: true, methodUsed: 'web_serial' };
  }

  // 3. Trigger Print Pulse kick through Windows Driver
  await triggerPrintPulseKick();
  return { success: true, methodUsed: 'print_pulse' };
}
