export class ApiError extends Error {
  constructor(message: string, public status: number = 0) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isRetryableError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
}
