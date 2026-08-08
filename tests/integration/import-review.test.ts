import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import { importRoutes } from '../../worker/routes/import'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * The review Alex sees before he commits an import (G5b).
 *
 * The rule this file exists to hold is **Alex's ruling of 2026-08-05**: an
 * exact duplicate is skipped, keeps the stored row's identity, creates nothing,
 * and **never appears in the attention queue**. On a second import of the real
 * workbook that is 118 of 118 rows, so getting it wrong is the difference
 * between a screen that says "nothing to do" and a screen with 118 questions on
 * it — which is the cry-wolf queue that gets clicked through blindly (risk R5).
 */

const WORKBOOK = join(process.cwd(), 'seed-data', 'Master_Packing_Database_Complete.xlsx')

const CLOTHING_HEAD = [
  'Major Category', 'Subcategory', 'Description', 'Brand', 'Color', 'Style', 'Notes',
]
const GEAR_HEAD = ['Item', 'Category', 'Default Priority / Quantity Rule']

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  baseItems = count('SELECT count(*) AS n FROM item')
})

afterEach(() => {
  db.close()
})

const count = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n
let baseItems = 0
const items = () => count('SELECT count(*) AS n FROM item') - baseItems

interface ReviewRow {
  key: string
  name: string
  decision: string
  matchedItemId: string | null
  matchedName: string | null
  why: string | null
  differences: Array<{ field: string; label: string; existing: string | null; incoming: string | null }>
  candidates: Array<{ id: string; name: string }>
  defaultChoice: string
}

interface DryRun {
  review: {
    counts: {
      new: number
      exactDuplicates: number
      updateCandidates: number
      likelyDuplicates: number
      conflicts: number
    }
    attention: ReviewRow[]
    retiredRulesKept: string[]
  }
}

function clothingRow(description: string, brand = '', color = '', notes = ''): string[] {
  return ['Tops', 'T-Shirt', description, brand, color, 'casual', notes]
}

