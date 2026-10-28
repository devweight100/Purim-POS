// Server-Sent Events client for realtime change notifications.
// Uses same-origin `/api/events/stream` (Next.js rewrite proxies /api/*). If the
// proxy buffers the stream, set NEXT_PUBLIC_SSE_URL to the backend base
// (e.g. http://host:3001/api) to connect directly.

export type RealtimeEntity =
  | 'product' | 'stock' | 'order' | 'shift' | 'customer' | 'debt' | 'category'
  | 'bankAccount' | 'settings' | 'supplier' | 'purchaseOrder' | 'claim'
  | 'supplierReturn' | 'payable' | 'user';

export interface RealtimeEvent {
  entity: RealtimeEntity;
  at: string;
  ids?: string[];
}

export function startRealtime(
  token: string,
  onEvent: (e: RealtimeEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return () => undefined;
  let es: EventSource | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const base = process.env.NEXT_PUBLIC_SSE_URL || '/api';

  const connect = () => {
    if (stopped) return;
    es = new EventSource(`${base}/events/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener('ready', () => {
      attempt = 0;
      onStatus?.(true);
    });
    es.addEventListener('change', (m) => {
      try {
        onEvent(JSON.parse((m as MessageEvent).data));
      } catch {
        /* ignore malformed */
      }
    });
    es.onerror = () => {
      onStatus?.(false);
      es?.close();
      es = null;
      if (stopped) return;
      const delay = Math.min(1000 * 2 ** attempt++, 30000);
      timer = setTimeout(connect, delay);
    };
  };
  connect();

  return () => {
    stopped = true;
    clearTimeout(timer);
    es?.close();
    onStatus?.(false);
  };
}
