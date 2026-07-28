/** Thin fetch wrapper. `credentials: same-origin` so the session cookie rides along. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>

  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof body.error === 'string' ? body.error : 'unknown',
      typeof body.message === 'string' ? body.message : res.statusText,
      typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined,
    )
  }

  return body as T
}

export const api = {
  session: () => request<{ authenticated: boolean; expiresAt: number | null }>('/api/auth/session'),

  login: (passphrase: string) =>
    request<{ authenticated: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ passphrase }),
    }),

  logout: () => request<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST' }),
}
