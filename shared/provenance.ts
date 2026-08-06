/**
 * Where each value on an item came from, and who may overwrite whom (H1a).
 *
 * `item.source` answers *where did this ROW come from* — `seed_import`,
 * `manual`, `trip_promoted`. It has never been able to answer *where did this
 * VALUE come from*, and that gap is what makes a confirmed rating unsafe: G5b's
 * `Update existing` writes the spreadsheet over the stored row, so a comfort
 * score or a confirmed dressiness shipped without this is silently overwritten
 * by the next import. Doc 09 §7 records the dependency; `CLAUDE.md` forbids the
 * outcome.
 *
 * The model is `packing_rule.source` + `supersedes_rule_id` (migration 0011),
 * moved down one level from the row to the field, because that design is
 * already proven, already reversible, and already understood by anyone who has
 * read G5.
 *
 * Nothing here touches a database. The precedence question is arithmetic on two
 * ranks, and keeping it arithmetic is what lets every documented case below be
 * a unit test rather than an integration one.
 */

/* ------------------------------------------------------------------ */
/* the vocabulary                                                      */
/* ------------------------------------------------------------------ */

export type ValueSource =
  /** No one decided it. The column default, or a value `normalise` filled in. */
  | 'system_default'
  /**
   * Derived by us from something else, and a guess rather than a reading.
   * `inferWarmth` and `inferDressiness` are the two that exist today, and the
   * importer already says so in `NormalizedGarment.derived`.
   */
  | 'inferred'
  /** A column the workbook actually has, read rather than guessed. */
  | 'imported'
  /**
   * A learned proposal Alex ACCEPTED.
   *
   * An unaccepted proposal never appears here, because an unaccepted proposal
   * is not a durable value — it lives in the review queue and the row keeps
   * whatever it had. So this rank is only ever reached through an explicit yes,
   * which is why it outranks an import: it is newer, and Alex saw it.
   */
  | 'learned_proposal'
  /** Alex said this value, in the editor or in the review queue. */
  | 'user_confirmed'

/**
 * The order of authority, and the only place it is written down.
 *
 * Numbers rather than an array index, so a later source can be slotted between
 * two existing ones without renumbering anything that reads them.
 *
 * `learned_proposal` above `imported` is the one placement worth arguing:
 * accepting a proposal is Alex answering a question, and an import that came
 * later must not undo an answer. `user_confirmed` above it because a direct
 * answer beats an accepted suggestion — Alex saying "smart casual" outranks him
 * agreeing that we probably meant smart casual.
 */
export const SOURCE_RANK: Record<ValueSource, number> = {
  system_default: 0,
  inferred: 1,
  imported: 2,
  learned_proposal: 3,
  user_confirmed: 4,
}

const SOURCES = Object.keys(SOURCE_RANK) as ValueSource[]

export function isValueSource(value: unknown): value is ValueSource {
  return typeof value === 'string' && (SOURCES as string[]).includes(value)
}

/**
 * The fields provenance is kept for, and the rule that decides membership.
 *
 * **A field is here when more than one authority can write it.** That is the
 * whole test, and it is deliberately not "every field on the row": provenance
 * on a field only Alex ever writes records nothing, costs a branch on every
 * write, and is exactly the symmetry-for-its-own-sake this slice was told to
 * avoid.
 *
 * So `favorite`, `usageFrequency`, `weatherTags`, `reuseCapacity`,
 * `defaultPackingTiming` and `neverInclude` are absent: no importer writes any
 * of them, and after this slice no importer can. `kind` is absent because it is
 * a function of `category` rather than a value anyone chooses. `archivedAt` is
 * absent because archiving is a lifecycle state, not an opinion about the
 * garment.
 *
 * This list is CODE, not schema — the storage is one JSON column. Adding a
 * field when a second writer appears (H1b's comfort and versatility, H1c's
 * dressiness range, a future learned weather tag) costs a line here and no
 * migration at all, which is the reason the column is shaped the way it is.
 */
export const PROVENANCED_FIELDS = [
  'displayName',
  'category',
  'subcategory',
  'color',
  'pattern',
  'brand',
  'notes',
  'warmth',
  'dressiness',
  'typicalUses',
  'ownedQuantity',
  'isCritical',
  'requiresFinalCheck',
  'alwaysInclude',
] as const

export type ProvenancedField = (typeof PROVENANCED_FIELDS)[number]

const FIELD_SET = new Set<string>(PROVENANCED_FIELDS)

export function isProvenancedField(value: unknown): value is ProvenancedField {
  return typeof value === 'string' && FIELD_SET.has(value)
}

