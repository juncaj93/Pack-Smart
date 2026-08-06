import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  coverageWarnings,
  dedupe,
  extractQuantity,
  normalizeGarment,
  parseCriticality,
  parseGear,
  parseGearRule,
  splitCategory,
  splitColor,
  type ClothingSource,
  type GearSource,
  type NormalizedGarment,
  type ParsedGear,
} from '@shared/import'
import { readWorkbook, type Sheet } from '@shared/xlsx'

/**
 * The M1 acceptance criteria, asserted against the real approved workbook.
 *
 * These are copied from technical-docs/05_MILESTONE_PLAN.md M1 and
 * 04_IMPORT_PLAN.md §8 rather than invented, because the numbers are the point:
 * "exactly 3 review cards" is a claim about this specific data, and a review
 * queue that cries wolf is functionally the same as auto-merging (risk R5).
 */

let sheets: Sheet[]
let garments: NormalizedGarment[]
let gear: ParsedGear[]

beforeAll(async () => {
  sheets = await readWorkbook(
    new Uint8Array(readFileSync('seed-data/Master_Packing_Database_Complete.xlsx')),
  )

  garments = sheets[0]!.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r[0] && r[0] !== 'Major Category' && r[1])
    .map(({ r, i }) =>
      normalizeGarment({
        majorCategory: r[0] ?? '',
        subcategory: r[1] ?? '',
        description: r[2] ?? '',
        brand: r[3] ?? '',
        color: r[4] ?? '',
        styleUse: r[5] ?? '',
        notes: r[6] ?? '',
        rowNumber: i + 1,
      } satisfies ClothingSource),
    )

  gear = sheets[1]!.rows
    .map((r, i) => ({ r, i }))
    // The gear table has three populated columns; the trigger table below it has two.
    .filter(({ r }) => r[0] && r[1] && r[2] && r[0] !== 'Item')
    .map(({ r, i }) =>
      parseGear({
        item: r[0] ?? '',
        category: r[1] ?? '',
        rule: r[2] ?? '',
        rowNumber: i + 1,
      } satisfies GearSource),
    )
})

