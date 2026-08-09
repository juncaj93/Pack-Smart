import { describe, expect, it } from 'vitest'
import type { Item } from '@shared/items'
import { UNRECORDED_TRAITS, validateItemInput } from '@shared/items'
import {
  DRESSINESS_CONTEXTS,
  acceptableContexts,
  bandToContexts,
  canonicalise,
  contextForLevel,
  describeContexts,
  fitsContexts,
  highestContext,
  levelOf,
  parseContexts,
  serialiseContexts,
  type DressinessContext,
} from '@shared/dressiness'
import {
  EVERYDAY_TEMPLATE,
  OUTFIT_TEMPLATES,
  TRAVEL_TEMPLATE,
  laundryReducible,
  passesFilters,
} from '@shared/outfits'

/**
 * Dressiness as a SET of contexts (H1c).
 *
 * The product rule, in one line: **a garment is eligible when its contexts
 * intersect the occasion's.** Not "is its highest level in range", not "its
 * lowest" — those are the two collapses that lose what a multi-select is for,
 * and both are asserted against directly below.
 *
 * The other load-bearing property is that this GENERALISES the integer
 * comparison it replaced. On single-context garments — which is every garment
 * migration 0022 produces — the two agree exactly, across all five levels and
 * all thirteen templates.
 */

const casualDay = EVERYDAY_TEMPLATE
const wedding = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'wedding')!
const niceDinner = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'nice_dinner')!
const gym = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'gym')!

function garment(partial: Partial<Item> = {}): Item {
  return {
    id: 'g1', kind: 'clothing', displayName: 'Garment', category: 'Tops & Outerwear',
    subcategory: 'T-Shirt', color: null, pattern: null, brand: null, notes: null,
    usageFrequency: 'sometimes', warmth: null, dressiness: null,
    dressinessContexts: [], weatherTags: [], typicalUses: [], reuseCapacity: null,
    ownedQuantity: null, comfort: null, versatility: null,
    ...UNRECORDED_TRAITS,
    isCritical: false, requiresFinalCheck: false, defaultPackingTiming: 'anytime',
    alwaysInclude: false, neverInclude: false, archivedAt: null, source: 'manual',
    fieldProvenance: {}, createdAt: 0, updatedAt: 0,
    ...partial,
  }
}

const eligible = (contexts: DressinessContext[], template = casualDay, cap: number | null = null) =>
  passesFilters(garment({ dressinessContexts: contexts, subcategory: 'T-Shirt' }), {
    role: 'top', template, warmthBand: null, needsRainLayer: false, maxDressiness: cap,
  }).ok

/* ------------------------------------------------------------------ */
/* the vocabulary and the stored shape                                 */
/* ------------------------------------------------------------------ */

describe('the five contexts', () => {
  it('keeps the index aligned with the legacy integer, permanently', () => {
    // The whole legacy mapping rests on this, including migration 0022's CASE.
    expect(DRESSINESS_CONTEXTS).toEqual([
      'loungewear', 'casual', 'smart_casual', 'dressy', 'formal',
    ])
    expect(levelOf('loungewear')).toBe(0)
    expect(levelOf('smart_casual')).toBe(2)
    expect(levelOf('formal')).toBe(4)
    for (const [index, context] of DRESSINESS_CONTEXTS.entries()) {
      expect(contextForLevel(index)).toBe(context)
      expect(levelOf(context)).toBe(index)
    }
  })

  it('reads a level outside the scale as nothing', () => {
    expect(contextForLevel(null)).toBeNull()
    expect(contextForLevel(5)).toBeNull()
    expect(contextForLevel(-1)).toBeNull()
    expect(contextForLevel(1.5)).toBeNull()
  })
})

