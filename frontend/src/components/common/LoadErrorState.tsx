'use client';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Shown instead of data when a page could not load it from the server.
 * The server is the only source of truth, so a page never falls back to stale copies.
 */
export function LoadErrorState({
  message,
  onRetry,
  retrying,
  className,
}: {
  message?: string | null;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-testid="load-error-state"
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center text-red-800 ${className || ''}`}
    >
      <AlertTriangle className="h-8 w-8 text-red-500" />
      <div>
        <p className="font-bold">โหลดข้อมูลจากเซิร์ฟเวอร์ไม่ได้</p>
        {message && <p className="mt-1 text-sm text-red-700">{message}</p>}
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
        {retrying ? 'กำลังโหลด…' : 'ลองใหม่'}
      </button>
    </div>
  );
}

export function errorMessage(err: unknown, fallback = 'เกิดข้อผิดพลาด'): string {
  const msg = (err as any)?.message;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}