describe('M1 acceptance — clothing', () => {
  it('reads all 85 garments', () => {
    expect(garments).toHaveLength(85)
  })

  it('imports all 85 as distinct, with no exact or identity duplicates', () => {
    const result = dedupe(garments)
    expect(result.exactDuplicates).toHaveLength(0)
    expect(result.identityDuplicates).toHaveLength(0)
    expect(result.unique).toHaveLength(85)
  })

  it('raises EXACTLY 3 review cards', () => {
    const { reviewCards } = dedupe(garments)

    // A naive same-description-and-brand rule would flag 13 groups (~30 rows).
    // The colour discriminator auto-resolves the other 10.
    expect(
      reviewCards.length,
      `got ${reviewCards.length}: ${reviewCards.map((c) => `${c.brand} ${c.description}`).join('; ')}`,
    ).toBe(3)
  })

  it('raises them for exactly the three groups the import plan names', () => {
    const { reviewCards } = dedupe(garments)
    const labels = reviewCards.map((c) => `${c.brand} ${c.description}`.toLowerCase()).sort()

    expect(labels).toEqual([
      'brooks running shoes',
      'columbia zip-up jacket',
      'nordstrom layering t-shirt',
    ])
  })

  it('never lets "Unspecified" reach a display name', () => {
    for (const g of garments) {
      expect(g.displayName.toLowerCase(), g.displayName).not.toContain('unspecified')
    }
    // And those garments still import, just without a colour.
    const slides = garments.find((g) => g.source.description === 'Slides')
    expect(slides?.color).toBeNull()
    /*
     * **Changed deliberately by G6.** This used to be `Nike Slides` — the brand
     * composed into the name beside a `brand` column that already said it. The
     * name is now what the thing IS, and `Nike` is still there, in its own
     * field, where `garmentDetail` reads it and search matches it.
     */
    expect(slides?.displayName).toBe('Slides')
    expect(slides?.brand).toBe('Nike')
  })

  /*
   * G6, stated over the whole workbook rather than one row: a garment's name is
   * the description column, and never the brand or the colour again.
   *
   * Measured before the change, which is why the slice exists: of these 85 rows,
   * 70 carried both the brand and the colour inside the name, 3 the brand, 11
   * the colour, and 1 neither — that last one having neither recorded.
   */
  it('names a garment for what it is, not for its own other columns', () => {
    for (const g of garments) {
      expect(g.displayName, g.displayName).toBe(g.displayName.trim())
      expect(g.displayName.length, g.displayName).toBeGreaterThan(0)

      /*
       * The exact claim, rather than a proxy for it: the name IS the
       * spreadsheet's own description column with the quantity taken out.
       *
       * A proxy — "does not start with the brand" — would have been wrong in
       * both directions. `Taylor Stitch Plaid Button-Up` has the colour `Plaid`
       * and a description that begins with it, because Alex wrote it that way;
       * a rule about prefixes would either fail on his wording or have to
       * excuse it. Comparing against the source column has no such gap.
       */
      expect(g.displayName, g.source.description).toBe(
        extractQuantity(g.source.description).name,
      )
    }

    // And the worked example from doc 09 §6a, end to end.
    const boxers = garments.find((g) => g.source.description.startsWith('Boxer Briefs'))!
    expect(boxers.displayName).toBe('Boxer Briefs')
    expect(boxers.brand).toBe('Pair of Thieves')
    expect(boxers.color).toBe('Various Colors')
  })

  it('turns "Boxer Briefs (~15 Pairs)" into a name and a count', () => {
    const boxers = garments.find((g) => g.source.description.startsWith('Boxer Briefs'))
    expect(boxers?.displayName).toContain('Boxer Briefs')
    expect(boxers?.displayName).not.toContain('15')
    expect(boxers?.ownedQuantity).toBe(15)
  })

  it('records "Multiple Pairs" as unknown rather than guessing a number', () => {
    const socks = garments.find((g) => g.source.description.startsWith('Socks'))
    expect(socks?.ownedQuantity).toBeNull()
    expect(socks?.derived.join(' ')).toMatch(/does not say how many/i)
  })

  it('keeps the four restored jackets with their original text intact', () => {
    const find = (desc: string, brand: string) =>
      garments.find((g) => g.source.description === desc && g.source.brand === brand)

    expect(find('Jacket', "Arc'teryx")?.notes).toBe('Versatile lightweight black jacket')
    expect(find('Parka Jacket', 'The North Face')?.notes).toBe(
      'Warm black parka for very cold weather',
    )
    expect(find('Jacket', 'Vuori')?.notes).toBe('Comfortable casual black jacket')
    expect(find('Quilted Jacket', 'The North Face')?.notes).toContain('Quilted olive jacket')
  })

  it('gives every source row a recorded outcome', () => {
    const { unique, exactDuplicates, identityDuplicates } = dedupe(garments)
    expect(unique.length + exactDuplicates.length + identityDuplicates.length).toBe(garments.length)
  })

  it('is idempotent — re-running produces the same result', () => {
    const a = dedupe(garments)
    const b = dedupe(garments)
    expect(b.unique.map((g) => g.identityHash)).toEqual(a.unique.map((g) => g.identityHash))
    expect(b.reviewCards).toHaveLength(a.reviewCards.length)
  })

  it('reports the rain-layer gap honestly instead of guessing around it', () => {
    const warnings = coverageWarnings(garments)
    expect(warnings.join(' ')).toMatch(/waterproof/i)

    // Specifically: the Arc'teryx must NOT be promoted into a rain shell just
    // because of the brand (risk R1, and doc 03 §5's hard line).
    const arc = garments.find((g) => g.brand === "Arc'teryx" && g.source.description === 'Jacket')
    expect(arc?.typicalUses).not.toContain('rain')
  })
})

describe('normalization details', () => {
  it('splits compound colours into colour and pattern', () => {
    expect(splitColor('Green / White')).toEqual({ color: 'Green', pattern: 'White' })
    expect(splitColor('Black & Gray')).toEqual({ color: 'Black', pattern: 'Gray' })
    expect(splitColor('Black')).toEqual({ color: 'Black', pattern: null })
    expect(splitColor('Unspecified')).toEqual({ color: null, pattern: null })
  })

  it('pulls counts out of descriptions without mangling ordinary brackets', () => {
    expect(extractQuantity('Boxer Briefs (~15 Pairs)')).toMatchObject({ name: 'Boxer Briefs', quantity: 15 })
    expect(extractQuantity('Compression Shorts (4 Pairs)')).toMatchObject({ quantity: 4 })
    expect(extractQuantity('Socks (Multiple Pairs)')).toMatchObject({ quantity: null, unknownQuantity: true })
    // "(New)" is a qualifier, not a count — keep it.
    expect(extractQuantity('Joggers (New)').name).toBe('Joggers (New)')
  })

  it('drops "Unbranded" rather than printing it', () => {
    const g = normalizeGarment({
      majorCategory: 'Footwear', subcategory: 'Shoes', description: 'Pickleball Shoes',
      brand: 'Unbranded', color: 'Unspecified', styleUse: 'Athletic', notes: '', rowNumber: 1,
    })
    expect(g.brand).toBeNull()
    expect(g.displayName).toBe('Pickleball Shoes')
  })

  /*
   * **Changed deliberately by G6.** The name used to be `Vuori Black Jacket`;
   * this test existed because the composer was careful not to make it
   * `Black Vuori Black Jacket`. There is no composer now, so the care it
   * needed is gone — but the thing that care protected is not: a colour Alex
   * wrote INTO the description is his wording and stays there.
   */
  it('keeps a colour Alex wrote into the description himself', () => {
    const g = normalizeGarment({
      majorCategory: 'Tops & Outerwear', subcategory: 'Outerwear', description: 'Black Jacket',
      brand: 'Vuori', color: 'Black', styleUse: 'Travel / Casual', notes: '', rowNumber: 1,
    })
    expect(g.displayName).toBe('Black Jacket')
    expect(g.brand).toBe('Vuori')
    expect(g.color).toBe('Black')
  })
})

