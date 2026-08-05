import { describe, expect, it } from 'vitest'
import type { ChecklistEntry } from '@shared/checklist'
import { dayOfPlan, isDepartureImminent } from '@shared/day-of'

/**
 * The departure-morning plan, as arithmetic (doc 09 §12, D4).
 *
 * Tested here rather than through the screen because every interesting case is
 * about which of four buckets a row lands in, and a DOM test would prove the
 * rendering and take the sorting on trust.
 *
 * The invariant underneath all of it: **every row appears exactly once**. The
 * trip screen deliberately shows a final-check row in two sections at once,
 * because there it answers two questions about a bag. Here there is one bag and
 * one morning, and a screen whose whole purpose is to empty out cannot have
 * rows that reappear somewhere else on it.
 */

let counter = 0

function entry(over: Partial<ChecklistEntry> = {}): ChecklistEntry {
  counter += 1
  return {
    id: `e${counter}`,
    tripId: 't1',
    itemId: `i${counter}`,
    name: `Item ${counter}`,
    category: 'Travel Gear',
    requiredQty: 1,
    qtyBreakdown: null,
    qtyOverride: null,
    packedQty: 0,
    packingTiming: 'anytime',
    requiresFinalCheck: false,
    finalCheckedAt: null,
    excludedAt: null,
    source: 'always_packed',
    reason: null,
    isCritical: false,
    tripOnly: false,
    bag: null,
    bagSource: null,
    updatedAt: 0,
    sortOrder: counter,
    ...over,
  }
}

const names = (entries: ChecklistEntry[]) => entries.map((e) => e.name)

describe('which section a row lands in', () => {
  it('puts anything assigned to Wearing it under Wearing it', () => {
    const jacket = entry({ name: 'Jacket', bag: 'wear', bagSource: 'user' })
    const plan = dayOfPlan([jacket])

    expect(names(plan.wear)).toEqual(['Jacket'])
    expect(plan.grab).toEqual([])
    expect(plan.outstanding.total).toBe(0)
  })

  it('counts a RECOMMENDED wear the same as a chosen one', () => {
    /*
     * `bagFor` resolves a recommendation for a row Alex never touched. On the
     * morning "what am I wearing" is worth answering whether or not he ever
     * tapped it, which is the opposite of the packing list's rule — there a
     * suggestion beside half of forty rows says nothing.
     */
    const shoes = entry({ name: 'Boots', bag: 'wear', bagSource: 'recommended' })
    expect(names(dayOfPlan([shoes]).wear)).toEqual(['Boots'])
  })

  it('puts a Pack-day-of row that is still out under Grab', () => {
    const brush = entry({ name: 'Toothbrush', packingTiming: 'day_of' })
    const plan = dayOfPlan([brush])

    expect(names(plan.grab)).toEqual(['Toothbrush'])
    expect(plan.outstanding.total).toBe(0)
  })

  it('puts an unpacked final-check row under Grab, not under Check', () => {
    // Getting it into the bag and confirming it is in the bag are the same act
    // when it is not in the bag.
    const passport = entry({ name: 'Passport', requiresFinalCheck: true, isCritical: true })
    const plan = dayOfPlan([passport])

    expect(names(plan.grab)).toEqual(['Passport'])
    expect(plan.confirm).toEqual([])
  })

  it('puts a PACKED final-check row under Check', () => {
    const passport = entry({
      name: 'Passport',
      requiresFinalCheck: true,
      requiredQty: 1,
      packedQty: 1,
    })
    const plan = dayOfPlan([passport])

    expect(names(plan.confirm)).toEqual(['Passport'])
    expect(plan.grab).toEqual([])
  })

  it('drops a final-check row once it has been confirmed', () => {
    const passport = entry({
      name: 'Passport',
      requiresFinalCheck: true,
      requiredQty: 1,
      packedQty: 1,
      finalCheckedAt: 1,
    })
    const plan = dayOfPlan([passport])

    expect(plan.confirm).toEqual([])
    expect(plan.remaining).toBe(0)
  })

  it('leaves an ordinary unpacked row out of the three sections', () => {
    // §12 is explicit that this is not the packing list again.
    const socks = entry({ name: 'Socks' })
    const plan = dayOfPlan([socks])

    expect(plan.wear).toEqual([])
    expect(plan.grab).toEqual([])
    expect(plan.confirm).toEqual([])
    expect(plan.outstanding.total).toBe(1)
  })

  it('says nothing at all about a row that is packed and needs no check', () => {
    const socks = entry({ name: 'Socks', requiredQty: 2, packedQty: 2 })
    const plan = dayOfPlan([socks])

    expect(plan.remaining).toBe(0)
    expect(plan.outstanding.total).toBe(0)
  })

  it('ignores Not bringing entirely', () => {
    /*
     * Counting a deliberate decision as "still to pack" would leave the one
     * number Alex reads under pressure permanently wrong by however many things
     * he chose to leave behind.
     */
    const left = entry({ name: 'Tripod', packingTiming: 'day_of', excludedAt: 1 })
    const plan = dayOfPlan([left])

    expect(plan.grab).toEqual([])
    expect(plan.remaining).toBe(0)
  })
})

