/**
 * The rule corrections Alex asked for, in one place both writers can read.
 *
 * ## Why this file exists
 *
 * Migration 0017 retired the Gas-X and plane-seat-cushion rules and made both
 * sunglasses one-per-trip. It corrects **the database that already exists** —
 * and it can only ever do that, because migrations run before any import. A
 * fresh install applies 0017 to an empty catalog, finds nothing to supersede,
 * and then the workbook arrives carrying the original rules (doc 09 §5a, G5b).
 *
 * So the corrections cannot live only in a migration. They are stated here,
 * `worker/routes/import.ts` applies them to anything it imports, and
 * `tests/integration/rule-corrections.test.ts` asserts that this list and
 * migration 0017 say the same thing — the same guard `missing-items.test.ts`
 * puts between `shared/missing-items.ts` and migration 0009.
 *
 * ## Matched on the visible name, and why that is acceptable here
 *
 * These items come from the workbook, so their ids are generated at import time
 * and there is no stable id to match on — the seat cushion is the exception and
 * is handled by migration 0009's fixed id, not here. The match is **exact on
 * the trimmed, lower-cased name**, never a `LIKE`, and it applies per matching
 * item rather than choosing one: a catalog holding two rows called
 * `Regular Sunglasses` gets the correction on both, which is the surfacing
 * direction `CLAUDE.md` asks for.
 */

export type RuleCorrection =
  | {
      /** The rule is not created at all. Alex does not want this packed. */
      action: 'retire'
      itemName: string
      why: string
    }
  | {
      /** The rule is created, but as this instead of what the workbook said. */
      action: 'replace'
      itemName: string
      ruleType: 'fixed_per_trip'
      quantityValue: number
      originalText: string
      why: string
    }

export const RULE_CORRECTIONS: readonly RuleCorrection[] = [
  {
    action: 'retire',
    itemName: 'Gas-X',
    why: 'The workbook rule is trip days plus a two-day buffer, which is fourteen on a twelve-day trip.',
  },
  {
    action: 'replace',
    itemName: 'Prescription Sunglasses',
    ruleType: 'fixed_per_trip',
    quantityValue: 1,
    originalText: 'One per trip.',
    why: 'The workbook conditions both sunglasses on the same outdoor activity, so they could only ever appear together.',
  },
  {
    action: 'replace',
    itemName: 'Regular Sunglasses',
    ruleType: 'fixed_per_trip',
    quantityValue: 1,
    originalText: 'One per trip.',
    why: 'The other half of the same correction, stated separately because they are two objects.',
  },
]

const BY_NAME = new Map(RULE_CORRECTIONS.map((c) => [c.itemName.trim().toLowerCase(), c]))

/** The correction for an item being imported, or null for the great majority. */
export function correctionFor(displayName: string): RuleCorrection | null {
  return BY_NAME.get(displayName.trim().toLowerCase()) ?? null
}
