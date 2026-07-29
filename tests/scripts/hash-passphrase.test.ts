import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { parsePassphraseHash, verifyPassphrase } from '@shared/crypto'

/**
 * Guards scripts/hash-passphrase.mjs — the one place Alex's real passphrase is
 * ever typed.
 *
 * The first version of that script echoed the passphrase in plaintext: it used
 * readline, which writes each keystroke to the terminal before any handler can
 * overwrite it. That bug survived its original check because the check piped
 * input, which never exercises the interactive path at all.
 *
 * Echo suppression needs a real TTY and is verified manually
 * (technical-docs/08_MANUAL_IPHONE_CHECKLIST.md is for the app; the terminal
 * check is noted in 07_SETUP.md). What is pinned here is everything that CAN be
 * checked automatically and would break the login if it regressed.
 *
 * Each run costs a Node start plus 210,000 PBKDF2 iterations, so the script is
 * invoked as few times as possible and the timeouts are generous — this file
 * previously flaked against the 5s default when the whole suite ran in parallel.
 */
const SPAWN_TIMEOUT_MS = 30_000
const PASSPHRASE = 'the-passphrase-under-test'

function runScript(passphrase: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', ['scripts/hash-passphrase.mjs'], {
      input: `${passphrase}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout, status: 0 }
  } catch (error) {
    const err = error as { status?: number; stdout?: string }
    return { stdout: err.stdout ?? '', status: err.status ?? 1 }
  }
}

describe('scripts/hash-passphrase.mjs', () => {
  let output: string

  beforeAll(() => {
    output = runScript(PASSPHRASE).stdout
  }, SPAWN_TIMEOUT_MS)

  it('writes only the hash to stdout, so it can be piped straight into wrangler', () => {
    const trimmed = output.trim()

    expect(trimmed.split('\n')).toHaveLength(1)
    expect(trimmed.startsWith('{"algorithm"')).toBe(true)
    // Prompts and guidance belong on stderr; anything here would corrupt the pipe.
    expect(trimmed).not.toContain('Passphrase')
    expect(trimmed).not.toContain('wrangler')
  })

  it('never emits the passphrase itself', () => {
    expect(output).not.toContain(PASSPHRASE)
  })

  it('produces a hash the Worker accepts for that passphrase, and only that one', async () => {
    const stored = parsePassphraseHash(output.trim())

    expect(stored).not.toBeNull()
    expect(await verifyPassphrase(PASSPHRASE, stored!)).toBe(true)
    expect(await verifyPassphrase('some-other-passphrase', stored!)).toBe(false)
  })

  it(
    'salts every run, so the same passphrase never stores the same value twice',
    () => {
      expect(runScript(PASSPHRASE).stdout.trim()).not.toEqual(output.trim())
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'refuses a passphrase short enough to be guessed, emitting nothing',
    () => {
      const { status, stdout } = runScript('short')
      expect(status).not.toBe(0)
      expect(stdout.trim()).toBe('')
    },
    SPAWN_TIMEOUT_MS,
  )
})
