import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { WorkbookError, readWorkbook, type Sheet } from '@shared/xlsx'

/**
 * Reads the real approved workbook, not a fixture.
 *
 * A fixture would drift from the file the product actually ships with, and the
 * whole point of these assertions is that the seed data is what
 * 04_IMPORT_PLAN.md §3 says it is.
 */
const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'

let sheets: Sheet[]

beforeAll(async () => {
  sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
})

describe('xlsx reader', () => {
  it('finds both sheets, in workbook order', () => {
    expect(sheets.map((s) => s.name)).toEqual(['Clothing Inventory', 'Non-Clothing & Rules'])
  })

  it('reads the clothing header row', () => {
    const header = sheets[0]!.rows.find((r) => r[0] === 'Major Category')
    expect(header?.slice(0, 7)).toEqual([
      'Major Category',
      'Subcategory',
      'Item Description',
      'Brand',
      'Color / Pattern',
      'Style / Use Case',
      'Notes / Versatility',
    ])
  })

  it('reads exactly the 85 approved garments', () => {
    const garments = sheets[0]!.rows.filter(
      (r) => r[0] && r[0] !== 'Major Category' && r[1],
    )
    expect(garments).toHaveLength(85)
  })

  it('decodes an apostrophe in a brand name correctly', () => {
    // Arc'teryx round-trips through XML escaping; a naive reader mangles it.
    const brands = sheets[0]!.rows.map((r) => r[3])
    expect(brands).toContain("Arc'teryx")
  })

  it('preserves the four restored jackets verbatim', () => {
    const rows = sheets[0]!.rows
    const find = (desc: string, brand: string, color: string) =>
      rows.find((r) => r[2] === desc && r[3] === brand && r[4] === color)

    expect(find('Jacket', "Arc'teryx", 'Black')?.[6]).toBe('Versatile lightweight black jacket')
    expect(find('Parka Jacket', 'The North Face', 'Black')?.[6]).toBe(
      'Warm black parka for very cold weather',
    )
    expect(find('Jacket', 'Vuori', 'Black')).toBeTruthy()
    expect(find('Quilted Jacket', 'The North Face', 'Olive')).toBeTruthy()
  })

  it('reads the gear sheet, which stacks two tables', () => {
    const rows = sheets[1]!.rows
    // 33 gear items between the two section headers.
    const items = rows.filter((r) => r[0] && r[1] && r[2] && r[0] !== 'Item')
    expect(items.length).toBeGreaterThanOrEqual(33)

    // The conditional triggers have an empty third column, which is how the
    // parser tells the two tables apart.
    const triggers = rows.filter((r) => r[0] && r[1] && !r[2] && r[0] !== 'Trip Condition')
    expect(triggers.length).toBeGreaterThanOrEqual(7)
  })

  it('finds the specific rows the import plan calls out', () => {
    const flat = sheets[1]!.rows.map((r) => r.join('|'))
    expect(flat.some((r) => r.startsWith('Synthroid|'))).toBe(true)
    expect(flat.some((r) => r.startsWith('Contacts|'))).toBe(true)
    expect(flat.some((r) => r.startsWith('Shaver|'))).toBe(true)
    expect(flat.some((r) => r.includes('Shaver Charger'))).toBe(true)
  })

  it('rejects a file that is not a spreadsheet, without crashing', async () => {
    await expect(readWorkbook(new TextEncoder().encode('this is not a zip'))).rejects.toBeInstanceOf(
      WorkbookError,
    )
  })
})
