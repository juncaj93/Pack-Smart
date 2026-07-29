#!/usr/bin/env node
/**
 * Turns a passphrase into the value stored in the AUTH_PASSPHRASE_HASH secret.
 *
 * Run this on YOUR machine. Typing is hidden, and the passphrase is never
 * written to disk, never echoed, and never leaves the computer.
 *
 * Only the derived hash goes to stdout — every human-facing message goes to
 * stderr — so the output can be piped straight into Wrangler without the hash
 * ever appearing on screen:
 *
 *   node scripts/hash-passphrase.mjs | npx wrangler secret put AUTH_PASSPHRASE_HASH
 *
 * Or run it alone to see the value (for pasting into .dev.vars):
 *
 *   npm run hash-passphrase
 */
import { stdin, stderr, stdout } from 'node:process'

const PBKDF2_ITERATIONS = 210_000
const MIN_LENGTH = 12

const BACKSPACE = ['\u0008', '\u007f']
const ENTER = ['\r', '\n']
const CTRL_C = '\u0003'
const CTRL_D = '\u0004'

/**
 * Reads a line with echo suppressed.
 *
 * Uses raw mode rather than readline: readline echoes each keystroke itself, so
 * anything that tries to overwrite the line afterwards is already too late and
 * the passphrase ends up visible in the terminal and in scrollback.
 */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      // Piped input (tests, automation) — read it straight through.
      let piped = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (chunk) => {
        piped += chunk
      })
      stdin.on('end', () => resolve(piped.replace(/[\r\n]+$/, '')))
      stdin.on('error', reject)
      return
    }

    stderr.write(question)

    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    const finish = (result, code) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      stderr.write('\n')
      if (code !== undefined) process.exit(code)
      resolve(result)
    }

    const onData = (chunk) => {
      // A paste arrives as one chunk, so step through it character by character.
      for (const char of chunk) {
        if (ENTER.includes(char)) return finish(value)
        if (char === CTRL_C) return finish('', 130)
        if (char === CTRL_D && value.length === 0) return finish('', 130)

        if (BACKSPACE.includes(char)) {
          if (value.length > 0) {
            value = value.slice(0, -1)
            stderr.write('\b \b')
          }
          continue
        }

        // Ignore control characters (arrow keys, escape sequences, tab).
        if (char < ' ') continue

        value += char
        stderr.write('*')
      }
    }

    stdin.on('data', onData)
  })
}

const passphrase = await promptHidden('Passphrase (typing is hidden): ')

if (passphrase.length < MIN_LENGTH) {
  stderr.write(
    `\nRefusing: use at least ${MIN_LENGTH} characters. This is the only barrier in\n` +
      'front of your travel dates and medication names.\n\n',
  )
  process.exit(1)
}

const salt = crypto.getRandomValues(new Uint8Array(16))
const keyMaterial = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(passphrase),
  'PBKDF2',
  false,
  ['deriveBits'],
)
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
  keyMaterial,
  256,
)

const value = JSON.stringify({
  algorithm: 'pbkdf2-sha256',
  iterations: PBKDF2_ITERATIONS,
  salt: Buffer.from(salt).toString('base64url'),
  hash: Buffer.from(new Uint8Array(bits)).toString('base64url'),
})

// stdout carries the hash and nothing else, so it can be piped cleanly.
stdout.write(value + '\n')

if (stdout.isTTY) {
  stderr.write('\nAUTH_PASSPHRASE_HASH value is above.\n')
  stderr.write('Set it with:  npx wrangler secret put AUTH_PASSPHRASE_HASH\n')
  stderr.write('For local development, put it in .dev.vars instead (gitignored).\n\n')
}
