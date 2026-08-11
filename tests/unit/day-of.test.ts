import { describe, expect, it } from 'vitest'
import type { ChecklistEntry } from '@shared/checklist'
import { dayOfPlan, departurePlan, isDepartureImminent } from '@shared/day-of'

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
    detail: null,
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

/**
 * When an unpacked essential stops being ordinary work and becomes a risk.
 *
 * Doc 09 §0q took the standing "10 essentials still to pack" panel off the trip
 * screen, and doc 09 §0t is the other half of that ruling: the fact was never
 * wrong, it was mistimed. While Alex is packing, an unpacked Bite Guard is the
 * work. On the morning he leaves — coat half on, no longer working through a
 * list — it is something he is about to fly without.
 *
 * So every test here is about the DAY rather than about the item. The same
 * checklist produces silence on one date and three named rows on another, which
 * is the entire feature.
 */
describe('essentials on the day you leave', () => {
  const START = '2026-08-20'
  const trip = (over: Partial<{ startDate: string; status: string }> = {}) => ({
    startDate: START,
    status: 'upcoming',
    ...over,
  })

  /**
   * Two unpacked essentials shaped the way Alex's catalog actually shapes them.
   *
   * `requiresFinalCheck: true` is not decoration — it is the finding this whole
   * suite exists because of. All twelve critical items in his real workbook carry
   * it, so a version of this reading `outstanding.essentials` alone finds nothing
   * and the feature never appears. A fixture without the flag would have agreed
   * with that version and shipped it.
   */
  const shelf = () => [
    entry({ name: 'Bite Guard', isCritical: true, requiresFinalCheck: true }),
    entry({ name: 'Glasses', isCritical: true, requiresFinalCheck: true }),
    entry({ name: 'Socks' }),
  ]

  it('says nothing at all while he is still packing', () => {
    const plan = departurePlan(shelf(), trip(), '2026-08-18')

    expect(plan.essentials).toEqual([])
    // And they are still where they always were, as ordinary departure work.
    expect(names(plan.grab)).toEqual(['Bite Guard', 'Glasses'])
  })

  it('names them on the calendar day the trip begins', () => {
    expect(names(departurePlan(shelf(), trip(), START).essentials)).toEqual([
      'Bite Guard',
      'Glasses',
    ])
  })

  /*
   * The defect this replaced. Reading `outstanding.essentials` alone was inert
   * against real data: every critical item Alex owns requires a final check, so
   * `dayOfPlan` routes all of them into `grab` and the promoted list was
   * permanently empty. This asserts the promotion reaches into BOTH buckets.
   */
  it('finds an essential that is only in the list because it needs a final check', () => {
    const rows = [entry({ name: 'Passport', isCritical: true, requiresFinalCheck: true })]
    const plain = dayOfPlan(rows)

    expect(plain.outstanding.essentials, 'the bucket the first version read').toEqual([])
    expect(names(departurePlan(rows, trip(), START).essentials)).toEqual(['Passport'])
  })

  /* Moved, not copied: a screen whose purpose is to empty out cannot repeat a row. */
  it('takes a promoted essential out of the section it came from', () => {
    const plan = departurePlan(shelf(), trip(), START)

    expect(names(plan.grab)).toEqual([])
    expect(names(plan.essentials)).toEqual(['Bite Guard', 'Glasses'])
  })

  it('does not promote an ordinary unchecked row merely because it is unchecked', () => {
    const plan = departurePlan(shelf(), trip(), START)

    expect(names(plan.essentials)).not.toContain('Socks')
    expect(plan.outstanding.total).toBe(1)
  })

  /*
   * The other half of the promotion filter, and a mutation found it missing.
   *
   * Widening `isCritical` to "everything in `grab`" passed the whole file,
   * because every fixture here happened to have only critical rows in that
   * bucket. A toothbrush marked *pack day of* is ordinary departure work — it
   * belongs under Grab these now, not under a heading that says essential.
   */
  it('does not promote an ordinary row that is merely still out of the bag', () => {
    const rows = [
      entry({ name: 'Toothbrush', packingTiming: 'day_of' }),
      entry({ name: 'Charger', requiresFinalCheck: true }),
      entry({ name: 'Bite Guard', isCritical: true, requiresFinalCheck: true }),
    ]
    const plan = departurePlan(rows, trip(), START)

    expect(names(plan.essentials)).toEqual(['Bite Guard'])
    expect(names(plan.grab)).toEqual(['Charger', 'Toothbrush'])
  })

  it('stops naming one the moment it is packed', () => {
    const rows = [
      entry({ name: 'Bite Guard', isCritical: true, requiresFinalCheck: true, packedQty: 1 }),
      entry({ name: 'Glasses', isCritical: true, requiresFinalCheck: true }),
    ]

    expect(names(departurePlan(rows, trip(), START).essentials)).toEqual(['Glasses'])
  })

  it('says nothing once everything essential is in the bag', () => {
    const rows = [entry({ name: 'Bite Guard', isCritical: true, packedQty: 1 })]

    expect(departurePlan(rows, trip(), START).essentials).toEqual([])
  })

  /*
   * Once he has gone, the question is Today's outfit. "You never packed your
   * passport" about a trip he is already on is a fact about a row rather than
   * about his life — and about a trip he has come back from it is worse.
   */
  it('says nothing once the trip is under way', () => {
    expect(departurePlan(shelf(), trip(), '2026-08-21').essentials).toEqual([])
  })

  it('says nothing on a finished trip, even on its own start date', () => {
    const plan = departurePlan(shelf(), trip({ status: 'completed' }), START)

    expect(plan.essentials).toEqual([])
    expect(names(plan.grab)).toEqual(['Bite Guard', 'Glasses'])
  })

  /*
   * Counted once. The screen saying "3 other things are still on the packing
   * list" and then naming two of them above would be the packing list a second
   * time, which §12 rules out.
   */
  it('never counts a promoted essential among the others', () => {
    const rows = [
      entry({ name: 'Bite Guard', isCritical: true }),
      entry({ name: 'Socks' }),
      entry({ name: 'Charger' }),
    ]
    const plan = departurePlan(rows, trip(), START)

    expect(plan.essentials.length).toBe(1)
    expect(plan.outstanding.total).toBe(2)
  })

  /* A jacket he is wearing is on him, not at risk of being left behind. */
  it('leaves what he is wearing where it is', () => {
    const rows = [entry({ name: 'Field Shell', isCritical: true, bag: 'wear', bagSource: 'user' })]
    const plan = departurePlan(rows, trip(), START)

    expect(names(plan.wear)).toEqual(['Field Shell'])
    expect(plan.essentials).toEqual([])
  })

  /*
   * Not bringing is a decision, not a risk. Counting it here would leave the
   * morning permanently wrong by however much Alex deliberately left behind.
   */
  it('ignores an essential he decided not to bring', () => {
    const rows = [entry({ name: 'Bite Guard', isCritical: true, excludedAt: 99 })]

    expect(departurePlan(rows, trip(), START).essentials).toEqual([])
  })

  /* Promotion moves rows between sections; it must not change how much is left. */
  it('does not change how many things are left before he leaves', () => {
    const rows = shelf()

    expect(departurePlan(rows, trip(), START).remaining).toBe(dayOfPlan(rows).remaining)
  })
})
