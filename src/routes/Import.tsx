import { useRef, useState } from 'react'
import { Screen } from '@/components/Screen'
import { ApiRequestError, apiFetch } from '@/lib/api'
import type {
  FieldDifference,
  ImportChoice,
  ImportSummary,
  ReconcileDecision,
} from '@shared/import'
import { greySpelling } from '@shared/items'
import { WorkbookError, readWorkbook } from '@shared/xlsx'
import './Import.css'

interface ReviewRow {
  key: string
  sheet: 'clothing' | 'gear'
  name: string
  decision: ReconcileDecision
  matchedItemId: string | null
  matchedName: string | null
  why: string | null
  differences: FieldDifference[]
  candidates: Array<{ id: string; name: string }>
  defaultChoice: ImportChoice
}

interface DryRunResponse {
  summary: ImportSummary
  existingItems: number
  willAppend: boolean
  review: {
    counts: {
      new: number
      exactDuplicates: number
      updateCandidates: number
      likelyDuplicates: number
      conflicts: number
    }
    /** Only the rows that need Alex. An exact duplicate is never one of them. */
    attention: ReviewRow[]
    retiredRulesKept: string[]
  }
}

/**
 * What each answer means, in Alex's words rather than the model's.
 *
 * `Import separately` is deliberately absent for an exact duplicate, and an
 * exact duplicate never reaches this screen at all — Alex's ruling of
 * 2026-08-05. Two identical physical things are added through
 * My Stuff → Add item after the import, where the second one gets a stable
 * identity of its own instead of a marker the import schema would have to carry
 * forever.
 */
const CHOICES: Array<{ value: ImportChoice; label: string; hint: string }> = [
  { value: 'keep_existing', label: 'Keep what I have', hint: 'Nothing changes.' },
  { value: 'update_existing', label: 'Update it', hint: 'Keeps the same item, takes the new details.' },
  { value: 'import_separately', label: 'Add as separate', hint: 'You own both.' },
  { value: 'skip', label: 'Leave it out', hint: 'Not imported at all.' },
]

/**
 * The answers that make sense for one kind of question.
 *
 * A conflict has **no single match**, so neither `Keep what I have` nor
 * `Update it` means anything — there is nothing singular to keep or to update.
 * Offering them was worse than useless: the server has no matched row to act
 * on, so either would have quietly imported the garment separately while the
 * screen said otherwise.
 */
function choicesFor(decision: ReconcileDecision): typeof CHOICES {
  if (decision === 'conflict') {
    return CHOICES.filter(
      (option) => option.value === 'import_separately' || option.value === 'skip',
    )
  }
  return CHOICES
}

/** `You own both` is only true when there is exactly one other. */
function hintFor(choice: ImportChoice, decision: ReconcileDecision, others: number): string {
  if (choice === 'import_separately' && (decision === 'conflict' || others > 1)) {
    return 'Adds this as its own item, beside the ones you have.'
  }
  return CHOICES.find((option) => option.value === choice)?.hint ?? ''
}

const HEADINGS: Partial<Record<ReconcileDecision, string>> = {
  conflict: 'More than one match',
  likely_duplicate: 'Might be one you already have',
  update_candidate: 'The spreadsheet has changed',
}

type Stage = 'idle' | 'reading' | 'preview' | 'committing' | 'done'

/**
 * The one-time spreadsheet import.
 *
 * Reads the file in the browser and shows exactly what will happen before
 * anything is written (product doc 05 §4). Nothing reaches the database until
 * Alex taps Commit.
 */