describe('every row appears exactly once', () => {
  it('does not repeat a Wearing-it row that also needs a final check', () => {
    const watch = entry({
      name: 'Watch',
      bag: 'wear',
      bagSource: 'user',
      requiresFinalCheck: true,
    })
    const plan = dayOfPlan([watch])

    expect(names(plan.wear)).toEqual(['Watch'])
    expect(plan.grab).toEqual([])
    expect(plan.confirm).toEqual([])
  })

  it('does not repeat a Pack-day-of row that also needs a final check', () => {
    const meds = entry({
      name: 'Medication',
      packingTiming: 'day_of',
      requiresFinalCheck: true,
      isCritical: true,
    })
    const plan = dayOfPlan([meds])

    expect(names(plan.grab)).toEqual(['Medication'])
    expect(plan.confirm).toEqual([])
  })

  it('never lists the same id twice across the whole plan', () => {
    const rows = [
      entry({ name: 'Jacket', bag: 'wear', bagSource: 'user', requiresFinalCheck: true }),
      entry({ name: 'Toothbrush', packingTiming: 'day_of' }),
      entry({ name: 'Passport', requiresFinalCheck: true, requiredQty: 1, packedQty: 1 }),
      entry({ name: 'Socks' }),
    ]
    const plan = dayOfPlan(rows)
    const listed = [...plan.wear, ...plan.grab, ...plan.confirm].map((e) => e.id)

    expect(new Set(listed).size).toBe(listed.length)
  })
})

describe('what is left over', () => {
  it('counts the rest and names only the essentials among them', () => {
    const plan = dayOfPlan([
      entry({ name: 'Socks' }),
      entry({ name: 'Shirt' }),
      entry({ name: 'Inhaler', isCritical: true }),
    ])

    expect(plan.outstanding.total).toBe(3)
    expect(names(plan.outstanding.essentials)).toEqual(['Inhaler'])
  })

  it('counts the leftovers towards what is still left before leaving', () => {
    // "Nothing left before you leave" while nine things are unpacked is the
    // confident-and-wrong answer doc 09 §25 forbids.
    const plan = dayOfPlan([entry({ name: 'Socks' }), entry({ name: 'Shirt' })])
    expect(plan.remaining).toBe(2)
  })
})

describe('the order within a section', () => {
  it('puts essentials first, then alphabetical', () => {
    const plan = dayOfPlan([
      entry({ name: 'Zinc', packingTiming: 'day_of' }),
      entry({ name: 'Charger', packingTiming: 'day_of' }),
      entry({ name: 'Wallet', packingTiming: 'day_of', isCritical: true }),
    ])

    expect(names(plan.grab)).toEqual(['Wallet', 'Charger', 'Zinc'])
  })

  it('is stable — the same list twice gives the same order', () => {
    const rows = [
      entry({ name: 'Belt', packingTiming: 'day_of' }),
      entry({ name: 'Apple', packingTiming: 'day_of' }),
    ]
    expect(names(dayOfPlan(rows).grab)).toEqual(names(dayOfPlan([...rows].reverse()).grab))
  })
})

describe('what is still to be worn counts as left to do', () => {
  it('counts an unworn Wearing-it row', () => {
    // Nothing else notices these: `isPacked` on a jacket assigned to Wearing it
    // means "yes, I have it on", so a screen that only looked at packing would
    // say "Ready to go" with the coat on its hook.
    const plan = dayOfPlan([entry({ name: 'Coat', bag: 'wear', bagSource: 'user' })])
    expect(plan.remaining).toBe(1)
  })

  it('does not count one that is already on', () => {
    const plan = dayOfPlan([
      entry({ name: 'Coat', bag: 'wear', bagSource: 'user', requiredQty: 1, packedQty: 1 }),
    ])
    expect(plan.remaining).toBe(0)
  })
})

describe('when the departure screen is the right screen', () => {
  it('covers the day itself and the day before', () => {
    // Two whole days, because a trip that leaves at six in the morning is
    // packed the night before, and a screen that only appears on the day
    // appears after the moment it was for.
    expect(isDepartureImminent(0)).toBe(true)
    expect(isDepartureImminent(1)).toBe(true)
  })

  it('does not cover two days out', () => {
    expect(isDepartureImminent(2)).toBe(false)
  })

  it('stops once the trip has started', () => {
    // From then on the question is Today's outfit, not the door.
    expect(isDepartureImminent(-1)).toBe(false)
  })
})
