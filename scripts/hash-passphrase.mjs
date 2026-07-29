#!/usr/bin/env node
/**
 * Turns a passphrase into the value stored in the AUTH_PASSPHRASE_HASH secret.
 *
 * Run this on YOUR machine. It prompts with the input hidden, and prints only
 * the derived hash — the passphrase itself is never written to disk, never
 * echoed to the terminal, and never needs to be sent to anyone.
 *
 *   npm run hash-passphrase
 */
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'

const PBKDF2_ITERATIONS = 210_000

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true })

    // Suppress echo so the passphrase never appears on screen or in scrollback.
    const onData = (char) => {
      if (['\n', '\r', ''].includes(char.toString())) stdin.removeListener('data', onData)
      else stdout.write('[2K[200D' + question + '*'.repeat(rl.line.length))
    }
    stdin.on('data', onData)

    rl.question(question, (answer) => {
      rl.close()
      stdout.write('\n')
      resolve(answer)
    })
  })
}

const passphrase = await promptHidden('Passphrase: ')

if (passphrase.length < 12) {
  console.error('\nRefusing: use at least 12 characters. This is the only barrier in front of')
  console.error('your travel dates and medication names.\n')
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
  salt: toBase64Url(salt),
  hash: toBase64Url(new Uint8Array(bits)),
})

console.log('\nAUTH_PASSPHRASE_HASH value (paste when wrangler prompts):\n')
console.log(value)
console.log('\nNext:  npx wrangler secret put AUTH_PASSPHRASE_HASH')
console.log('For local dev, put it in .dev.vars instead (gitignored).\n')
