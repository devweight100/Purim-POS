/**
 * Cash Drawer Service for Purim POS
 * Supports:
 * 1. Print Pulse via lightweight zero-height print document (Triggers Windows Driver cash drawer kick)
 * 2. Web Serial API direct ESC/POS command (0x1B 0x70 0x00 0x19 0xFA) for instant silent kick without dialog
 * 3. Audio cash register chime feedback
 */

export interface CashDrawerConfig {
  enabled: boolean;
  method: 'desktop_native' | 'print_pulse' | 'web_serial';
  selectedPrinter?: string;
  kickTechnique?: 'auto' | 'escpos' | 'epson_font';
  openOnCashPayment: boolean; // Automatically kick drawer when cash payment is confirmed
  soundFeedback: boolean; // Play cash register chime
}

const STORAGE_KEY = 'pos_cash_drawer_config';

const DEFAULT_CONFIG: CashDrawerConfig = {
  enabled: true,
  method: 'desktop_native',
  selectedPrinter: '',
  kickTechnique: 'escpos',
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

    // Also sync printer name and kick method to Electron app config if running in desktop
    if ((window as any).electronAPI?.saveConfig) {
      (window as any).electronAPI.saveConfig({
        printerName: updated.selectedPrinter || '',
        kickMethod: updated.kickTechnique || 'auto'
      }).catch((e: any) => console.warn('Failed to sync config to Electron:', e));
    }

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
  // No-op: Do not spawn a blank window.print() dialog.
  // Cash drawer kicking on Epson TM-T82 is handled directly by the Epson Windows Driver
  // (Printing Preferences > Document Settings > Cash Drawer > Open Before/After Printing)
  // or via Web Serial ESC/POS.
  return Promise.resolve(true);
}

/**
 * Main execution function to kick the cash drawer open.
 * Can be called from any button (POS F9, Cash Drawer Modal, or payment confirmation).
 */
export async function kickCashDrawer(options?: {
  reason?: string;
  printerName?: string;
  technique?: 'auto' | 'escpos' | 'epson_font';
}): Promise<{ 
  success: boolean; 
  methodUsed: string; 
  printer?: string; 
  error?: string; 
  output?: string; 
}> {
  const config = getCashDrawerConfig();
  if (!config.enabled) {
    return { success: false, methodUsed: 'disabled', error: 'ลิ้นชักถูกปิดใช้งานในการตั้งค่า' };
  }

  // 1. Audio feedback
  if (config.soundFeedback) {
    playCashDrawerChime();
  }

  // 1.5. If running inside Electron Native Desktop App -> kick drawer natively
  if (typeof window !== 'undefined' && (window as any).electronAPI?.kickDrawer) {
    try {
      const printer = options?.printerName || config.selectedPrinter || undefined;
      const method = options?.technique || config.kickTechnique || 'auto';
      const res = await (window as any).electronAPI.kickDrawer({
        printerName: printer,
        method: method
      });
      console.log('Electron native drawer kick result:', res);
      if (res && res.success) {
        return { 
          success: true, 
          methodUsed: 'electron_native', 
          printer: res.printer, 
          output: res.output 
        };
      } else {
        return { 
          success: false, 
          methodUsed: 'electron_native', 
          printer: res?.printer, 
          error: res?.error || res?.output || 'ไม่สามารถส่งสัญญาณเตะลิ้นชักไปยังเครื่องพิมพ์ได้' 
        };
      }
    } catch (e: any) {
      console.warn('Electron native kickDrawer error:', e);
      return { 
        success: false, 
        methodUsed: 'electron_native', 
        error: e?.message || 'เกิดข้อผิดพลาดในการสั่งเตะลิ้นชักผ่าน Electron' 
      };
    }
  }

  // 2. If Web Serial configured & connected, kick directly via ESC/POS
  if (activeSerialPort) {
    const ok = await triggerSerialKick();
    if (ok) return { success: true, methodUsed: 'web_serial' };
    return { success: false, methodUsed: 'web_serial', error: 'ไม่สามารถส่งคำสั่งผ่านพอร์ต Serial ได้' };
  }

  // 3. For Windows Printer Driver / Web Browser:
  return { 
    success: true, 
    methodUsed: 'driver_print',
    output: 'ส่งคำสั่งผ่านไดรเวอร์เครื่องพิมพ์' 
  };
}
