/**
 * How many of something a rule may ask for.
 *
 * In `shared/` because the screen and the Worker must agree, and they did not.
 * `MAX_PER_DAY` was 10 in `src/routes/Settings.tsx` and 10 again in
 * `worker/routes/settings.ts`, while `PATCH /rules/:id` — writing the **same**
 * `packing_rule.quantity_value` column — already accepted 0–99. Three numbers,
 * one column.
 *
 * Two constants that happen to agree are one careless edit from a stepper whose
 * top value the API rejects, so this is the only place either is decided. A test
 * asserting they match would have caught the drift; not being able to drift is
 * better.
 */

/**
 * The floor for a quantity a rule asks for, per its basis.
 *
 * **1, not 0.** For a per-day rule, zero means "never pack this" — which is
 * exactly what disabling the rule already does, and a second way to say the same
 * thing is how two controls start disagreeing about what Alex meant. Zero is
 * only meaningful if a basis is ever added where it says something disabling
 * cannot.
 */
export const MIN_QUANTITY = 1

/**
 * The ceiling.
 *
 * 99 rather than 10. Ten was low enough to be reached in real use — a fortnight
 * of contact lenses is 28 — and the old editor took eight taps of a `+` to get
 * there, which is the part that actually made it unusable.
 */
export const MAX_QUANTITY = 99

/** The one sentence both sides show when a quantity is out of range. */
export const QUANTITY_RANGE_MESSAGE = `Pick a whole number between ${MIN_QUANTITY} and ${MAX_QUANTITY}.`

/**
 * Reads a typed or pasted quantity, returning `null` for anything unusable.
 *
 * Shared so the field and the API agree about what "77" means when it arrives as
 * `" 77 "`, `"77kg"` or `"7.7"`. Deliberately strict rather than coercing:
 * `Number('')` is 0 and `Number('7.7')` is 7.7, and both would otherwise be
 * stored as a quantity Alex never asked for.
 */
export function readQuantity(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= MIN_QUANTITY && value <= MAX_QUANTITY ? value : null
  }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  // `/^\d+$/` and not `parseInt`: parseInt("77kg") is 77, which silently accepts
  // a paste that was never a number.
  if (!/^\d+$/.test(trimmed)) return null

  const parsed = Number(trimmed)
  return parsed >= MIN_QUANTITY && parsed <= MAX_QUANTITY ? parsed : null
}
