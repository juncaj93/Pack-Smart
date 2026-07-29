import { useRef, useState } from 'react'
import { Screen } from '@/components/Screen'
import { ApiRequestError, apiFetch } from '@/lib/api'
import type { ImportSummary } from '@shared/import'
import { WorkbookError, readWorkbook } from '@shared/xlsx'
import './Import.css'

interface DryRunResponse {
  summary: ImportSummary
  existingItems: number
  willAppend: boolean
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
        body: JSON.stringify(parsed),
      })
      setCreated(result.created)
      setStage('done')
    } catch {
      setError('The import did not finish. Nothing partial was left behind that you cannot archive.')
      setStage('preview')
    }
  }

  const s = preview?.summary

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
                  <p className="import-review-why">{card.colors.join(' and ')}</p>
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