/** Human labels, for a review card that explains itself. */
export const SOURCE_LABELS: Record<ValueSource, string> = {
  system_default: 'a default',
  inferred: 'worked out from your spreadsheet',
  imported: 'from your spreadsheet',
  learned_proposal: 'a suggestion you accepted',
  user_confirmed: 'confirmed by you',
}

/* ------------------------------------------------------------------ */
/* the stored shape                                                    */
/* ------------------------------------------------------------------ */

/**
 * One field's recorded source, plus one level of undo.
 *
 * `was` / `wasSource` exist so *Use the value from my spreadsheet* can be
 * offered after Alex confirms something — the same promise G5 makes with *Use
 * the default*, which is why the depth is one and not a history. A history in a
 * column parsed on every catalog read would grow without bound to answer a
 * question no screen asks.
 */
export interface ProvenanceEntry {
  source: ValueSource
  /** Seconds, matching every other timestamp in this schema. */
  at: number
  /** The value this one replaced, when there was one. */
  was?: unknown
  wasSource?: ValueSource
}

export type FieldProvenance = Partial<Record<ProvenancedField, ProvenanceEntry>>

/**
 * Reads the column, and refuses to throw on anything it finds there.
 *
 * Same posture as `parseJsonArray` beside it in the items repo: a column that
 * cannot be parsed reads as "nothing recorded", which is the floor, which is
 * how every row behaved before migration 0020. Unknown field names and unknown
 * sources are dropped rather than kept — a source this build cannot rank cannot
 * be compared against, and silently ranking it zero would be worse than not
 * having it.
 */
export function parseProvenance(value: string | null): FieldProvenance {
  if (!value) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const out: FieldProvenance = {}
  for (const [field, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isProvenancedField(field)) continue
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue

    const record = entry as Record<string, unknown>
    if (!isValueSource(record.source)) continue

    const clean: ProvenanceEntry = {
      source: record.source,
      at: typeof record.at === 'number' ? record.at : 0,
    }
    if ('was' in record) clean.was = record.was
    if (isValueSource(record.wasSource)) clean.wasSource = record.wasSource
    out[field] = clean
  }
  return out
}

/** `null` when nothing is recorded, so an untouched row keeps a NULL column. */
export function serialiseProvenance(provenance: FieldProvenance): string | null {
  return Object.keys(provenance).length === 0 ? null : JSON.stringify(provenance)
}

/* ------------------------------------------------------------------ */
/* precedence                                                          */
/* ------------------------------------------------------------------ */

/**
 * The rank a field currently sits at.
 *
 * An absent entry is `system_default`, the floor, and that single choice is
 * what makes migration 0020 safe: every row written before it has a NULL
 * column, every field on those rows reads as the floor, and every writer can
 * still write them — which is exactly what those rows did yesterday.
 */
export function rankOf(provenance: FieldProvenance, field: ProvenancedField): number {
  return SOURCE_RANK[provenance[field]?.source ?? 'system_default']
}

/**
 * The whole rule: **a write at rank R may set a field whose current rank is at
 * most R.**
 *
 * Greater-or-equal rather than strictly greater, so a source can correct
 * itself. A second import may revise what the first import wrote; a second
 * confirmation may revise the first. What it may not do is climb: an import
 * (2) cannot touch a confirmation (4), which is the sentence this whole slice
 * exists to make true.
 */
export function mayWrite(
  provenance: FieldProvenance,
  field: ProvenancedField,
  source: ValueSource,
): boolean {
  return SOURCE_RANK[source] >= rankOf(provenance, field)
}

/** A field an incoming write was not allowed to change, for the review queue. */
export interface RefusedWrite {
  field: ProvenancedField
  /** What the row keeps. */
  existing: unknown
  /** What the writer wanted, and did not get. */
  incoming: unknown
  /** Who owns the stored value. */
  heldBy: ValueSource
}

export interface WriteOutcome {
  /** Fields to write, with the values to write. Everything else is untouched. */
  accepted: Partial<Record<ProvenancedField, unknown>>
  /**
   * Fields a stronger source already owns, where the incoming value DIFFERS.
   *
   * A refusal that changes nothing is not worth a review card, so an import
   * that agrees with a confirmed value produces no entry here — which is what
   * keeps a re-import of an unchanged workbook silent rather than a queue of
   * 85 cards saying nothing happened.
   */
  refused: RefusedWrite[]
  /** The provenance to store alongside. */
  provenance: FieldProvenance
}

/**
 * Decides one write, field by field.
 *
 * `current` is what the row holds now; `patch` is only the fields the writer
 * actually carries. That second point is load-bearing and is the other half of
 * what H1a fixes: `updateItemStatement` used to write EVERY column from an
 * `ItemInput` the importer had only partly filled in, so `normalise` turned
 * each omission into a default and `Update existing` quietly reset `favorite`,
 * `usage_frequency`, `weather_tags`, `reuse_capacity` and four more on a
 * garment the workbook said nothing about. A patch cannot do that, because a
 * field the writer does not carry is not in it.
 */
