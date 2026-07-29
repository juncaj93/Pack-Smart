/**
 * Turning a PDF or a web page into plain text.
 *
 * Both feed the one itinerary interpreter (product doc 02 §5 Step 3). Neither
 * is allowed to return a partial or approximate reading: a format that cannot be
 * turned into text is a FAILED extraction, reported as such, and the screen
 * offers the paste box instead.
 *
 * That rule is doing real work here. Both of these formats have a failure mode
 * that produces plausible-looking rubbish rather than an obvious error — a
 * scanned PDF yields nothing, a subset-encoded PDF yields mojibake, and a login
 * page yields a perfectly readable page that is not the itinerary. Each is
 * checked for below.
 *
 * No dependencies, by the same rule as the spreadsheet reader: `DecompressionStream`
 * is a platform primitive in both the Worker and the browser.
 */

export interface Extraction {
  text: string
  ok: boolean
  /** Why it failed, in Alex's words. Null when it worked. */
  problem: string | null
}

const failed = (problem: string): Extraction => ({ text: '', ok: false, problem })

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

/** `(...)` and `<hex>` strings inside a text-showing operator. */
function decodePdfString(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = raw[++i]
    if (next === undefined) break
    if (next === 'n') out += '\n'
    else if (next === 'r') out += '\n'
    else if (next === 't') out += ' '
    else if (next >= '0' && next <= '7') {
      // Octal escape: up to three digits.
      let octal = next
      while (octal.length < 3 && raw[i + 1] !== undefined && raw[i + 1]! >= '0' && raw[i + 1]! <= '7') {
        octal += raw[++i]
      }
      out += String.fromCharCode(Number.parseInt(octal, 8))
    } else out += next
  }
  return out
}

function decodeHexString(raw: string): string {
  const hex = raw.replace(/[^0-9A-Fa-f]/g, '')
  let out = ''
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16))
  }
  return out
}

/**
 * Pulls readable text out of one decoded content stream.
 *
 * Handles the four text-showing operators — `Tj`, `TJ`, `'` and `"` — and treats
 * `Td`, `TD` and `T*` as line breaks, which is what keeps "3 August" and
 * "Safari" on the same line when they were on the same line in the document.
 * Getting that wrong would break the one thing this whole feature is for:
 * knowing which activity falls on which date.
 */
function textFromContentStream(content: string): string {
  let out = ''

  const token = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\bT[dDjJ*]\b|\bTJ\b|'|"/g

  for (const match of content.matchAll(token)) {
    const value = match[0]
    if (value.startsWith('(')) out += decodePdfString(value.slice(1, -1))
    else if (value.startsWith('<')) out += decodeHexString(value.slice(1, -1))
    else if (value === 'Td' || value === 'TD' || value === 'T*' || value === "'" || value === '"') {
      out += '\n'
    }
  }

  return out
}

async function inflate(bytes: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<string | null> {
  try {
    const stream = new Blob([bytes as unknown as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream(format))
    return await new Response(stream).text()
  } catch {
    return null
  }
}

/** Latin-1 rather than UTF-8: PDF byte strings are not UTF-8 and must not be re-decoded as it. */
function latin1(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!)
  return out
}

/**
 * How much of this looks like language.
 *
 * A PDF whose fonts are subset-encoded maps byte 1 to some glyph and byte 2 to
 * another, so extraction yields real characters in a meaningless order. There is
 * no error to catch — the parse "succeeds" and returns mojibake. The only
 * defence is to look at the result and decide whether it reads like text.
 */
function readableRatio(text: string): number {
  if (text.length === 0) return 0
  const readable = text.match(/[A-Za-z0-9 .,:;()/\-\n]/g)?.length ?? 0
  return readable / text.length
}

const MIN_READABLE_RATIO = 0.8
const MIN_USEFUL_CHARS = 40

export async function extractPdfText(bytes: Uint8Array): Promise<Extraction> {
  if (latin1(bytes.slice(0, 5)) !== '%PDF-') {
    return failed('That does not look like a PDF.')
  }

  const raw = latin1(bytes)
  let collected = ''

  /*
   * Walks every `stream ... endstream` block.
   *
   * Both compressed and uncompressed streams are tried, because deciding from
   * the dictionary which is which means parsing object references, and guessing
   * wrong silently loses a page. Inflating something that was never deflated
   * simply fails and falls through to reading it as-is.
   */
  const blocks = raw.matchAll(/stream\r?\n?([\s\S]*?)endstream/g)

  for (const block of blocks) {
    const body = block[1] ?? ''
    if (body.length === 0) continue

    const bytesOfBlock = new Uint8Array(body.length)
    for (let i = 0; i < body.length; i += 1) bytesOfBlock[i] = body.charCodeAt(i) & 0xff

    /*
     * The end-of-line before `endstream` is a delimiter, not stream data.
     *
     * Feeding it to the inflater is one trailing byte of junk after a complete
     * deflate stream, and `DecompressionStream` rejects the whole thing for it —
     * which looked exactly like "this PDF is not compressed" and silently lost
     * every compressed page. Both readings are tried rather than guessing which
     * convention the producer used.
     */
    const trimmed = bytesOfBlock.subarray(
      0,
      bytesOfBlock.length - (body.endsWith('\r\n') ? 2 : body.endsWith('\n') || body.endsWith('\r') ? 1 : 0),
    )

    const inflated =
      (await inflate(trimmed, 'deflate')) ??
      (await inflate(bytesOfBlock, 'deflate')) ??
      (await inflate(trimmed, 'deflate-raw')) ??
      (await inflate(bytesOfBlock, 'deflate-raw'))

    const content = inflated ?? body
    if (!/\bT[jJ*]\b|\bTd\b/.test(content)) continue

    collected += `${textFromContentStream(content)}\n`
  }

  const text = collected.replace(/\n{3,}/g, '\n\n').trim()

  if (text.length < MIN_USEFUL_CHARS) {
    return failed(
      'No text could be read from that PDF. If it is a scan or a photo it holds pictures rather than text — paste the itinerary instead.',
    )
  }

  if (readableRatio(text) < MIN_READABLE_RATIO) {
    return failed(
      'That PDF’s text could not be read properly — its fonts do not carry readable characters. Paste the itinerary instead.',
    )
  }

  return { text, ok: true, problem: null }
}

/* ------------------------------------------------------------------ */
/* HTML                                                                */
/* ------------------------------------------------------------------ */

const BLOCK_TAGS = /<\/?(?:p|div|br|tr|li|h[1-6]|section|article|table)\b[^>]*>/gi

/**
 * Strips a page down to its text.
 *
 * Script and style content is removed outright rather than tag-stripped —
 * leaving it in floods the interpreter with dates and words out of JSON blobs
 * and CSS, and a page's analytics payload is a rich source of dates that mean
 * nothing.
 */
export function extractHtmlText(html: string): Extraction {
  const withoutCode = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  const text = withoutCode
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')

  if (text.length < MIN_USEFUL_CHARS) {
    return failed('There was almost no text on that page.')
  }

  /*
   * A link behind a login returns the login page, not the itinerary — and it
   * returns it with a perfectly ordinary 200. Airline and hotel confirmation
   * links are nearly all of this kind, so it is worth naming rather than letting
   * Alex wonder why his itinerary came back empty.
   */
  if (/\b(sign in|sign-in|log in|log-in|login|password|create an account)\b/i.test(text.slice(0, 600))) {
    return failed(
      'That link opened a sign-in page rather than the itinerary. Pages behind a login cannot be read — open it yourself and paste the text.',
    )
  }

  return { text, ok: true, problem: null }
}
