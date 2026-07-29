import { describe, expect, it } from 'vitest'
import { extractPdfText } from '../../../shared/extract-text'
import { parseItinerary } from '../../../shared/itinerary'

/**
 * Reading a PDF, without a PDF library.
 *
 * The fixtures below are real PDFs — byte-for-byte valid enough that the
 * extractor sees exactly what it would see from a document produced by a
 * booking system. Building them here rather than committing binaries keeps the
 * test readable and lets each case isolate one thing.
 *
 * The important cases are the failures. A PDF has two ways of yielding nonsense
 * rather than an error: a scan carries images and no text at all, and a
 * subset-encoded font maps bytes to glyphs so extraction "succeeds" and returns
 * mojibake. Both must be refused rather than passed to the interpreter, which
 * would happily find dates in noise.
 */

/*
 * Latin-1 rather than UTF-8, and CompressionStream rather than node:zlib.
 *
 * A PDF's bytes are not UTF-8, so encoding the fixture as UTF-8 would produce a
 * document the extractor is right to reject. CompressionStream is a platform
 * primitive available in the Worker as well as in Node, which keeps this test in
 * the Worker project — that project deliberately carries no Node types, so that
 * Worker code cannot quietly start depending on Node APIs.
 */
function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // Response rather than Blob: it takes a BufferSource directly, with no cast.
  const source = new Response(bytes).body!
  const stream = source.pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function pdf(contentStream: string, options: { compress?: boolean } = {}): Promise<Uint8Array> {
  const raw = latin1Bytes(contentStream)
  const body = options.compress ? await deflate(raw) : raw
  const filter = options.compress ? ' /Filter /FlateDecode' : ''

  const head = latin1Bytes(
    '%PDF-1.4\n' +
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
      '3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n' +
      `4 0 obj << /Length ${body.length}${filter} >>\nstream\n`,
  )
  const tail = latin1Bytes('\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')

  return concat([head, body, tail])
}

/** One line of a page's content stream, in the operators a real PDF uses. */
function line(text: string): string {
  const escaped = text.replace(/([()\\])/g, '\\$1')
  return `BT /F1 12 Tf 72 700 Td (${escaped}) Tj ET\n`
}

const ITINERARY_LINES = [
  'Your trip to South Africa',
  'Destination: Cape Town',
  '2 August 2026 - game drive at first light',
  '3 August 2026 - game drive',
  '5 August 2026 - wine tasting in Stellenbosch',
]

describe('reading a PDF', () => {
  it('reads an uncompressed content stream', async () => {
    const extraction = await extractPdfText(await pdf(ITINERARY_LINES.map(line).join('')))

    expect(extraction.ok).toBe(true)
    expect(extraction.text).toContain('game drive')
    expect(extraction.text).toContain('Cape Town')
  })

  it('inflates a FlateDecode stream, which is what a real PDF uses', async () => {
    const extraction = await extractPdfText(
      await pdf(ITINERARY_LINES.map(line).join(''), { compress: true }),
    )

    expect(extraction.ok).toBe(true)
    expect(extraction.text).toContain('wine tasting')
  })

  /*
   * The whole reason PDF support exists: a dated itinerary knows a safari runs
   * on more than one day. If the extractor ran the lines together, every date
   * would land beside every activity and the day counts would be nonsense.
   */
  it('keeps each line intact, so dates stay with their activities', async () => {
    const extraction = await extractPdfText(
      await pdf(ITINERARY_LINES.map(line).join(''), { compress: true }),
    )
    const proposal = parseItinerary(extraction.text, {
      startDate: '2026-08-01',
      endDate: '2026-08-08',
    })

    expect(proposal.days.filter((d) => d.activityTag === 'safari').map((d) => d.date)).toEqual([
      '2026-08-02',
      '2026-08-03',
    ])
    expect(proposal.days.find((d) => d.activityTag === 'winery')?.date).toBe('2026-08-05')
  })

  it('handles hex strings and escaped parentheses', async () => {
    // "Hello there" as hex, plus a line whose text contains brackets.
    const content =
      `BT /F1 12 Tf 72 700 Td <48656C6C6F207468657265> Tj ET\n` +
      line('2 August 2026 - game drive at dawn (early start)') +
      line('4 August 2026 - wine tasting in Stellenbosch')
    const extraction = await extractPdfText(await pdf(content))

    expect(extraction.ok).toBe(true)
    expect(extraction.text).toContain('Hello there')
    expect(extraction.text).toContain('(early start)')
  })

  it('refuses something that is not a PDF at all', async () => {
    const extraction = await extractPdfText(new TextEncoder().encode('just some text'))
    expect(extraction.ok).toBe(false)
    expect(extraction.problem).toContain('does not look like a PDF')
  })

  /*
   * A scanned itinerary is a picture of an itinerary. There is no text to find,
   * and returning an empty reading would report it as a blank itinerary rather
   * than as an unreadable one.
   */
  it('says a scan holds pictures rather than reporting an empty itinerary', async () => {
    // A page with an image and no text operators — what a scan looks like.
    const extraction = await extractPdfText(await pdf('q 612 0 0 792 0 0 cm /Im1 Do Q\n'))

    expect(extraction.ok).toBe(false)
    expect(extraction.problem).toContain('scan')
  })

  /*
   * The nastier failure. A subset-encoded font maps byte 1 to one glyph and
   * byte 2 to another, so extraction returns real characters in a meaningless
   * order. Nothing throws. The only defence is to look at the output and decide
   * whether it reads like language.
   */
  it('refuses text that came out as mojibake rather than passing it on', async () => {
    // High-byte noise, which is what a subset-encoded font actually produces:
    // real characters, in an order that means nothing.
    const noise = Array.from({ length: 160 }, (_, i) => String.fromCharCode(0xa0 + (i % 90))).join('')
    const extraction = await extractPdfText(await pdf(`BT /F1 12 Tf 72 700 Td (${noise}) Tj ET\n`))

    expect(extraction.ok).toBe(false)
    expect(extraction.problem).toContain('could not be read properly')
  })

  it('refuses a PDF with only a few characters of text', async () => {
    const extraction = await extractPdfText(await pdf(line('Hi')))
    expect(extraction.ok).toBe(false)
  })
})