export default function Import() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<DryRunResponse | null>(null)
  const [parsed, setParsed] = useState<{ filename: string; clothing: string[][]; gear: string[][] } | null>(null)
  const [created, setCreated] = useState(0)
  /** Alex's answers, keyed by row. Empty until he changes something. */
  const [choices, setChoices] = useState<Record<string, ImportChoice>>({})

  async function onFile(file: File) {
    setStage('reading')
    setError(null)
    try {
      const sheets = await readWorkbook(new Uint8Array(await file.arrayBuffer()))

      const clothing = sheets.find((s) => /clothing/i.test(s.name))?.rows
      const gear = sheets.find((s) => /non-?clothing|rules|gear/i.test(s.name))?.rows

      if (!clothing || !gear) {
        setError(
          'That spreadsheet does not have the two expected sheets — "Clothing Inventory" and "Non-Clothing & Rules".',
        )
        setStage('idle')
        return
      }

      const body = { filename: file.name, clothing, gear }
      setParsed(body)
      setChoices({})
      setPreview(await apiFetch<DryRunResponse>('/api/import/dry-run', {
        method: 'POST',
        body: JSON.stringify(body),
      }))
      setStage('preview')
    } catch (caught) {
      setError(
        caught instanceof WorkbookError
          ? caught.message
          : caught instanceof ApiRequestError
            ? caught.message
            : 'Could not read that file. Make sure it is the .xlsx workbook.',
      )
      setStage('idle')
    }
  }

  async function commit() {
    if (!parsed) return
    setStage('committing')
    setError(null)
    try {
      const result = await apiFetch<{ created: number }>('/api/import/commit', {
        method: 'POST',
        body: JSON.stringify({ ...parsed, choices }),
      })
      setCreated(result.created)
      setStage('done')
    } catch {
      setError('The import did not finish. Nothing partial was left behind that you cannot archive.')
      setStage('preview')
    }
  }

  const s = preview?.summary
  const attention = preview?.review?.attention ?? []

  return (
    <Screen title="Import" subtitle="Load your wardrobe from the spreadsheet, once.">
      {stage === 'idle' || stage === 'reading' ? (
        <div className="import-card">
          <p className="import-lead">
            Pick your <strong>Master Packing Database</strong> file. Pack Smart reads it on this
            device and shows you exactly what it found before saving anything.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onFile(file)
            }}
          />
          <button
            type="button"
            className="button-primary"
            onClick={() => fileInput.current?.click()}
            disabled={stage === 'reading'}
          >
            {stage === 'reading' ? 'Reading…' : 'Choose spreadsheet'}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="import-error" role="alert">
          {error}
        </p>
      ) : null}

      {stage === 'preview' && s ? (
        <div className="import-card">
          <h2 className="import-heading">Here is what Pack Smart found</h2>

          <ul className="import-figures">
            <li>
              <strong>{s.clothingUnique}</strong> clothing items
            </li>
            <li>
              <strong>{s.gearItems}</strong> other things you pack
            </li>
            <li>
              <strong>{s.triggerRules}</strong> packing rules
            </li>
            {s.exactDuplicates + s.identityDuplicates > 0 ? (
              <li>
                <strong>{s.exactDuplicates + s.identityDuplicates}</strong> repeated rows skipped
              </li>
            ) : null}
          </ul>

          {preview.willAppend ? (
            <p className="import-warning">
              You already have <strong>{preview.existingItems}</strong> items. These will be added
              alongside them, not replace them. Nothing you already have is changed or deleted.
            </p>
          ) : null}

          {/*
            * The counts first, and only then the things that need a thumb.
            *
            * Doc 02's progressive disclosure applied to the one screen most
            * tempted to become a spreadsheet: on a second import this is 118
            * rows, and 117 of them need nothing. Saying so in three numbers is
            * the whole job; the list below is only what is left.
            */}
          {preview.review ? (
            <section className="import-section">
              <h3 className="import-subheading">Compared with what you already have</h3>
              <ul className="import-figures">
                <li>
                  <strong>{preview.review.counts.new}</strong> new
                </li>
                {preview.review.counts.exactDuplicates > 0 ? (
                  <li>
                    <strong>{preview.review.counts.exactDuplicates}</strong> already in My Stuff,
                    unchanged
                  </li>
                ) : null}
                {attention.length > 0 ? (
                  <li>
                    <strong>{attention.length}</strong>{' '}
                    {attention.length === 1 ? 'needs a look' : 'need a look'}
                  </li>
                ) : null}
              </ul>

              {preview.review.counts.exactDuplicates > 0 && attention.length === 0 ? (
                <p className="import-note">
                  Everything already in My Stuff is exactly as the spreadsheet has it, so nothing
                  will be added twice and nothing will change.
                </p>
              ) : null}

              {preview.review.retiredRulesKept.length > 0 ? (
                <div className="import-retired">
                  <h4 className="import-subheading">Rules that will stay retired</h4>
                  <p className="import-note">
                    You turned {preview.review.retiredRulesKept.length === 1 ? 'this one' : 'these'}{' '}
                    off before. Importing again will not bring{' '}
                    {preview.review.retiredRulesKept.length === 1 ? 'it' : 'them'} back:{' '}
                    {preview.review.retiredRulesKept.join(', ')}.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          {attention.length > 0 ? (
            <section className="import-section">
              <h3 className="import-subheading">
                {attention.length} to decide
              </h3>
              <p className="import-note">
                Everything else is sorted. These are the only ones Pack Smart will not decide for
                you.
              </p>

              {attention.map((row) => {
                const choice = choices[row.key] ?? row.defaultChoice
                const options = choicesFor(row.decision)

                return (
                  <article key={row.key} className="import-decide">
                    <p className="import-decide-kind">{HEADINGS[row.decision]}</p>
                    <h4 className="import-decide-name">{row.name}</h4>
                    {row.why ? <p className="import-review-why">{row.why}</p> : null}

                    {row.differences.length > 0 ? (
                      <dl className="import-compare">
                        {row.differences.map((difference) => (
                          <div key={difference.field} className="import-compare-row">
                            <dt>{difference.label}</dt>
                            <dd>
                              <span className="import-compare-was">
                                <span className="visually-hidden">You have: </span>
                                {difference.existing ?? 'nothing'}
                              </span>
                              <span aria-hidden="true" className="import-compare-arrow">
                                {' → '}
                              </span>
                              <span className="import-compare-now">
                                <span className="visually-hidden">Spreadsheet says: </span>
                                {difference.incoming ?? 'nothing'}
                              </span>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}

                    {row.candidates.length > 0 ? (
                      <p className="import-note">
                        Already in My Stuff: {row.candidates.map((one) => one.name).join(', ')}.
                      </p>
                    ) : null}

                    {/*
                      * A radio group, because exactly one of these is true of a
                      * row at a time — the same reading `EntrySheet` applies to
                      * the bag chips, and the reason those are radios and the
                      * quantity chips are not.
                      */}
                    <div
                      className="chips import-choices"
                      role="radiogroup"
                      aria-label={`What to do with ${row.name}`}
                    >
                      {options.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={choice === option.value}
                          className={`chip ${choice === option.value ? 'is-on' : ''}`}
                          onClick={() =>
                            setChoices((previous) => ({ ...previous, [row.key]: option.value }))
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="import-note">
                      {hintFor(choice, row.decision, row.candidates.length)}
                    </p>
                  </article>
                )
              })}
            </section>
          ) : null}

          {s.reviewCards.length > 0 ? (
            <section className="import-section">
              <h3 className="import-subheading">
                {s.reviewCards.length} to check afterwards
              </h3>
              <p className="import-note">
                These look similar. They will all be imported — have a look afterwards and archive
                one if it turns out to be a duplicate.
              </p>
              {s.reviewCards.map((card) => (
                <div key={`${card.brand}-${card.description}`} className="import-review">
                  <p className="import-review-name">
                    {card.brand} {card.description}
                  </p>
                  <p className="import-review-why">
                    {card.colors.map((c) => greySpelling(c)).join(' and ')}
                  </p>
                </div>
              ))}
            </section>
          ) : null}

          {s.rulesNeedingReview.length > 0 ? (
            <section className="import-section">
              <h3 className="import-subheading">{s.rulesNeedingReview.length} rules need a look</h3>
              <p className="import-note">
                These items will be saved, but Pack Smart could not turn their spreadsheet notes
                into a rule it understands: {s.rulesNeedingReview.join(', ')}.
              </p>
            </section>
          ) : null}

          {s.coverageWarnings.map((warning) => (
            <p key={warning} className="import-note">
              {warning}
            </p>
          ))}

          <button type="button" className="button-primary" onClick={commit}>
            Add these to My Stuff
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setStage('idle')
              setPreview(null)
              setParsed(null)
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {stage === 'committing' ? <p className="import-lead">Saving your things…</p> : null}

      {stage === 'done' ? (
        <div className="import-card">
          <h2 className="import-heading">Done</h2>
          <p className="import-lead">
            <strong>{created}</strong> things are now in My Stuff. Have a look and change anything
            that is not quite right.
          </p>
        </div>
      ) : null}
    </Screen>
  )
}
