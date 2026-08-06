import { describe, expect, it } from 'vitest'
import {
  PROVENANCED_FIELDS,
  SOURCE_RANK,
  clearField,
  copyProvenance,
  decideWrite,
  mayWrite,
  parseProvenance,
  rankOf,
  revertField,
  serialiseProvenance,
  type FieldProvenance,
} from '@shared/provenance'

/**
 * The precedence arithmetic, on its own (H1a).
 *
 * Kept away from a database on purpose. "May an import overwrite a value Alex
 * confirmed" is a comparison of two numbers, and every case doc 09 §7 asks for
 * — repeated imports, clearing, reverting, copies, accepted learning — is
 * answerable here. `tests/integration/provenance.test.ts` then proves the SQL
 * does what these functions decided, rather than re-deciding it.
 */

const NOW = 1_780_000_000
const LATER = NOW + 86_400

/* ------------------------------------------------------------------ */
/* the order of authority                                              */
/* ------------------------------------------------------------------ */

describe('the order of authority', () => {
  it('puts a confirmation above an import, an inference and a default', () => {
    expect(SOURCE_RANK.user_confirmed).toBeGreaterThan(SOURCE_RANK.imported)
    expect(SOURCE_RANK.user_confirmed).toBeGreaterThan(SOURCE_RANK.inferred)
    expect(SOURCE_RANK.user_confirmed).toBeGreaterThan(SOURCE_RANK.system_default)
    expect(SOURCE_RANK.user_confirmed).toBeGreaterThan(SOURCE_RANK.learned_proposal)
  })

  it('puts an accepted learned value above an import, because Alex said yes to it', () => {
    expect(SOURCE_RANK.learned_proposal).toBeGreaterThan(SOURCE_RANK.imported)
  })

  it('puts a guess below a reading', () => {
    expect(SOURCE_RANK.inferred).toBeLessThan(SOURCE_RANK.imported)
  })

  it('reads a field with nothing recorded as the floor, which is what makes 0020 safe', () => {
    expect(rankOf({}, 'dressiness')).toBe(SOURCE_RANK.system_default)
    // Every writer may still write it — exactly as every row behaved before 0020.
    expect(mayWrite({}, 'dressiness', 'inferred')).toBe(true)
    expect(mayWrite({}, 'dressiness', 'imported')).toBe(true)
    expect(mayWrite({}, 'dressiness', 'user_confirmed')).toBe(true)
  })

  it('lets a source revise itself, and never lets one climb', () => {
    const imported: FieldProvenance = { dressiness: { source: 'imported', at: NOW } }
    expect(mayWrite(imported, 'dressiness', 'imported')).toBe(true)
    expect(mayWrite(imported, 'dressiness', 'inferred')).toBe(false)

    const confirmed: FieldProvenance = { dressiness: { source: 'user_confirmed', at: NOW } }
    expect(mayWrite(confirmed, 'dressiness', 'user_confirmed')).toBe(true)
    expect(mayWrite(confirmed, 'dressiness', 'imported')).toBe(false)
    expect(mayWrite(confirmed, 'dressiness', 'learned_proposal')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* deciding one write                                                  */
/* ------------------------------------------------------------------ */

describe('deciding a write', () => {
  it('records an imported value', () => {
    const out = decideWrite({}, { color: null }, { color: 'Grey' }, 'imported', NOW)
    expect(out.accepted).toEqual({ color: 'Grey' })
    expect(out.provenance.color).toEqual({ source: 'imported', at: NOW })
    expect(out.refused).toEqual([])
  })

  it('records an inferred value as a guess, not as a reading', () => {
    const out = decideWrite({}, { dressiness: null }, { dressiness: 1 }, 'inferred', NOW)
    expect(out.provenance.dressiness).toEqual({ source: 'inferred', at: NOW })
  })

  it('records a user-confirmed value, and what it replaced', () => {
    const before: FieldProvenance = { dressiness: { source: 'inferred', at: NOW } }
    const out = decideWrite(
      before, { dressiness: 1 }, { dressiness: 3 }, 'user_confirmed', LATER,
    )
    expect(out.accepted).toEqual({ dressiness: 3 })
    expect(out.provenance.dressiness).toEqual({
      source: 'user_confirmed', at: LATER, was: 1, wasSource: 'inferred',
    })
  })

  it('touches only the fields the writer carries', () => {
    const out = decideWrite(
      {},
      { color: 'Grey', dressiness: 1, brand: 'Uniqlo' },
      { color: 'Black' },
      'imported',
      NOW,
    )
    expect(Object.keys(out.accepted)).toEqual(['color'])
    expect(Object.keys(out.provenance)).toEqual(['color'])
  })

  it('refuses an import over a confirmed value, and hands it back as a suggestion', () => {
    const confirmed: FieldProvenance = { dressiness: { source: 'user_confirmed', at: NOW } }
    const out = decideWrite(confirmed, { dressiness: 3 }, { dressiness: 1 }, 'imported', LATER)

    expect(out.accepted).toEqual({})
    expect(out.provenance.dressiness).toEqual({ source: 'user_confirmed', at: NOW })
    expect(out.refused).toEqual([
      { field: 'dressiness', existing: 3, incoming: 1, heldBy: 'user_confirmed' },
    ])
  })

  it('says nothing when a refused write would not have changed anything', () => {
    const confirmed: FieldProvenance = { dressiness: { source: 'user_confirmed', at: NOW } }
    const out = decideWrite(confirmed, { dressiness: 3 }, { dressiness: 3 }, 'imported', LATER)

    // A re-import of an unchanged workbook must be silent, not 85 cards saying
    // that nothing happened.
    expect(out.refused).toEqual([])
  })

  it('confirms a value in place, which is what *Keep as is* has to do', () => {
    const guessed: FieldProvenance = { dressiness: { source: 'inferred', at: NOW } }
    const out = decideWrite(
      guessed, { dressiness: 2 }, { dressiness: 2 }, 'user_confirmed', LATER,
    )

    // The number did not move. Its authority did, and that is the whole point:
    // from here an import cannot have it.
    expect(out.accepted).toEqual({ dressiness: 2 })
    expect(out.provenance.dressiness?.source).toBe('user_confirmed')
    expect(mayWrite(out.provenance, 'dressiness', 'imported')).toBe(false)
  })

  it('compares arrays by value, so a re-import is not a change', () => {
    const confirmed: FieldProvenance = { typicalUses: { source: 'user_confirmed', at: NOW } }
    const same = decideWrite(
      confirmed, { typicalUses: ['gym', 'casual'] }, { typicalUses: ['gym', 'casual'] },
      'imported', LATER,
    )
    expect(same.refused).toEqual([])

    const changed = decideWrite(
      confirmed, { typicalUses: ['gym', 'casual'] }, { typicalUses: ['gym'] },
      'imported', LATER,
    )
    expect(changed.refused).toHaveLength(1)
  })

  it('accepts a learned proposal over an import, and refuses an import over it', () => {
    const imported: FieldProvenance = { dressiness: { source: 'imported', at: NOW } }
    const accepted = decideWrite(
      imported, { dressiness: 1 }, { dressiness: 2 }, 'learned_proposal', LATER,
    )
    expect(accepted.accepted).toEqual({ dressiness: 2 })

    const reimport = decideWrite(
      accepted.provenance, { dressiness: 2 }, { dressiness: 1 }, 'imported', LATER + 1,
    )
    expect(reimport.accepted).toEqual({})
    expect(reimport.refused[0]?.heldBy).toBe('learned_proposal')
  })

  it('leaves the row alone for a proposal Alex rejected', () => {
    /*
     * A rejected proposal never reaches here at all — it is not a durable
     * value, so nothing calls `decideWrite` for it. What this asserts is the
     * consequence: the field is exactly where it was, and still writable by the
     * source that owns it.
     */
    const imported: FieldProvenance = { dressiness: { source: 'imported', at: NOW } }
    expect(rankOf(imported, 'dressiness')).toBe(SOURCE_RANK.imported)
    expect(mayWrite(imported, 'dressiness', 'imported')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* clearing, and going back                                            */
/* ------------------------------------------------------------------ */

describe('clearing a value', () => {
  it('makes the absence itself confirmed, so an import cannot refill it', () => {
    const confirmed: FieldProvenance = { dressiness: { source: 'user_confirmed', at: NOW } }
    const after = clearField(confirmed, { dressiness: 3 }, 'dressiness', LATER)

    expect(after.dressiness).toEqual({
      source: 'user_confirmed', at: LATER, was: 3, wasSource: 'user_confirmed',
    })
    expect(mayWrite(after, 'dressiness', 'imported')).toBe(false)
  })

  it('clearing an imported value also blocks the next import', () => {
    const imported: FieldProvenance = { brand: { source: 'imported', at: NOW } }
    const after = clearField(imported, { brand: 'Uniqlo' }, 'brand', LATER)
    expect(mayWrite(after, 'brand', 'imported')).toBe(false)
    expect(after.brand?.was).toBe('Uniqlo')
  })
})

describe('going back to what the spreadsheet said', () => {
  it('restores the value AND the source, so an import may write it again', () => {
    const before: FieldProvenance = { dressiness: { source: 'inferred', at: NOW } }
    const confirmed = decideWrite(
      before, { dressiness: 1 }, { dressiness: 3 }, 'user_confirmed', LATER,
    ).provenance

    const back = revertField(confirmed, 'dressiness')
    expect(back.reverted).toBe(true)
    expect(back.value).toBe(1)
    expect(back.provenance.dressiness?.source).toBe('inferred')

    // A revert that left the rank where it was would be a revert in name only.
    expect(mayWrite(back.provenance, 'dressiness', 'imported')).toBe(true)
  })

  it('reverting a value that replaced an absence leaves nothing recorded', () => {
    const out = decideWrite({}, { brand: null }, { brand: 'Uniqlo' }, 'imported', NOW)
    const confirmed = decideWrite(
      out.provenance, { brand: 'Uniqlo' }, { brand: 'Uniqlo Ltd' }, 'user_confirmed', LATER,
    ).provenance

    const back = revertField(confirmed, 'brand')
    expect(back.value).toBe('Uniqlo')
    expect(back.provenance.brand?.source).toBe('imported')
  })

  it('has nothing to go back to when nothing was superseded', () => {
    const only: FieldProvenance = { dressiness: { source: 'imported', at: NOW } }
    expect(revertField(only, 'dressiness').reverted).toBe(false)
    expect(revertField({}, 'dressiness').reverted).toBe(false)
  })

  it('keeps one level, not a history', () => {
    let p = decideWrite({}, { warmth: null }, { warmth: 0 }, 'imported', NOW).provenance
    p = decideWrite(p, { warmth: 0 }, { warmth: 1 }, 'user_confirmed', NOW + 1).provenance
    p = decideWrite(p, { warmth: 1 }, { warmth: 2 }, 'user_confirmed', NOW + 2).provenance

    expect(p.warmth?.was).toBe(1)
    expect(p.warmth?.wasSource).toBe('user_confirmed')
  })
})

/* ------------------------------------------------------------------ */
/* copies                                                              */
/* ------------------------------------------------------------------ */

describe('a copied item', () => {
  it('inherits every confirmation, because provenance is about the garment', () => {
    const original: FieldProvenance = {
      dressiness: { source: 'user_confirmed', at: NOW, was: 1, wasSource: 'inferred' },
      brand: { source: 'imported', at: NOW },
    }
    const copy = copyProvenance(original)
    expect(copy).toEqual(original)

    // A real copy, so editing one cannot reach the other.
    copy.dressiness = { source: 'imported', at: LATER }
    expect(original.dressiness?.source).toBe('user_confirmed')
  })
})

/* ------------------------------------------------------------------ */
/* reading the column                                                  */
/* ------------------------------------------------------------------ */

describe('reading the stored column', () => {
  it('round-trips, and stores nothing when there is nothing to store', () => {
    expect(serialiseProvenance({})).toBeNull()
    const p: FieldProvenance = { color: { source: 'imported', at: NOW } }
    expect(parseProvenance(serialiseProvenance(p))).toEqual(p)
  })

  it('reads a NULL column, an unparseable one and an array as nothing recorded', () => {
    expect(parseProvenance(null)).toEqual({})
    expect(parseProvenance('not json')).toEqual({})
    expect(parseProvenance('[1,2]')).toEqual({})
  })

  it('drops a field this build does not know, rather than ranking it zero', () => {
    const parsed = parseProvenance(
      JSON.stringify({
        color: { source: 'imported', at: NOW },
        comfort: { source: 'user_confirmed', at: NOW },
        dressiness: { source: 'telepathy', at: NOW },
      }),
    )
    expect(Object.keys(parsed)).toEqual(['color'])
  })

  it('survives an entry with no timestamp', () => {
    const parsed = parseProvenance(JSON.stringify({ color: { source: 'imported' } }))
    expect(parsed.color).toEqual({ source: 'imported', at: 0 })
  })
})

/* ------------------------------------------------------------------ */
/* the membership rule                                                 */
/* ------------------------------------------------------------------ */

describe('which fields carry provenance', () => {
  it('excludes every field only Alex can write', () => {
    /*
     * The rule is "more than one authority can write it". After H1a no importer
     * writes any of these, so provenance on them would record nothing — and
     * this list failing is the signal that a second writer appeared and the
     * decision needs revisiting.
     */
    for (const field of ['favorite', 'usageFrequency', 'weatherTags', 'reuseCapacity',
                         'defaultPackingTiming', 'neverInclude', 'kind', 'archivedAt']) {
      expect(PROVENANCED_FIELDS).not.toContain(field)
    }
  })

  it('covers everything the two importers write', () => {
    for (const field of ['displayName', 'category', 'subcategory', 'color', 'pattern',
                         'brand', 'notes', 'warmth', 'dressiness', 'typicalUses',
                         'ownedQuantity', 'isCritical', 'requiresFinalCheck', 'alwaysInclude']) {
      expect(PROVENANCED_FIELDS).toContain(field)
    }
  })
})
