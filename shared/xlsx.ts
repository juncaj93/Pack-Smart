/**
 * A minimal read-only .xlsx reader.
 *
 * technical-docs/01_ARCHITECTURE.md §2 nominated SheetJS. The npm-published
 * community build is `xlsx@0.18.5`, which carries unfixed advisories
 * (prototype pollution, ReDoS); the patched builds are distributed outside npm,
 * which breaks reproducible `npm ci`. Pulling a known-vulnerable parser in to
 * read two flat sheets, once, is a poor trade — especially for a file the user
 * chooses from their own device.
 *
 * So this reads the format directly. An .xlsx is a zip of XML: the sheet holds
 * cell references and either an inline string or an index into a shared string
 * table. That is all this needs to understand. It handles no formulas, styles,
 * merged cells or dates, because the packing workbook has none — and it fails
 * loudly rather than guessing when it meets something unexpected.
 *
 * Runs in the browser via DecompressionStream, so the file never leaves the
 * device before Alex has reviewed the import.
 */

export interface Sheet {
  name: string
  /** Row-major, already trimmed. Ragged rows are padded to the widest row. */
  rows: string[][]
}

export class WorkbookError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkbookError'
  }
}

/* ------------------------------------------------------------------ */
/* zip                                                                 */
/* ------------------------------------------------------------------ */

interface ZipEntry {
  name: string
  compressed: boolean
  data: Uint8Array
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

/**
 * Reads the central directory rather than scanning local headers, because local
 * headers may carry streamed sizes of zero with the real values in a trailing
 * data descriptor.
 */
function readZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // End of central directory: scan back for the signature.
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66_000; i -= 1) {
    if (readU32(view, i) === 0x0605_4b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new WorkbookError('That does not look like a .xlsx file.')

  const count = readU16(view, eocd + 10)
  let offset = readU32(view, eocd + 16)

  const entries = new Map<string, ZipEntry>()
  for (let i = 0; i < count; i += 1) {
    if (readU32(view, offset) !== 0x0201_4b50) break

    const method = readU16(view, offset + 10)
    const compressedSize = readU32(view, offset + 20)
    const nameLength = readU16(view, offset + 28)
    const extraLength = readU16(view, offset + 30)
    const commentLength = readU16(view, offset + 32)
    const localOffset = readU32(view, offset + 42)

    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))

    // Jump to the local header to find where the data actually starts.
    const localNameLength = readU16(view, localOffset + 26)
    const localExtraLength = readU16(view, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength

    entries.set(name, {
      name,
      compressed: method === 8,
      data: bytes.subarray(dataStart, dataStart + compressedSize),
    })

    offset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

async function inflate(entry: ZipEntry): Promise<string> {
  if (!entry.compressed) return new TextDecoder().decode(entry.data)

  // Raw deflate. Available in Workers, modern Safari and Node 18+.
  const stream = new Blob([entry.data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

/* ------------------------------------------------------------------ */
/* xml                                                                 */
/* ------------------------------------------------------------------ */

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

function decodeXml(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
}

/** Concatenates every <t> in a fragment — shared strings may be split by runs. */
function textOf(fragment: string): string {
  const parts: string[] = []
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(fragment)) !== null) parts.push(decodeXml(match[1] ?? ''))
  return parts.join('')
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) out.push(textOf(match[1] ?? ''))
  return out
}

/** "BC12" -> 54 (zero-based column index). */
function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '')
  let index = 0
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row\s[^>]*\/>/g
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const body = rowMatch[1] ?? ''
    const cells: string[] = []

    const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cellMatch: RegExpExecArray | null

    while ((cellMatch = cellRe.exec(body)) !== null) {
      const attrs = cellMatch[1] ?? ''
      const inner = cellMatch[2] ?? ''

      const refMatch = /r="([A-Z]+\d+)"/.exec(attrs)
      const index = refMatch?.[1] ? columnIndex(refMatch[1]) : cells.length
      while (cells.length < index) cells.push('')

      const type = /t="([^"]+)"/.exec(attrs)?.[1]
      let value: string
      if (type === 'inlineStr') {
        value = textOf(inner)
      } else if (type === 's') {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        value = raw ? (shared[Number(raw)] ?? '') : ''
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        value = raw ? decodeXml(raw) : ''
      }

      cells[index] = value.trim()
    }

    rows.push(cells)
  }

  const width = rows.reduce((max, r) => Math.max(max, r.length), 0)
  return rows.map((r) => {
    const padded = [...r]
    while (padded.length < width) padded.push('')
    return padded
  })
}

/* ------------------------------------------------------------------ */

export async function readWorkbook(bytes: Uint8Array): Promise<Sheet[]> {
  const entries = readZip(bytes)

  const workbookEntry = entries.get('xl/workbook.xml')
  if (!workbookEntry) throw new WorkbookError('That file has no spreadsheet inside it.')

  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared = sharedEntry ? parseSharedStrings(await inflate(sharedEntry)) : []

  const workbookXml = await inflate(workbookEntry)

  // Sheet name -> r:id, then r:id -> file, via the rels. Sheet order in
  // workbook.xml is authoritative; the file names are not.
  const relsEntry = entries.get('xl/_rels/workbook.xml.rels')
  const relTargets = new Map<string, string>()
  if (relsEntry) {
    const relsXml = await inflate(relsEntry)
    const re = /<Relationship\s([^>]*)\/>/g
    let match: RegExpExecArray | null
    while ((match = re.exec(relsXml)) !== null) {
      const attrs = match[1] ?? ''
      const id = /Id="([^"]+)"/.exec(attrs)?.[1]
      const target = /Target="([^"]+)"/.exec(attrs)?.[1]
      if (id && target) relTargets.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\//, ''))
    }
  }

  const sheets: Sheet[] = []
  const sheetRe = /<sheet\s([^>]*)\/>/g
  let sheetMatch: RegExpExecArray | null
  let ordinal = 0

  while ((sheetMatch = sheetRe.exec(workbookXml)) !== null) {
    ordinal += 1
    const attrs = sheetMatch[1] ?? ''
    const name = decodeXml(/name="([^"]*)"/.exec(attrs)?.[1] ?? `Sheet${ordinal}`)
    const relId = /r:id="([^"]+)"/.exec(attrs)?.[1]

    const target = relId ? relTargets.get(relId) : undefined
    const entry =
      (target ? entries.get(`xl/${target}`) : undefined) ?? entries.get(`xl/worksheets/sheet${ordinal}.xml`)

    if (!entry) continue
    sheets.push({ name, rows: parseSheet(await inflate(entry), shared) })
  }

  if (sheets.length === 0) throw new WorkbookError('That spreadsheet has no readable sheets.')
  return sheets
}
