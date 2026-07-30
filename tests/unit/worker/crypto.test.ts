import { describe, expect, it } from 'vitest'
import {
  SESSION_TTL_SECONDS,
  createPassphraseHash,
  createSessionToken,
  parsePassphraseHash,
  timingSafeEqual,
  verifyPassphrase,
  verifySessionToken,
} from '@shared/crypto'

const SECRET = 'test-session-secret-not-used-anywhere-real'
const NOW = 1_800_000_000

describe('timingSafeEqual', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true)
  })

  it('rejects differing strings of equal length', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false)
  })

  it('rejects differing lengths without short-circuiting', () => {
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false)
    expect(timingSafeEqual('', 'a')).toBe(false)
  })
})

describe('passphrase hashing', () => {
  it('verifies the correct passphrase', async () => {
    const stored = await createPassphraseHash('correct horse battery staple')
    expect(await verifyPassphrase('correct horse battery staple', stored)).toBe(true)
  })

  it('rejects a wrong passphrase, including a near miss', async () => {
    const stored = await createPassphraseHash('correct horse battery staple')
    expect(await verifyPassphrase('correct horse battery stapler', stored)).toBe(false)
    expect(await verifyPassphrase('', stored)).toBe(false)
  })

  it('salts each hash independently, so the same passphrase never stores the same value', async () => {
    const a = await createPassphraseHash('same passphrase here')
    const b = await createPassphraseHash('same passphrase here')
    expect(a.salt).not.toEqual(b.salt)
    expect(a.hash).not.toEqual(b.hash)
  })

  it('round-trips through the serialized secret form', async () => {
    const stored = await createPassphraseHash('a passphrase to serialize')
    const parsed = parsePassphraseHash(JSON.stringify(stored))
    expect(parsed).not.toBeNull()
    expect(await verifyPassphrase('a passphrase to serialize', parsed!)).toBe(true)
  })

  it('rejects malformed or unexpected secret values', () => {
    expect(parsePassphraseHash('not json')).toBeNull()
    expect(parsePassphraseHash('null')).toBeNull()
    expect(parsePassphraseHash('{"algorithm":"md5"}')).toBeNull()
    expect(parsePassphraseHash('{"algorithm":"pbkdf2-sha256","iterations":1}')).toBeNull()
  })
})

describe('session tokens', () => {
  it('verifies a freshly issued token', async () => {
    const token = await createSessionToken(SECRET, NOW)
    const verified = await verifySessionToken(token, SECRET, NOW)
    expect(verified).not.toBeNull()
    expect(verified?.expiresAt).toBe(NOW + SESSION_TTL_SECONDS)
  })

  it('carries no derivative of the passphrase — only a random nonce', async () => {
    const a = await createSessionToken(SECRET, NOW)
    const b = await createSessionToken(SECRET, NOW)
    expect(a).not.toEqual(b)
  })

  it('rejects a token signed with a different secret (rotation revokes sessions)', async () => {
    const token = await createSessionToken(SECRET, NOW)
    expect(await verifySessionToken(token, 'a-different-secret', NOW)).toBeNull()
  })

  /*
   * Tampering that is CERTAIN to change the string, rather than probably.
   *
   * Both tests below used to append a fixed `XY`, which is a no-op whenever the
   * value already ended in those two characters — and a session signature is a
   * random HMAC, so that happens about once in 4096 runs. It duly happened on CI
   * (run 30510616014) and failed a test the product passes: `verifySessionToken`
   * compares the whole signature string, so its only way to return a token is for
   * the "forgery" to be byte-identical to the real thing. Deriving the substitute
   * from the character it replaces removes the coin flip.
   */
  const tamper = (value: string) => `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`

  it('rejects a tampered payload', async () => {
    const token = await createSessionToken(SECRET, NOW)
    const [payload, signature] = token.split('.')
    expect(await verifySessionToken(`${tamper(payload!)}.${signature}`, SECRET, NOW)).toBeNull()
  })

  it('rejects a tampered signature', async () => {
    const token = await createSessionToken(SECRET, NOW)
    const [payload, signature] = token.split('.')
    expect(await verifySessionToken(`${payload}.${tamper(signature!)}`, SECRET, NOW)).toBeNull()
  })

  it('rejects a structurally invalid token', async () => {
    expect(await verifySessionToken('', SECRET, NOW)).toBeNull()
    expect(await verifySessionToken('nodot', SECRET, NOW)).toBeNull()
    expect(await verifySessionToken('.onlysignature', SECRET, NOW)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const token = await createSessionToken(SECRET, NOW, 60)
    expect(await verifySessionToken(token, SECRET, NOW + 59)).not.toBeNull()
    expect(await verifySessionToken(token, SECRET, NOW + 60)).toBeNull()
    expect(await verifySessionToken(token, SECRET, NOW + 61)).toBeNull()
  })

  it('defaults to a one-year lifetime, matching the approved cookie Max-Age', () => {
    // 01_ARCHITECTURE.md §4. The long life is only safe because the cookie is
    // server-set and HttpOnly — WebKit caps JS-set cookies at 7 days.
    expect(SESSION_TTL_SECONDS).toBe(31_536_000)
  })
})