describe('the stored set', () => {
  it('is canonical however it was built', () => {
    // Order and duplicates must not survive, or an identical save reads as a
    // change and H1a fills the review queue with differences nobody made.
    expect(canonicalise(['dressy', 'casual'])).toEqual(['casual', 'dressy'])
    expect(canonicalise(['formal', 'formal', 'casual'])).toEqual(['casual', 'formal'])
    expect(serialiseContexts(['dressy', 'casual'])).toBe(serialiseContexts(['casual', 'dressy']))
  })

  it('round-trips, and stores nothing for the empty set', () => {
    expect(serialiseContexts([])).toBeNull()
    expect(parseContexts(serialiseContexts(['smart_casual', 'dressy']))).toEqual([
      'smart_casual', 'dressy',
    ])
  })

  it('reads rubbish as not recorded rather than throwing', () => {
    expect(parseContexts(null)).toEqual([])
    expect(parseContexts('not json')).toEqual([])
    expect(parseContexts('{"a":1}')).toEqual([])
    expect(parseContexts('["casual","black tie","dressy"]')).toEqual(['casual', 'dressy'])
  })

  it('describes a set in words, for a screen and never for a decision', () => {
    expect(describeContexts([])).toBe('Not set')
    expect(describeContexts(['casual'])).toBe('Casual')
    expect(describeContexts(['dressy', 'smart_casual'])).toBe('Smart casual and Dressy')
    expect(describeContexts(['casual', 'smart_casual', 'dressy'])).toBe(
      'Casual, Smart casual and Dressy',
    )
  })
})

/* ------------------------------------------------------------------ */
/* eligibility — the heart of it                                       */
/* ------------------------------------------------------------------ */

