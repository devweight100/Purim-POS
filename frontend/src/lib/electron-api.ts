/**
 * Bridge the Electron desktop app exposes as `window.electronAPI` (desktop/preload.js).
 * Only the calls the web app uses are listed; every one may be missing in older app versions.
 */
export interface ElectronAPI {
  isDesktop?: boolean;
  saveConfig?: (config: { printerName?: string; kickMethod?: string }) => Promise<unknown>;
  kickDrawer?: (options: { printerName?: string; method?: string }) => Promise<{ success?: boolean; printer?: string; output?: string; error?: string } | null>;
  printSilent?: (options: { html: string; printerName?: string; showDialog?: boolean; format?: string }) => Promise<unknown>;
}

/** The desktop bridge, or undefined in a normal browser / during SSR. */
export function getElectronAPI(): ElectronAPI | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { electronAPI?: ElectronAPI }).electronAPI;
}
