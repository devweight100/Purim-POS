const KEY = 'purim_terminal_id';

/** The desktop app (desktop/preload.js, from v1.5.4) keeps this machine's terminal id in its config file. */
interface DesktopTerminalApi {
  getTerminalId?: () => string | null;
  setTerminalId?: (id: string) => boolean;
}

function desktopApi(): DesktopTerminalApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: DesktopTerminalApi }).electronAPI;
  return api && typeof api.getTerminalId === 'function' ? api : null;
}

function readLocal(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeLocal(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable: the desktop copy (if any) still holds it */
  }
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * This device's sales-terminal id. The server keys the open shift and the cash drawer on it, so it must not
 * change when the app restarts. In the desktop app the durable copy is the app's config file (localStorage written
 * just before the app ended without a clean shutdown is lost - BUG-03 v1.5.3); localStorage mirrors it. An
 * existing localStorage id is handed to the desktop app the first time, so an upgrade keeps the open shift.
 */
export function getTerminalId(): string {
  const desktop = desktopApi();
  const local = readLocal();
  if (desktop) {
    let stored: string | null = null;
    try {
      stored = desktop.getTerminalId?.() ?? null;
    } catch {
      stored = null;
    }
    if (stored) {
      if (local !== stored) writeLocal(stored);
      return stored;
    }
    const id = local || newId();
    try {
      desktop.setTerminalId?.(id);
    } catch {
      /* old desktop app: localStorage only */
    }
    if (!local) writeLocal(id);
    return id;
  }
  if (local) return local;
  const id = newId();
  writeLocal(id);
  return id;
}

/** Continue as another terminal id (the user's open shift left on this machine under a lost id). */
export function setTerminalId(id: string) {
  writeLocal(id);
  try {
    desktopApi()?.setTerminalId?.(id);
  } catch {
    /* old desktop app */
  }
}