describe('eligibility is set intersection', () => {
  it('accepts a single matching context', () => {
    expect(fitsContexts(['casual'], ['casual'])).toBe(true)
    expect(eligible(['casual'])).toBe(true)
  })

  it('accepts a garment that lists the need among several contexts', () => {
    // The sentence a single integer could not say.
    expect(fitsContexts(['smart_casual', 'dressy'], ['smart_casual'])).toBe(true)
    expect(fitsContexts(['smart_casual', 'dressy'], ['dressy'])).toBe(true)
  })

  it('rejects a Formal-only garment for a Casual need', () => {
    /*
     * The defect an integer scale made easy: "higher is dressier" plus an
     * open-ended band let a tuxedo satisfy a hiking outfit. Membership has no
     * direction, so it cannot happen here.
     */
    expect(fitsContexts(['formal'], ['loungewear', 'casual'])).toBe(false)
    expect(eligible(['formal'], gym)).toBe(false)
  })

  it('rejects a Casual-only garment for a Formal need', () => {
    expect(fitsContexts(['casual'], ['dressy', 'formal'])).toBe(false)
    expect(eligible(['casual'], wedding)).toBe(false)
  })

  it('does not let Casual + Smart casual satisfy Dressy', () => {
    expect(fitsContexts(['casual', 'smart_casual'], ['dressy'])).toBe(false)
  })

  it('accepts any garment carrying at least one of several acceptable contexts', () => {
    const acceptable: DressinessContext[] = ['smart_casual', 'dressy']
    expect(fitsContexts(['smart_casual'], acceptable)).toBe(true)
    expect(fitsContexts(['dressy'], acceptable)).toBe(true)
    expect(fitsContexts(['dressy', 'formal'], acceptable)).toBe(true)
    expect(fitsContexts(['loungewear', 'casual'], acceptable)).toBe(false)
  })

  it('treats an unrecorded set as not recorded, so it is never ruled out', () => {
    // Excluding it would punish missing data rather than unsuitability.
    expect(fitsContexts([], ['formal'])).toBe(true)
    expect(eligible([], wedding)).toBe(true)
  })

  /*
   * THE TWO COLLAPSES THIS SLICE EXISTS TO PREVENT.
   *
   * Alex's brief asks for a test that fails if `Smart casual + Dressy` were
   * reduced to one stored context, and one that fails if eligibility used only
   * the highest or the lowest selected level. These are those two.
   */
  it('fails if Smart casual + Dressy were reduced to ONE context', () => {
    const both: DressinessContext[] = ['smart_casual', 'dressy']

    // Keeping only the lowest loses the Dressy answer…
    expect(fitsContexts(both, ['dressy'])).toBe(true)
    // …and keeping only the highest loses the Smart casual one.
    expect(fitsContexts(both, ['smart_casual'])).toBe(true)

    // Through the planner, on the two templates that ask for each.
    expect(eligible(both, niceDinner)).toBe(true)
    expect(eligible(both, casualDay)).toBe(true)

    // And the set really is two after a round trip through storage.
    expect(parseContexts(serialiseContexts(both))).toHaveLength(2)
  })

  it('fails if eligibility read only the highest or only the lowest level', () => {
    /*
     * `Loungewear + Formal` is deliberately absurd as a garment and perfect as
     * a probe: highest-only would accept a wedding and reject pyjama duty,
     * lowest-only the reverse. A true intersection accepts BOTH and still
     * rejects everything between.
     */
    const both: DressinessContext[] = ['loungewear', 'formal']
    expect(fitsContexts(both, ['loungewear'])).toBe(true)
    expect(fitsContexts(both, ['formal'])).toBe(true)
    expect(fitsContexts(both, ['casual'])).toBe(false)
    expect(fitsContexts(both, ['smart_casual'])).toBe(false)
    expect(fitsContexts(both, ['dressy'])).toBe(false)
  })

  it('handles every set size the brief names', () => {
    expect(eligible([], casualDay)).toBe(true)
    expect(eligible(['casual'], casualDay)).toBe(true)
    expect(eligible(['loungewear'], casualDay)).toBe(true)
    expect(eligible(['loungewear', 'casual'], casualDay)).toBe(true)
    expect(eligible(['casual', 'smart_casual'], casualDay)).toBe(true)
    expect(eligible(['smart_casual', 'dressy'], niceDinner)).toBe(true)
    expect(eligible(['dressy', 'formal'], wedding)).toBe(true)
    expect(eligible(['casual', 'smart_casual', 'dressy'], niceDinner)).toBe(true)
    /*
     * Three contexts INCLUDING Dressy, at a wedding: eligible, because the
     * wedding accepts Dressy and the garment claims it. A first draft of this
     * line expected false, reading "mostly casual" as disqualifying — which is
     * the ladder thinking H1c removes. The rejection below is the honest one:
     * three contexts, none of them the wedding's.
     */
    expect(eligible(['casual', 'smart_casual', 'dressy'], wedding)).toBe(true)
    expect(eligible(['loungewear', 'casual', 'smart_casual'], wedding)).toBe(false)
  })

  it('loses one context without losing the other', () => {
    const both: DressinessContext[] = ['smart_casual', 'dressy']
    const justDressy = both.filter((c) => c !== 'smart_casual')
    expect(justDressy).toEqual(['dressy'])
    expect(fitsContexts(justDressy, ['dressy'])).toBe(true)
    expect(fitsContexts(justDressy, ['smart_casual'])).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* the template floor and the trip cap                                 */
/* ------------------------------------------------------------------ */

describe('what a template asks for', () => {
  it('expands a band into the set it always meant', () => {
    expect(bandToContexts([0, 2])).toEqual(['loungewear', 'casual', 'smart_casual'])
    expect(bandToContexts([3, 4])).toEqual(['dressy', 'formal'])
    expect(bandToContexts([2, 2])).toEqual(['smart_casual'])
  })

  it('is capped from above by the trip, without conflict', () => {
    const result = acceptableContexts([0, 2], 1)
    expect(result.contexts).toEqual(['loungewear', 'casual'])
    expect(result.capConflict).toBe(false)
  })

  it('keeps the template FLOOR when the cap would empty it, and says so', () => {
    /*
     * Doc 09 §9's rule: saying "nothing formal" about a trip that includes a
     * wedding must not put Alex in loungewear at the wedding. The cap loses,
     * the requirement stands, and `capConflict` is how anything downstream can
     * tell it happened rather than the cap silently applying.
     */
    const result = acceptableContexts([3, 4], 1)
    expect(result.contexts).toEqual(['dressy'])
    expect(result.capConflict).toBe(true)
  })

  it('never returns an empty acceptable set', () => {
    for (const template of [...OUTFIT_TEMPLATES, TRAVEL_TEMPLATE, EVERYDAY_TEMPLATE]) {
      for (const cap of [null, 0, 1, 2, 3, 4]) {
        expect(acceptableContexts(template.dressiness, cap).contexts.length).toBeGreaterThan(0)
      }
    }
  })

  it('applies the cap through the planner, template floor intact', () => {
    // Cap of Casual on a wedding: the wedding still wants Dressy.
    expect(eligible(['casual'], wedding, 1)).toBe(false)
    expect(eligible(['dressy'], wedding, 1)).toBe(true)
    // Cap of Casual on a casual day: Smart casual drops out.
    expect(eligible(['smart_casual'], casualDay, 1)).toBe(false)
    expect(eligible(['casual'], casualDay, 1)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* the equivalence that makes this safe                                */
/* ------------------------------------------------------------------ */

describe('a single-context wardrobe behaves exactly as it did before H1c', () => {
  it('agrees with the old integer arithmetic on every level, template and cap', () => {
    const templates = [...OUTFIT_TEMPLATES, TRAVEL_TEMPLATE, EVERYDAY_TEMPLATE]
    let compared = 0

    for (const template of templates) {
      for (const cap of [null, 0, 1, 2, 3, 4]) {
        const [minDress, templateMax] = template.dressiness
        const maxDress =
          cap === null ? templateMax : Math.max(minDress, Math.min(templateMax, cap))

        for (let level = 0; level <= 4; level += 1) {
          const legacy = level >= minDress && level <= maxDress
          const now = fitsContexts(
            [contextForLevel(level)!],
            acceptableContexts(template.dressiness, cap).contexts,
          )
          expect(now, `${template.name} cap=${cap} level=${level}`).toBe(legacy)
          compared += 1
        }
      }
    }

    // 13 templates x 6 caps x 5 levels. Stated so a shrinking matrix is visible.
    expect(compared).toBe(13 * 6 * 5)
  })
})

/* ------------------------------------------------------------------ */
/* the one legitimate collapse                                         */
/* ------------------------------------------------------------------ */

describe('laundry reads the ceiling, and only laundry', () => {
  const washable = (contexts: DressinessContext[]) =>
    laundryReducible(garment({ subcategory: 'T-Shirt', dressinessContexts: contexts }))

  it('reduces ordinary washable clothing', () => {
    expect(washable(['casual'])).toBe(true)
    expect(washable(['loungewear', 'casual'])).toBe(true)
    expect(washable(['casual', 'smart_casual'])).toBe(true)
  })

  it('refuses a garment that ALSO works Dressy, because that is the dinner shirt', () => {
    /*
     * The reason this reads the highest context and not the lowest. A shirt
     * marked `Smart casual + Dressy` has a minimum of Smart casual, so a
     * minimum-based rule would start cutting the one shirt Alex needs for the
     * restaurant.
     */
    expect(highestContext(['smart_casual', 'dressy'])).toBe('dressy')
    expect(washable(['smart_casual', 'dressy'])).toBe(false)
    expect(washable(['casual', 'formal'])).toBe(false)
  })

  it('does not reduce what it cannot judge', () => {
    expect(highestContext([])).toBeNull()
    expect(washable([])).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

describe('validating a set', () => {
  const base = { displayName: 'Tee', category: 'Tops & Outerwear' }

  it('accepts any combination, including none', () => {
    expect(validateItemInput({ ...base, dressinessContexts: [] }).ok).toBe(true)
    expect(validateItemInput({ ...base, dressinessContexts: ['casual'] }).ok).toBe(true)
    expect(
      validateItemInput({ ...base, dressinessContexts: [...DRESSINESS_CONTEXTS] }).ok,
    ).toBe(true)
  })

  it('refuses a name it does not know', () => {
    expect(
      validateItemInput({ ...base, dressinessContexts: ['black tie'] as never }).ok,
    ).toBe(false)
  })
})
