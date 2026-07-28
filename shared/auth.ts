/**
 * Pure authentication primitives, shared by the Worker and the unit tests.
 *
 * Everything here uses Web Crypto, which is available identically in
 * Cloudflare Workers and in Node 18+. No dependencies.
 *
 * Design notes (see technical-docs/01_ARCHITECTURE.md §4):
 * - The session cookie is set by the SERVER with HttpOnly. WebKit caps
 *   JavaScript-set cookies at 7 days, but server-set HttpOnly cookies persist
 *   to their stated expiry. That is the difference between Alex logging in
 *   once a year and once a week.
 * - The session token is a signed random id, never a hash of the passphrase,
 *   so a leaked token reveals nothing about the secret.
 */

export const SESSION_COOKIE = 'ps_session'
export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60 // 1 year

const PBKDF2_ITERATIONS = 100_000

const encoder = new TextEncoder()

// --- base64url helpers -------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Length-independent constant-time comparison. Compares hashes of the inputs
 * so that differing lengths do not short-circuit and leak information.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// --- passphrase hashing ------------------------------------------------------

async function pbkdf2(passphrase: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  )
  return new Uint8Array(bits)
}

/**
 * Produces the string stored in the PACK_SMART_PASSPHRASE_HASH secret.
 * Format: pbkdf2$<iterations>$<saltB64Url>$<hashB64Url>
 */
export async function hashPassphrase(passphrase: string, salt?: Uint8Array): Promise<string> {
  const useSalt = salt ?? crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(passphrase, useSalt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64Url(useSalt)}$${toBase64Url(hash)}`
}

export async function verifyPassphrase(passphrase: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1) return false

  let salt: Uint8Array
  try {
    salt = fromBase64Url(parts[2])
  } catch {
    return false
  }

  const candidate = await pbkdf2(passphrase, salt, iterations)
  return timingSafeEqual(toBase64Url(candidate), parts[3])
}

// --- session tokens ----------------------------------------------------------

export interface SessionPayload {
  /** Random session id. */
  sid: string
  /** Issued-at, epoch seconds. */
  iat: number
  /** Expiry, epoch seconds. */
  exp: number
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return toBase64Url(new Uint8Array(sig))
}

export async function createSessionToken(
  secret: string,
  nowSeconds: number,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  const payload: SessionPayload = {
    sid: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    iat: nowSeconds,
    exp: nowSeconds + maxAgeSeconds,
  }
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = await hmac(secret, body)
  return `${body}.${signature}`
}

/**
 * Returns the payload when the token is authentic and unexpired, otherwise
 * null. Signature is checked before expiry so a tampered token never reaches
 * JSON parsing of attacker-controlled claims.
 */
export async function verifySessionToken(
  secret: string,
  token: string,
  nowSeconds: number,
): Promise<SessionPayload | null> {
  const dot = token.indexOf('.')
  if (dot <= 0) return null

  const body = token.slice(0, dot)
  const signature = token.slice(dot + 1)

  const expected = await hmac(secret, body)
  if (!timingSafeEqual(signature, expected)) return null

  let payload: SessionPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
  } catch {
    return null
  }

  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null
  return payload
}

// --- cookie helpers ----------------------------------------------------------

export function buildSessionCookie(token: string, maxAgeSeconds = SESSION_MAX_AGE_SECONDS): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ')
}

export function buildClearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}