describe('M1 acceptance — gear and rules', () => {
  it('reads all 33 gear items', () => {
    expect(gear).toHaveLength(33)
  })

  it('resolves the self-contradictory shaver rule to 3 nights or more', () => {
    const shaver = gear.find((g) => g.displayName === 'Shaver')
    expect(shaver?.rule?.ruleType).toBe('conditional_include')
    expect(shaver?.rule?.condition).toEqual({ fact: 'nights', gte: 3 })
    // The original ambiguity is preserved, not overwritten.
    expect(shaver?.originalText).toMatch(/2-3/)
    expect(shaver?.derived.join(' ')).toMatch(/ambiguous/i)
  })

  it('applies the approved contacts rule over the spreadsheet text', () => {
    const contacts = gear.find((g) => g.displayName === 'Contacts')
    expect(contacts?.rule?.ruleType).toBe('per_day')
    expect(contacts?.rule?.quantityValue).toBe(2)
    expect(contacts?.originalText).toMatch(/nights/i)
    expect(contacts?.derived.join(' ')).toMatch(/calendar day/i)
  })

  it('gives Synthroid trip days plus a two-day buffer', () => {
    const s = gear.find((g) => g.displayName === 'Synthroid')
    expect(s?.rule?.ruleType).toBe('duration_plus_buffer')
    expect(s?.rule?.buffer).toBe(2)
    expect(s?.isCritical).toBe(true)
  })

  it('models chargers as depending on their device', () => {
    const shaverCharger = gear.find((g) => g.displayName === 'Shaver Charger')
    expect(shaverCharger?.rule?.ruleType).toBe('dependency_include')
    expect(shaverCharger?.rule?.dependsOn).toMatch(/shaver/i)
  })

  it('surfaces the toothbrush-charger ambiguity instead of rewriting it', () => {
    const tb = gear.find((g) => g.displayName === 'Toothbrush Charger')
    expect(tb?.derived.join(' ')).toMatch(/electric/i)
  })

  it('flags the ambiguous "Medicine Wheel" name', () => {
    const mw = gear.find((g) => g.displayName === 'Medicine Wheel')
    expect(mw?.derived.join(' ')).toMatch(/ambiguous/i)
  })

  it('makes the passport conditional on international travel', () => {
    const p = gear.find((g) => g.displayName === 'Passport')
    expect(p?.rule?.condition).toEqual({ fact: 'international', eq: true })
  })

  it('splits Bug Spray’s dual category', () => {
    const b = gear.find((g) => g.displayName === 'Bug Spray')
    expect(b?.category).toBe('Toiletries')
    expect(b?.secondaryCategory).toBe('Gear')
  })

  it('imports every gear item even when its rule will not parse', () => {
    for (const g of gear) expect(g.displayName.length).toBeGreaterThan(0)
    // Unparseable rules flag the rule, never drop the item.
    for (const g of gear.filter((x) => x.needsRuleReview)) {
      expect(g.derived.join(' ')).toMatch(/needs a look/i)
    }
  })

  it('reads the five criticality phrasings into one ordered scale', () => {
    expect(parseCriticality('Critical (Always)')).toBe('critical')
    expect(parseCriticality('Almost always')).toBe('almost_always')
    expect(parseCriticality('Usually')).toBe('usually')
    expect(parseCriticality('Frequently (Trip Days + 2 days buffer)')).toBe('frequent')
    expect(parseCriticality('Safari / wildlife viewing')).toBe('conditional')
  })

  it('splits compound categories', () => {
    expect(splitCategory('Toiletries / Gear')).toEqual({ primary: 'Toiletries', secondary: 'Gear' })
    expect(splitCategory('Electronics')).toEqual({ primary: 'Electronics', secondary: null })
  })

  it('returns no rule rather than inventing one it cannot read', () => {
    expect(parseGearRule('something entirely unparseable here').rule).toBeNull()
  })
})