async function call(path: 'dry-run' | 'commit', body: Record<string, unknown>) {
  const response = await importRoutes.request(
    new Request(`https://example.test/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    undefined,
    { DB: db.binding } as never,
  )
  expect(response.status).toBe(200)
  return response.json()
}

const sheets = (clothing: string[][], gear: string[][] = []) => ({
  filename: 'w.xlsx',
  clothing: [CLOTHING_HEAD, ...clothing],
  gear: [GEAR_HEAD, ...gear],
})

async function realWorkbook() {
  const parsed = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const clothing = parsed.find((sheet) => /clothing/i.test(sheet.name))?.rows
  const gear = parsed.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))?.rows
  expect(clothing && gear).toBeTruthy()
  return { filename: 'Master_Packing_Database_Complete.xlsx', clothing: clothing!, gear: gear! }
}

/* ------------------------------------------------------------------ */

describe('the real workbook, imported twice', () => {
  it('asks nothing the second time, because every row is an exact duplicate', async () => {
    const workbook = await realWorkbook()
    await call('commit', workbook)
    const after = items()
    expect(after).toBeGreaterThan(100)

    const dry = (await call('dry-run', workbook)) as DryRun

    // Every row already there, unchanged — and so nothing to decide.
    expect(dry.review.counts.new).toBe(0)
    expect(dry.review.counts.updateCandidates).toBe(0)
    expect(dry.review.counts.likelyDuplicates).toBe(0)
    expect(dry.review.counts.conflicts).toBe(0)
    expect(dry.review.counts.exactDuplicates).toBe(after)

    /*
     * The ruling, asserted directly. 118 exact duplicates and an EMPTY queue.
     */
    expect(dry.review.attention).toEqual([])
  })

  it('names the retired rules rather than letting them come back quietly', async () => {
    const workbook = await realWorkbook()
    await call('commit', workbook)

    const dry = (await call('dry-run', workbook)) as DryRun
    expect(dry.review.retiredRulesKept).toContain('Gas-X')
  })

  it('and committing again still creates nothing', async () => {
    const workbook = await realWorkbook()
    await call('commit', workbook)
    const after = items()

    const second = (await call('commit', workbook)) as { created: number }
    expect(second.created).toBe(0)
    expect(items()).toBe(after)
  })
})

describe('a first import into an empty catalog', () => {
  it('asks nothing at all — everything is new', async () => {
    const dry = (await call('dry-run', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey')]))) as DryRun

    expect(dry.review.counts.new).toBe(1)
    expect(dry.review.attention).toEqual([])
  })
})

describe('a row the spreadsheet has changed', () => {
  const first = [clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'Work staple')]
  const changed = [clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'Work staple; getting thin')]

  it('is an update candidate, with the difference shown both ways round', async () => {
    await call('commit', sheets(first))
    const dry = (await call('dry-run', sheets(changed))) as DryRun

    expect(dry.review.counts.updateCandidates).toBe(1)
    const row = dry.review.attention[0]!
    expect(row.decision).toBe('update_candidate')
    expect(row.matchedName).toBe('Grey Tee')

    const notes = row.differences.find((d) => d.field === 'notes')!
    expect(notes.existing).toBe('Work staple')
    expect(notes.incoming).toBe('Work staple; getting thin')

    // Nothing is overwritten unless he says so.
    expect(row.defaultChoice).toBe('keep_existing')
  })

  it('keeps what is stored when that is the answer', async () => {
    await call('commit', sheets(first))
    const before = items()

    await call('commit', { ...sheets(changed), choices: { 'clothing#2': 'keep_existing' } })

    expect(items()).toBe(before)
    expect(
      (db.raw.prepare('SELECT notes FROM item WHERE display_name = ?').get('Grey Tee') as {
        notes: string
      }).notes,
    ).toBe('Work staple')
  })

  it('updates in place when that is the answer, keeping the same row', async () => {
    await call('commit', sheets(first))
    const before = items()
    const id = (
      db.raw.prepare('SELECT id FROM item WHERE display_name = ?').get('Grey Tee') as {
        id: string
      }
    ).id

    await call('commit', { ...sheets(changed), choices: { 'clothing#2': 'update_existing' } })

    expect(items()).toBe(before)
    const row = db.raw
      .prepare('SELECT id, notes FROM item WHERE display_name = ?')
      .get('Grey Tee') as { id: string; notes: string }

    // The same row, so every trip and outfit pointing at it still does.
    expect(row.id).toBe(id)
    expect(row.notes).toBe('Work staple; getting thin')
  })

  it('adds a second garment when that is the answer', async () => {
    await call('commit', sheets(first))
    const before = items()

    await call('commit', { ...sheets(changed), choices: { 'clothing#2': 'import_separately' } })
    expect(items()).toBe(before + 1)
  })

  it('leaves it out entirely when that is the answer, and records that it did', async () => {
    await call('commit', sheets(first))
    const before = items()

    await call('commit', { ...sheets(changed), choices: { 'clothing#2': 'skip' } })

    expect(items()).toBe(before)
    expect(count("SELECT count(*) AS n FROM import_row WHERE decision = 'skipped_by_user'")).toBe(1)
  })
})

describe('a row whose brand has changed', () => {
  it('is a likely duplicate, and defaults to keeping both', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey')]))
    const dry = (await call('dry-run', sheets([clothingRow('Grey Tee', 'Muji', 'Grey')]))) as DryRun

    const row = dry.review.attention[0]!
    expect(row.decision).toBe('likely_duplicate')
    expect(row.why).toMatch(/different brand/i)

    /*
     * Wrongly skipping a garment loses something Alex cannot get back; wrongly
     * importing one costs an archive tap. The default follows that asymmetry.
     */
    expect(row.defaultChoice).toBe('import_separately')
  })
})

describe('a name that two stored rows already claim', () => {
  /*
   * How two rows come to share a name: the colour is already in the
   * description, so `composeDisplayName` does not prepend it, and
   * `splitColor` puts the rest in `pattern`. That is precisely the shape of
   * the two real Columbia jackets in the workbook.
   */
  it('is a conflict, lists them, and offers no single match', async () => {
    await call('commit', sheets([clothingRow('Black Tee', 'Uniqlo', 'Black')]))
    await call('commit', sheets([clothingRow('Black Tee', 'Uniqlo', 'Black & Gray')]))
    expect(items()).toBe(2)

    const dry = (await call(
      'dry-run',
      sheets([clothingRow('Black Tee', 'Uniqlo', 'Black / White')]),
    )) as DryRun

    expect(dry.review.counts.conflicts).toBe(1)
    const row = dry.review.attention[0]!
    expect(row.decision).toBe('conflict')
    expect(row.matchedItemId).toBeNull()
    expect(row.candidates).toHaveLength(2)
    expect(row.why).toMatch(/2 things/i)

    // No safe single answer, so nothing is quietly merged onto either of them.
    expect(row.defaultChoice).toBe('import_separately')
  })

  it('and the second of the two was itself a likely duplicate, kept rather than merged', async () => {
    await call('commit', sheets([clothingRow('Black Tee', 'Uniqlo', 'Black')]))

    const dry = (await call(
      'dry-run',
      sheets([clothingRow('Black Tee', 'Uniqlo', 'Black & Gray')]),
    )) as DryRun

    const row = dry.review.attention[0]!
    expect(row.decision).toBe('likely_duplicate')
    expect(row.why).toMatch(/different pattern/i)
    expect(row.defaultChoice).toBe('import_separately')
  })
})

describe('the review and the batch', () => {
  it('applies choices inside the one transaction, so a failure still leaves nothing', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'Work staple')]))
    const before = items()

    let writes = 0
    const failing = {
      prepare: (sql: string) => db.binding.prepare(sql),
      batch: () => {
        writes += 1
        throw new Error('connection lost')
      },
    } as unknown as D1Database

    const response = await Promise.resolve(
      importRoutes.request(
        new Request('https://example.test/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'changed')]),
            choices: { 'clothing#2': 'update_existing' },
          }),
        }),
        undefined,
        { DB: failing } as never,
      ),
    ).catch(() => null)

    expect(writes).toBe(1)
    expect(response?.status ?? 500).toBe(500)

    // The update never landed, and neither did anything else.
    expect(items()).toBe(before)
    expect(
      (db.raw.prepare('SELECT notes FROM item WHERE display_name = ?').get('Grey Tee') as {
        notes: string
      }).notes,
    ).toBe('Work staple')
  })

  it('is idempotent: the same choice applied twice changes nothing the second time', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'Work staple')]))
    const changed = sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'changed')])

    await call('commit', { ...changed, choices: { 'clothing#2': 'update_existing' } })
    const after = items()

    // Now it IS an exact duplicate, so the second run is a no-op by itself.
    await call('commit', { ...changed, choices: { 'clothing#2': 'update_existing' } })
    expect(items()).toBe(after)
  })
})
