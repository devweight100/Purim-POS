/**
 * JSON whose shape the reader has not declared. apiFetch() returns it when the caller passes no
 * response type, and ApiError.data holds the server's error body with it (callers branch on
 * `data.code`, e.g. APPROVAL_REQUIRED carries `ticket` / `reasons`). New code declares types:
 * apiFetch<ApiProduct[]>(...). Remove once every caller does.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON fallback for existing callers (see above)
export type UntypedJson = any;

export class ApiError extends Error {
  constructor(message: string, public status: number = 0, public data?: UntypedJson) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isRetryableError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
}
