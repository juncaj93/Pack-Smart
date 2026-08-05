import type { Condition, RuleType } from './rules'

/**
 * The wardrobe rows that exist in Alex's life but never made it into the workbook.
 *
 * `CLAUDE.md`: the spreadsheet in `/seed-data` is *initial seed data only*, and
 * after launch the website is the source of truth. So the workbook is never
 * rewritten — a binary is a bad place to record a decision, and editing it would
 * make the import path and the live database disagree about what "the seed" is.
 * Post-launch canonical additions live here instead, and this file is the single
 * list read by the migration, the tests, and anything that needs to ask whether
 * an item is one of them.
 *
 * Why this matters more than it looks: `checklist.ts` treats candidacy as "has at
 * least one enabled rule", and the "still not packed" line filters *entries that
 * already exist*. An item that is not in the database is therefore absent from
 * every packing list, forever, with no warning — the app looks complete and
 * confident while leaving a bite guard at home. That is the one way Pack Smart
 * can fail badly while appearing to work
 * (`technical-docs/10_AUDIT_AND_ROADMAP.md` §3).
 *
 * **Five, not six.** The brief this list came from named six, including a
 * `Black Vuori Jacket`. That garment is already in the wardrobe, and adding it
 * again would manufacture exactly the duplicate `CLAUDE.md` requires be *detected*
 * rather than silently imported. Checked against the seeded database before this
 * file was written, not against the brief.
 *
 * Ids are fixed rather than generated. The migration and this file have to name
 * the same rows, and a fixed id is also what makes "did this migration create it?"
 * answerable in SQL without a marker column.
 */

/**
 * What counts as a long flight, once and for everything.
 *
 * There was no canonical threshold, so the seat cushion's rule would have been a
 * magic number and the next rule needing the idea would have invented its own.
 *
 * **More than 6 hours**, read from `flight_hours` — a number Alex types into the
 * trip sheet — and never inferred from the destination. Six is the point at which
 * a single leg is generally overnight or transatlantic. Inferring it from where he
 * is going would be a guess dressed as a fact, which doc 03 forbids: a trip to
 * Tokyo might be a direct flight or three short hops, and the app does not know.
 *
 * A trip with no recorded `flight_hours` evaluates to **unknown**, not false, so
 * the item is left off and the entry is marked incomplete rather than silently
 * decided.
 */
export const LONG_FLIGHT_HOURS = 6

export interface MissingItemRule {
  ruleType: RuleType
  quantityValue: number
  condition: Condition | null
  /** Kept verbatim so the rule can be audited against where it came from. */
  originalText: string
}

export interface MissingItem {
  id: string
  kind: 'clothing' | 'gear'
  displayName: string
  category: string
  color: string | null
  brand: string | null
  isCritical: boolean
  requiresFinalCheck: boolean
  rule: MissingItemRule | null
}

export const MISSING_ITEMS: readonly MissingItem[] = [
  {
    id: 'a1f0b3c2-0001-4e00-9a00-packsmartv2001',
    kind: 'gear',
    displayName: 'Bite Guard',
    category: 'Medication',
    color: null,
    brand: null,
    /*
     * Essential and final-check, like Synthroid and the Medicine Wheel. A dental
     * appliance left at home cannot be replaced on the road, and it is needed on
     * the first night — which is also why it is a final-check item rather than one
     * packed days ahead.
     */
    isCritical: true,
    requiresFinalCheck: true,
    rule: {
      /*
       * `conditional_include`, not `fixed_per_trip`: the engine applies conditions
       * only to the conditional types, so a fixed rule with a condition attached
       * would fire on every trip and the condition would be decoration.
       */
      ruleType: 'conditional_include',
      quantityValue: 1,
      condition: { fact: 'nights', gte: 1 },
      originalText: 'Critical. One per trip, whenever the trip has a night in it.',
    },
  },
  {
    id: 'a1f0b3c2-0002-4e00-9a00-packsmartv2002',
    kind: 'gear',
    displayName: 'Hairspray',
    category: 'Toiletries',
    color: null,
    brand: null,
    isCritical: false,
    requiresFinalCheck: false,
    rule: {
      ruleType: 'fixed_per_trip',
      quantityValue: 1,
      condition: null,
      originalText: 'One per trip.',
    },
  },
  {
    id: 'a1f0b3c2-0003-4e00-9a00-packsmartv2003',
    kind: 'gear',
    displayName: 'Plane Seat Cushion',
    category: 'Travel Gear',
    color: null,
    brand: null,
    isCritical: false,
    requiresFinalCheck: false,
    /*
     * **Retired by migration 0017 (G5), and deliberately still written here.**
     *
     * Alex asked for the seat cushion to stop being packed. This file and
     * migration 0009 are a record of what was INSERTED, `missing-items.test.ts`
     * asserts the two agree, and migrations are forward-only — so retiring a
     * rule is not the same act as pretending it was never seeded, and neither
     * file is edited for it.
     *
     * 0017 writes a superseding `user` row with `enabled = 0`, which is exactly
     * what `disableRule` writes from Settings. The rule below is still there,
     * still readable, and *Use the default* restores it.
     *
     * `readiness.ts` no longer cites this item in the long-flight question,
     * because it no longer adds it. The two things that question really does
     * add are the neck pillow and the compression socks, both from the
     * workbook at over five hours.
     */
    rule: {
      ruleType: 'conditional_include',
      quantityValue: 1,
      condition: { fact: 'flight_hours', gt: LONG_FLIGHT_HOURS },
      originalText: `One per trip, on a flight longer than ${LONG_FLIGHT_HOURS} hours.`,
    },
  },
  /*
   * Two watches, two rows.
   *
   * A shared brand is not a reason to merge them: they are different objects and
   * Alex chooses between them. Neither carries a rule — a watch is not packed by
   * the engine, it is chosen by an outfit or caught by One Last Look — and neither
   * carries warmth, dressiness, weather tags or typical uses, because nothing
   * recorded anywhere supports a value for those. Doc 03: never invent a
   * capability. Colour and brand are read off the name and are facts.
   */
  {
    id: 'a1f0b3c2-0004-4e00-9a00-packsmartv2004',
    kind: 'clothing',
    displayName: 'Black Shinola',
    category: 'Accessories & Undergarments',
    color: 'Black',
    brand: 'Shinola',
    isCritical: false,
    requiresFinalCheck: false,
    rule: null,
  },
  {
    id: 'a1f0b3c2-0005-4e00-9a00-packsmartv2005',
    kind: 'clothing',
    displayName: 'White Shinola',
    category: 'Accessories & Undergarments',
    color: 'White',
    brand: 'Shinola',
    isCritical: false,
    requiresFinalCheck: false,
    rule: null,
  },
]

/** The comparison the migration uses, so tests can apply the same rule. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}
