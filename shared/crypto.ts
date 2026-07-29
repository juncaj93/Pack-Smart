/**
 * Passphrase hashing and session-token signing.
 *
 * Pure WebCrypto, which exists identically in the Worker runtime, in browsers,
 * and in Node 22 — so these functions are directly unit-testable without a
 * platform shim.
 *
 * Approved design (technical-docs/01_ARCHITECTURE.md §4, risk R9):
 *   - the passphrase is verified against a HASHED value held in a Worker secret
 *   - the session value is a SIGNED RANDOM TOKEN, never a hash of the passphrase
 */

const PBKDF2_ITERATIONS = 210_000
const PBKDF2_HASH = 'SHA-256'
const DERIVED_KEY_BITS = 256

const encoder = new TextEncoder()

/* ------------------------------------------------------------------ */
/* base64url                                                           */
/* ------------------------------------------------------------------ */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

/* ------------------------------------------------------------------ */
/* constant-time comparison                                            */
/* ------------------------------------------------------------------ */

/**
 * Compares two strings without leaking their common prefix length through
 * timing. Length is compared first and always folded into the result, so an
 * early return on differing lengths cannot short-circuit the loop.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  let diff = aBytes.length ^ bBytes.length
  const max = Math.max(aBytes.length, bBytes.length)
  for (let i = 0; i < max; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  }
  return diff === 0
}

/* ------------------------------------------------------------------ */
/* passphrase hashing                                                  */
/* ------------------------------------------------------------------ */

/** Serialized form stored in the AUTH_PASSPHRASE_HASH secret. */
export interface PassphraseHash {
  algorithm: 'pbkdf2-sha256'
  iterations: number
  salt: string
  hash: string
}

export async function derivePassphraseHash(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    // A fresh copy keeps the BufferSource type stable across DOM and Workers lib defs.
    { name: 'PBKDF2', salt: salt.slice(), iterations, hash: PBKDF2_HASH },
    keyMaterial,
    DERIVED_KEY_BITS,
  )
  return toBase64Url(new Uint8Array(bits))
}

/** Produces the value Alex stores in the AUTH_PASSPHRASE_HASH secret. */
export async function createPassphraseHash(passphrase: string): Promise<PassphraseHash> {
  const salt = randomBytes(16)
  return {
    algorithm: 'pbkdf2-sha256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64Url(salt),
    hash: await derivePassphraseHash(passphrase, salt, PBKDF2_ITERATIONS),
  }
}

export function parsePassphraseHash(serialized: string): PassphraseHash | null {
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Partial<PassphraseHash>
    if (
      candidate.algorithm !== 'pbkdf2-sha256' ||
      typeof candidate.iterations !== 'number' ||
      typeof candidate.salt !== 'string' ||
      typeof candidate.hash !== 'string'
    ) {
      return null
    }
    return candidate as PassphraseHash
  } catch {
    return null
  }
}

export async function verifyPassphrase(
  passphrase: string,
  stored: PassphraseHash,
): Promise<boolean> {
  const candidate = await derivePassphraseHash(
    passphrase,
    fromBase64Url(stored.salt),
    stored.iterations,
  )
  return timingSafeEqual(candidate, stored.hash)
}

/* ------------------------------------------------------------------ */
/* session tokens                                                      */
/* ------------------------------------------------------------------ */

/**
 * One year, matching the approved cookie Max-Age.
 *
 * The long life is only safe because the cookie is server-set and HttpOnly:
 * WebKit caps *JavaScript-set* cookies at 7 days, while server-set ones persist
 * to their stated expiry. That difference is what makes M0 acceptance criterion
 * "session survives a week of disuse" achievable at all.
 */
export const SESSION_TTL_SECONDS = 31_536_000

export interface SessionToken {
  /** Random nonce — the token carries no derivative of the passphrase. */
  nonce: string
  /** Unix seconds. */
  issuedAt: number
  /** Unix seconds. */
  expiresAt: number
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return toBase64Url(new Uint8Array(signature))
}

/** Creates `<payload>.<signature>`, both base64url. */
export async function createSessionToken(
  secret: string,
  nowSeconds: number,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const token: SessionToken = {
    nonce: toBase64Url(randomBytes(32)),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
  }
  const payload = toBase64Url(encoder.encode(JSON.stringify(token)))
  return `${payload}.${await sign(payload, secret)}`
}

/**
 * Returns the token only when the signature verifies AND it has not expired.
 * The signature is always checked before the payload is trusted.
 */
export async function verifySessionToken(
  value: string,
  secret: string,
  nowSeconds: number,
): Promise<SessionToken | null> {
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null

  const payload = value.slice(0, separator)
  const signature = value.slice(separator + 1)

  const expected = await sign(payload, secret)
  if (!timingSafeEqual(signature, expected)) return null

  let token: SessionToken
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)))
    if (typeof decoded !== 'object' || decoded === null) return null
    const candidate = decoded as Partial<SessionToken>
    if (
      typeof candidate.nonce !== 'string' ||
      typeof candidate.issuedAt !== 'number' ||
      typeof candidate.expiresAt !== 'number'
    ) {
      return null
    }
    token = candidate as SessionToken
  } catch {
    return null
  }

  if (token.expiresAt <= nowSeconds) return null
  return token
}
