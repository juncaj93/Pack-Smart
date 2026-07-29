import type { ApiError, ApiErrorCode } from '@shared/types'

/**
 * Dispatched whenever the API answers 401, so the shell can drop straight to
 * the Unlock screen from anywhere without every caller handling it.
 */
export const SESSION_EXPIRED_EVENT = 'pack-smart:session-expired'

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly retryAfterSeconds?: number

  constructor(status: number, body: ApiError['error']) {
    super(body.message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = body.code
    this.retryAfterSeconds = body.retryAfterSeconds
  }
}

async function parseError(response: Response): Promise<ApiError['error']> {
  try {
    const body = (await response.json()) as Partial<ApiError>
    if (body.error?.code && body.error.message) return body.error
  } catch {
    /* fall through to the generic shape below */
  }
  return { code: 'internal', message: 'Something went wrong. Try again.' }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // The session cookie is HttpOnly, so it rides along automatically; this only
    // guarantees it is sent for same-origin requests under every fetch default.
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  if (response.ok) return (await response.json()) as T

  const error = await parseError(response)

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
  }

  throw new ApiRequestError(response.status, error)
}