export function decideWrite(
  current: FieldProvenance,
  stored: Partial<Record<ProvenancedField, unknown>>,
  patch: Partial<Record<ProvenancedField, unknown>>,
  source: ValueSource,
  now: number,
): WriteOutcome {
  const accepted: Partial<Record<ProvenancedField, unknown>> = {}
  const refused: RefusedWrite[] = []
  const provenance: FieldProvenance = { ...current }

  for (const field of PROVENANCED_FIELDS) {
    if (!(field in patch)) continue
    const incoming = patch[field]
    const existing = stored[field]

    if (!mayWrite(current, field, source)) {
      if (!sameValue(existing, incoming)) {
        refused.push({
          field,
          existing,
          incoming,
          heldBy: current[field]?.source ?? 'system_default',
        })
      }
      continue
    }

    accepted[field] = incoming

    /*
     * An unchanged value still records its source.
     *
     * This is how the review queue confirms something without editing it —
     * `Keep as is` on a guessed dressiness writes the same number back at rank
     * `user_confirmed`, and from then on the import cannot have it. Skipping
     * the stamp when the value matches would make that button do nothing.
     */
    const previous = current[field]
    const entry: ProvenanceEntry = { source, at: now }
    if (previous && !sameValue(existing, incoming)) {
      entry.was = existing
      entry.wasSource = previous.source
    } else if (previous?.was !== undefined && sameValue(existing, incoming)) {
      // Confirming a value in place keeps whatever it was already able to undo.
      entry.was = previous.was
      entry.wasSource = previous.wasSource
    }
    provenance[field] = entry
  }

  return { accepted, refused, provenance }
}

/**
 * Compares two stored values, including the JSON arrays.
 *
 * `typicalUses` is an array and `===` would call every re-import a change,
 * which would turn the whole workbook into review cards. Order matters here on
 * purpose: the importer produces these from one column in one order, so a
 * difference in order is a difference in what the column said.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index])
  }
  // null and undefined both mean "no value" on this row.
  if (a == null && b == null) return true
  return a === b
}

/* ------------------------------------------------------------------ */
/* clearing, and going back                                            */
/* ------------------------------------------------------------------ */

/**
 * Alex clears a value on purpose.
 *
 * The value becomes null and the provenance becomes `user_confirmed`, because
 * "I do not want a value here" IS an answer. Dropping the entry instead would
 * leave the field at the floor and the next import would helpfully fill it back
 * in — the silent overwrite this module exists to prevent, arriving through the
 * one path that looks like tidying up.
 */
export function clearField(
  current: FieldProvenance,
  stored: Partial<Record<ProvenancedField, unknown>>,
  field: ProvenancedField,
  now: number,
): FieldProvenance {
  const previous = current[field]
  const entry: ProvenanceEntry = { source: 'user_confirmed', at: now }
  if (stored[field] != null) {
    entry.was = stored[field]
    entry.wasSource = previous?.source ?? 'system_default'
  } else if (previous) {
    entry.was = previous.was
    entry.wasSource = previous.wasSource
  }
  return { ...current, [field]: entry }
}

export interface Revert {
  provenance: FieldProvenance
  value: unknown
  /** False when there is nothing recorded to go back to. */
  reverted: boolean
}

/**
 * *Use the value from my spreadsheet* — G5's *Use the default*, for a field.
 *
 * Restores the one superseded value and the source that wrote it, and then the
 * field is genuinely back under that source's authority: an import can write it
 * again, because its rank is an import's rank once more. Anything else would be
 * a revert that does not revert.
 */
export function revertField(
  current: FieldProvenance,
  field: ProvenancedField,
): Revert {
  const entry = current[field]
  if (!entry || entry.wasSource === undefined) {
    return { provenance: current, value: undefined, reverted: false }
  }

  const restored = { ...current }
  if (entry.was === undefined || entry.was === null) {
    // It replaced an absence, so going back means going back to no entry at all.
    delete restored[field]
  } else {
    restored[field] = { source: entry.wasSource, at: entry.at }
  }
  return { provenance: restored, value: entry.was ?? null, reverted: true }
}

/**
 * What a copied item inherits.
 *
 * Everything, verbatim. Provenance is a statement about the GARMENT — that Alex
 * confirmed this dressiness — and duplicating a row does not un-confirm it. The
 * copy's `item.source` becomes `manual` because the ROW is new, and the two
 * facts are separate on purpose: that is the distinction this module was
 * written to draw.
 */
export function copyProvenance(current: FieldProvenance): FieldProvenance {
  return structuredClone(current)
}
