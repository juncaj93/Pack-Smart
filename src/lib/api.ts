import { announceCached, announceLive } from '@/lib/offline'
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
  /**
   * Per-field validation messages, keyed by field name, when the server rejected
   * a form. Lets a sheet highlight the offending input instead of showing one
   * generic message above everything.
   */
  readonly fields: Record<string, string>

  constructor(status: number, body: ApiError['error'], fields: Record<string, string> = {}) {
    super(body.message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = body.code
    this.retryAfterSeconds = body.retryAfterSeconds
    this.fields = fields
  }
}

interface ParsedError {
  error: ApiError['error']
  fields: Record<string, string>
}

async function parseError(response: Response): Promise<ParsedError> {
  try {
    const body = (await response.json()) as Partial<ApiError> & {
      fields?: Record<string, string>
    }
    if (body.error?.code && body.error.message) {
      return { error: body.error, fields: body.fields ?? {} }
    }
  } catch {
    /* fall through to the generic shape below */
  }
  return {
    error: { code: 'internal', message: 'Something went wrong. Try again.' },
    fields: {},
  }
}

function rawFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(path, {
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
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await rawFetch(path, init)
  } catch (cause) {
    /*
     * The request never reached the server.
     *
     * This is the earliest and most reliable offline signal the app gets — the
     * session check fails this way before any screen has asked for data — so it
     * drives the banner rather than waiting for a cached response to arrive.
     */
    announceCached()
    throw cause
  }

  if (response.ok) {
    // The service worker sets this when it could not reach the server and
    // answered from its cache. Saying so is the difference between "this is
    // your trip" and "this is your trip as of the last time you had signal".
    if (response.headers.get('x-pack-smart-cached') === '1') announceCached()
    else announceLive()
    return (await response.json()) as T
  }

  const parsed = await parseError(response)

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
  }

  throw new ApiRequestError(response.status, parsed.error, parsed.fields)
}
