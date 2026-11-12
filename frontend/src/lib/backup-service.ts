import { apiFetch, getApiBaseUrl, getAuthToken } from '@/lib/api';

export interface BackupFile {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupVerifyResult {
  ok: boolean;
  fileName: string;
  sizeBytes: number;
  checkedAt?: string;
  message?: string;
}

export interface BackupStatus {
  lastAutoBackupAt: string | null;
  lastBackupAt: string | null;
  lastBackupFile: string | null;
  lastBackupOk: boolean | null;
  lastError: string | null;
  lastVerify: BackupVerifyResult | null;
  nextRunAt: string | null;
  offsiteDir?: string | null;
  lastOffsiteAt?: string | null;
  lastOffsiteOk?: boolean | null;
  lastOffsiteError?: string | null;
}

export interface CreateBackupResult {
  success: boolean;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  verify?: BackupVerifyResult;
}

/** Backup file as the server lists it (older servers: `filename`). */
interface BackupFileJson {
  fileName?: string;
  filename?: string;
  sizeBytes?: number;
  createdAt?: string;
}

function normalizeFile(raw: BackupFileJson | null | undefined): BackupFile {
  return {
    fileName: String(raw?.fileName ?? raw?.filename ?? ''),
    sizeBytes: Number(raw?.sizeBytes ?? 0),
    createdAt: String(raw?.createdAt ?? ''),
  };
}

export const backupService = {
  async list(): Promise<BackupFile[]> {
    const res = await apiFetch<BackupFileJson[] | { data?: BackupFileJson[] } | null>('/server-control/backups');
    const arr = Array.isArray(res) ? res : res?.data ?? [];
    return arr.map(normalizeFile).filter((f: BackupFile) => f.fileName);
  },

  async create(): Promise<CreateBackupResult> {
    const res = await apiFetch<(BackupFileJson & { success?: boolean; verify?: BackupVerifyResult }) | null>('/server-control/backup', { method: 'POST' });
    return {
      success: !!res?.success,
      fileName: String(res?.fileName ?? res?.filename ?? ''),
      sizeBytes: Number(res?.sizeBytes ?? 0),
      createdAt: String(res?.createdAt ?? ''),
      verify: res?.verify,
    };
  },

  /** Optional endpoint (needs a controller route); returns null when unavailable. */
  async status(): Promise<BackupStatus | null> {
    try {
      return await apiFetch<BackupStatus>('/server-control/backup-status');
    } catch {
      return null;
    }
  },

  /** Set the folder (another disk / USB / cloud-synced folder) that receives a copy of every backup. */
  async setOffsiteDir(offsiteDir: string): Promise<{ success: boolean; offsiteDir: string | null }> {
    return apiFetch<{ success: boolean; offsiteDir: string | null }>('/server-control/backup-settings', { method: 'PUT', body: JSON.stringify({ offsiteDir }) });
  },

  /** Download a backup file to this computer. */
  async download(fileName: string): Promise<void> {
    const res = await fetch(`${getApiBaseUrl()}/server-control/backups/${encodeURIComponent(fileName)}/download`, {
      headers: { Authorization: `Bearer ${getAuthToken() || ''}` },
    });
    if (!res.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  /** Optional endpoint (needs a controller route); returns null when unavailable. */
  async verify(fileName: string): Promise<BackupVerifyResult | null> {
    try {
      return await apiFetch<BackupVerifyResult>(`/server-control/backup-verify?file=${encodeURIComponent(fileName)}`, {
        method: 'POST',
      });
    } catch {
      return null;
    }
  },
};

export function describeBackupError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  if (status === 403) return 'ไม่มีสิทธิ์ใช้งานการสำรองข้อมูล (เฉพาะ ADMIN/MANAGER)';
  const msg = err instanceof Error ? err.message : '';
  return msg ? `สำรองข้อมูลไม่สำเร็จ: ${msg}` : 'สำรองข้อมูลไม่สำเร็จ';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
