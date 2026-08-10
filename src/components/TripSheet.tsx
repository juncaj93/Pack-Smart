import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { ApiRequestError } from '@/lib/api'
import { createTrip, saveTripDays, updateTrip } from '@/lib/trips'
import { BAG_LABELS, BAG_MEANING } from '@shared/checklist'
import { CARRIED_BAGS } from '@shared/bags'

/** The three, in the order you pack them: on you, overhead, in the hold. */
const BAG_CHOICES = CARRIED_BAGS.map((key) => ({
  key,
  label: BAG_LABELS[key],
  meaning: BAG_MEANING[key] ?? '',
}))
import {
  ACTIVITIES,
  daysFromTemplate,
  tripDays,
  tripNights,
  type Trip,
  type TripDestinationInput,
  type TripInput,
  type TripTemplate,
} from '@shared/trips'
import { EMOJI_CHOICES, suggestTripEmoji } from '@shared/trip-emoji'
import { DRESSINESS_LABELS } from '@shared/items'
import './TripSheet.css'

interface TripSheetProps {
  open: boolean
  /** null = creating. */
  trip: Trip | null
  /** Last trip's answers, when this was opened by "Plan again". */
  template?: TripTemplate | null
  onClose: () => void
  onSaved: (trip: Trip) => void
}

/**
 * A previous trip's answers, minus its dates.
 *
 * The dates are left empty deliberately. Everything else describes a trip worth
 * repeating; the dates are the one thing that is certainly wrong, and
 * prefilling last year's would invite saving a trip in the past.
 */
function fromTemplate(template: TripTemplate): TripInput {
  return {
    name: template.name,
    emoji: template.emoji,
    startDate: '',
    endDate: '',
    destinations: template.destinations.length
      ? template.destinations
      : [{ name: '', country: null }],
    activities: template.activities,
    international: template.international,
    laundryAvailable: template.laundryAvailable,
    maxDressiness: template.maxDressiness,
    luggageMode: template.luggageMode,
    bags: template.bags,
    flightHours: template.flightHours,
    notes: template.notes,
  }
}

function emptyDraft(): TripInput {
  return {
    name: '',
    emoji: null,
    startDate: '',
    endDate: '',
    destinations: [{ name: '', country: null }],
    activities: [],
    international: null,
    laundryAvailable: null,
    maxDressiness: null,
    luggageMode: null,
    bags: null,
    flightHours: null,
    notes: null,
  }
}

function toDraft(trip: Trip): TripInput {
  return {
    name: trip.name,
    emoji: trip.emoji,
    startDate: trip.startDate,
    endDate: trip.endDate,
    destinations: trip.destinations.length
      ? trip.destinations.map((d) => ({
          name: d.name,
          country: d.country,
          arriveDate: d.arriveDate,
          departDate: d.departDate,
        }))
      : [{ name: '', country: null }],
    activities: trip.activities,
    international: trip.international,
    laundryAvailable: trip.laundryAvailable,
    maxDressiness: trip.maxDressiness,
    luggageMode: (trip.luggageMode as TripInput['luggageMode']) ?? null,
    bags: trip.bags,
    flightHours: trip.flightHours,
    notes: trip.notes,
  }
}

/**
 * Create and edit a trip.
 *
 * Only four things are required — name, dates, one destination — and everything
 * that shapes the packing list is a tap rather than typing. The three-state
 * answers (yes / no / not asked) are deliberate: an unanswered question must
 * stay unanswered, because the engine treats "no" and "never asked" differently
 * and packing on a default Alex never chose is the failure mode this product
 * exists to avoid (03_INTELLIGENCE_DESIGN.md §4).
 */
export function TripSheet({ open, trip, template, onClose, onSaved }: TripSheetProps) {
  const [draft, setDraft] = useState<TripInput>(emptyDraft)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(trip ? toDraft(trip) : template ? fromTemplate(template) : emptyDraft())
    setFieldErrors({})
    setError(null)
  }, [open, trip, template])

  function set<K extends keyof TripInput>(key: K, value: TripInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function toggleActivity(tag: string) {
    setDraft((prev) => ({
      ...prev,
      activities: prev.activities.includes(tag)
        ? prev.activities.filter((a) => a !== tag)
        : [...prev.activities, tag],
    }))
  }

  /*
   * The live suggestion, while the sheet is open.
   *
   * Recomputed as Alex types so the icon reacts to what he has just entered —
   * this is a preview, not the stored value. Once the trip exists the stored
   * emoji is what shows, and it never re-suggests itself (02_DATA_MODEL.md §3).
   */
  const suggested = suggestTripEmoji({
    destination: draft.destinations[0]?.name ?? null,
    activities: draft.activities,
    name: draft.name,
  })

  const hasDates = Boolean(draft.startDate && draft.endDate)
  const days = hasDates ? tripDays(draft.startDate, draft.endDate) : 0
  const nights = hasDates ? tripNights(draft.startDate, draft.endDate) : 0

  async function save() {
    if (busy) return
    setBusy(true)
    setError(null)
    setFieldErrors({})

    try {
      const result = trip ? await updateTrip(trip.id, draft) : await createTrip(draft)

      /*
       * The day plan comes across as OFFSETS, placed on the new dates.
       *
       * A safari on the third day of last year's trip should be the third day
       * of this one. Copying the old date verbatim would land it outside the
       * trip, where `setTripDays` drops it without comment.
       */
      if (!trip && template && template.dayOffsets.length > 0) {
        const days = daysFromTemplate(template, result.trip.startDate, result.trip.endDate)
        if (days.length > 0) await saveTripDays(result.trip.id, days)
      }

      onSaved(result.trip)
      onClose()
    } catch (cause) {
      if (cause instanceof ApiRequestError) {
        setFieldErrors(cause.fields)
        setError(Object.keys(cause.fields).length ? null : cause.message)
      } else {
        setError('Could not save that trip.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={trip ? 'Edit trip' : 'New trip'}>
      <div className="form">
        <label className="field">
          <span className="field-label">Trip name</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="South Africa"
            autoCapitalize="words"
            enterKeyHint="next"
          />
          {fieldErrors.name ? <span className="field-error">{fieldErrors.name}</span> : null}
        </label>

        <EmojiField
          value={draft.emoji ?? suggested}
          suggested={suggested}
          chosen={Boolean(draft.emoji)}
          onChange={(emoji) => set('emoji', emoji)}
        />

        <Destinations
          stops={draft.destinations}
          error={fieldErrors.destinations ?? null}
          tripStart={draft.startDate}
          tripEnd={draft.endDate}
          onChange={(stops) => set('destinations', stops)}
        />

        <div className="date-pair">
          <label className="field">
            <span className="field-label">Leaving</span>
            <input
              type="date"
              value={draft.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
            {fieldErrors.startDate ? (
              <span className="field-error">{fieldErrors.startDate}</span>
            ) : null}
          </label>

          <label className="field">
            <span className="field-label">Returning</span>
            <input
              type="date"
              value={draft.endDate}
              min={draft.startDate || undefined}
              onChange={(e) => set('endDate', e.target.value)}
            />
            {fieldErrors.endDate ? <span className="field-error">{fieldErrors.endDate}</span> : null}
          </label>
        </div>

        {hasDates && days > 0 ? (
          <p className="hint duration-note">
            {days} {days === 1 ? 'day' : 'days'}, {nights} {nights === 1 ? 'night' : 'nights'}.
            Quantities are worked out from the days.
          </p>
        ) : null}

        <div className="field">
          <span className="field-label">What are you doing?</span>
          <div className="chips">
            {ACTIVITIES.map((activity) => (
              <button
                key={activity.tag}
                type="button"
                className={`chip ${draft.activities.includes(activity.tag) ? 'is-on' : ''}`}
                aria-pressed={draft.activities.includes(activity.tag)}
                onClick={() => toggleActivity(activity.tag)}
              >
                {activity.label}
              </button>
            ))}
          </div>
        </div>

        <TriState
          label="Leaving the country?"
          value={draft.international ?? null}
          onChange={(value) => set('international', value)}
        />

        <TriState
          label="Laundry where you are staying?"
          value={draft.laundryAvailable ?? null}
          onChange={(value) => set('laundryAvailable', value)}
        />

        <div className="field">
          <span className="field-label">Dressiest thing you are doing</span>
          <div className="chips">
            {DRESSINESS_LABELS.map((label, level) => (
              <button
                key={label}
                type="button"
                className={`chip ${draft.maxDressiness === level ? 'is-on' : ''}`}
                aria-pressed={draft.maxDressiness === level}
                // Tapping the chosen level again clears it, the same gesture as
                // the yes/no answers above.
                onClick={() => set('maxDressiness', draft.maxDressiness === level ? null : level)}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.maxDressiness === null ? (
            <span className="hint">Not answered — nothing will be ruled out.</span>
          ) : (
            <span className="hint">
              Nothing dressier than this is suggested. An occasion that needs more — a wedding —
              is not held back by it.
            </span>
          )}
        </div>

        {/*
          * Which bags are coming, as a multi-select rather than one choice (P3).
          *
          * The old `luggageMode` could say "carry-on" or "checked" and could not
          * say "a personal item and a checked bag", which is most flights — nor
          * "none of these", which is every train and every drive. It is still
          * stored and still read for trips that predate this; this is what
          * answers from now on.
          *
          * Optional, and silence is a real state: leaving it alone keeps every
          * recommendation exactly as it was.
          */}
        <div className="field">
          <span className="field-label">Which bags are you taking? (optional)</span>
          <div className="chips" role="group" aria-label="Which bags are you taking?">
            {BAG_CHOICES.map(({ key, label, meaning }) => {
              const on = (draft.bags ?? []).includes(key)
              return (
                <button
                  key={key}
                  type="button"
                  className={`chip ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  /*
                   * The meaning rides on the accessible name as well as being
                   * printed below. `Personal item` is airline language for the
                   * thing under the seat, and a chip that only says those two
                   * words is a chip Alex has to guess at — by voice or by
                   * VoiceOver most of all, where the list below is a separate
                   * stop rather than something read alongside it.
                   */
                  aria-label={meaning ? `${label} — ${meaning}` : label}
                  onClick={() =>
                    set(
                      'bags',
                      on
                        ? (draft.bags ?? []).filter((bag) => bag !== key)
                        : [...(draft.bags ?? []), key],
                    )
                  }
                >
                  {label}
                </button>
              )
            })}
          </div>

          {/*
            * What each one MEANS, said once rather than per trip.
            *
            * The names stay the same on a drive and on a flight: renaming them
            * per trip would give the data model a second vocabulary and the
            * screens two words for one column. Saying what they mean costs
            * three short lines and is true either way.
            */}
          <dl className="bag-meanings">
            {BAG_CHOICES.map(({ key, label, meaning }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
          <span className="hint">
            {draft.bags === null || draft.bags === undefined
              ? 'Skip this and Pack Smart suggests as it always has.'
              : draft.bags.length === 0
                ? 'No bags of these kinds — suggestions will be about convenience rather than cabins.'
                : 'Your passport, medication and anything essential stay out of the hold whatever you pick.'}
          </span>
        </div>

        <label className="field">
          <span className="field-label">Hours in the air (optional)</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={48}
            value={draft.flightHours ?? ''}
            onChange={(e) => set('flightHours', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="15"
          />
          {fieldErrors.flightHours ? (
            <span className="field-error">{fieldErrors.flightHours}</span>
          ) : null}
        </label>

        {error ? <p className="field-error">{error}</p> : null}

        <button type="button" className="button-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : trip ? 'Save changes' : 'Create trip'}
        </button>
      </div>
    </BottomSheet>
  )
}

interface TriStateProps {
  label: string
  value: boolean | null
  onChange: (value: boolean | null) => void
}

/**
 * Yes / No / not answered.
 *
 * Tapping the selected answer again clears it. That is the only way back to
 * "not answered", and it needs to exist: the engine will not pack an item on an
 * unanswered question, and it should not be possible to be stuck with an answer
 * Alex did not mean to give.
 */
function TriState({ label, value, onChange }: TriStateProps) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="chips">
        <button
          type="button"
          className={`chip ${value === true ? 'is-on' : ''}`}
          aria-pressed={value === true}
          onClick={() => onChange(value === true ? null : true)}
        >
          Yes
        </button>
        <button
          type="button"
          className={`chip ${value === false ? 'is-on' : ''}`}
          aria-pressed={value === false}
          onClick={() => onChange(value === false ? null : false)}
        >
          No
        </button>
      </div>
      {value === null ? <span className="hint">Not answered — nothing will be assumed.</span> : null}
    </div>
  )
}

/**
 * The trip's icon: a suggestion Alex can overrule.
 *
 * Twenty curated choices rather than the system emoji keyboard. The point is a
 * recognisable glyph in a list of trips, and two thousand options is a decision
 * he did not ask to make. Collapsed until tapped, because the suggestion is
 * right most of the time and an open grid on every new trip is noise.
 */
function EmojiField({
  value,
  suggested,
  chosen,
  onChange,
}: {
  value: string
  suggested: string
  chosen: boolean
  onChange: (emoji: string) => void
}) {
  const [open, setOpen] = useState(false)

  // The current value always appears, so the chosen icon is never missing from
  // its own picker.
  const choices = EMOJI_CHOICES.includes(value as (typeof EMOJI_CHOICES)[number])
    ? EMOJI_CHOICES
    : [value, ...EMOJI_CHOICES]

  return (
    <div className="field">
      <span className="field-label">Icon</span>
      <button
        type="button"
        className="emoji-current"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="emoji-glyph" aria-hidden="true">
          {value}
        </span>
        <span className="emoji-hint">
          {chosen ? 'Your choice · tap to change' : 'Suggested · tap to change'}
        </span>
      </button>

      {open ? (
        <div className="emoji-grid" role="group" aria-label="Choose an icon for this trip">
          {choices.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={`emoji-option ${emoji === value ? 'is-on' : ''}`}
              aria-pressed={emoji === value}
              aria-label={`Use ${emoji}`}
              onClick={() => {
                onChange(emoji)
                setOpen(false)
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}

      {chosen && value !== suggested ? (
        <button
          type="button"
          className="button-secondary subtle"
          onClick={() => onChange(suggested)}
        >
          Use the suggested {suggested} instead
        </button>
      ) : null}
    </div>
  )
}

/**
 * Where the trip goes — one place, or several with dates.
 *
 * The first stop is a plain text field, exactly as it always was, because that
 * is nearly every trip and it must not get harder. Extra stops are behind a
 * disclosure, and only THEY ask for dates: with one destination there is nothing
 * to disambiguate, and asking would be demanding information Alex has already
 * given as the trip's own dates.
 *
 * The dates are what make a per-day forecast possible. Without them a multi-stop
 * trip has no answer to "which city am I in on the Tuesday", and
 * `destinationForDate` deliberately returns nothing rather than guessing — so
 * the hint below says plainly what the dates buy.
 */
function Destinations({
  stops,
  error,
  tripStart,
  tripEnd,
  onChange,
}: {
  stops: TripDestinationInput[]
  error: string | null
  tripStart: string
  tripEnd: string
  onChange: (stops: TripDestinationInput[]) => void
}) {
  const [expanded, setExpanded] = useState(stops.length > 1)

  function update(index: number, patch: Partial<TripDestinationInput>) {
    onChange(stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)))
  }

  const multi = stops.length > 1

  return (
    <div className="field">
      <span className="field-label">{multi ? 'Where you are going' : 'Destination'}</span>

      {stops.map((stop, index) => (
        <div key={index} className={multi ? 'stop' : undefined}>
          <input
            type="text"
            value={stop.name}
            onChange={(e) => update(index, { name: e.target.value })}
            placeholder={index === 0 ? 'Cape Town' : 'Next stop'}
            autoCapitalize="words"
            aria-label={index === 0 ? 'Destination' : `Stop ${index + 1}`}
          />

          {multi ? (
            <>
              <div className="date-pair stop-dates">
                <label className="field">
                  <span className="field-label">Arrive</span>
                  <input
                    type="date"
                    value={stop.arriveDate ?? ''}
                    min={tripStart || undefined}
                    max={tripEnd || undefined}
                    onChange={(e) => update(index, { arriveDate: e.target.value || null })}
                    aria-label={`Arrive in ${stop.name || `stop ${index + 1}`}`}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Leave</span>
                  <input
                    type="date"
                    value={stop.departDate ?? ''}
                    min={stop.arriveDate || tripStart || undefined}
                    max={tripEnd || undefined}
                    onChange={(e) => update(index, { departDate: e.target.value || null })}
                    aria-label={`Leave ${stop.name || `stop ${index + 1}`}`}
                  />
                </label>
              </div>

              {index > 0 ? (
                <button
                  type="button"
                  className="button-secondary subtle"
                  onClick={() => onChange(stops.filter((_, i) => i !== index))}
                >
                  Remove this stop
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ))}

      {error ? <span className="field-error">{error}</span> : null}

      {expanded || multi ? (
        <>
          <button
            type="button"
            className="button-secondary"
            onClick={() => onChange([...stops, { name: '', country: null }])}
          >
            Add another stop
          </button>
          <span className="hint">
            Give each stop its dates and Pack Smart checks the weather for wherever you are that
            day. Without them it will not guess which city you are in, and plans without weather.
          </span>
        </>
      ) : (
        <button type="button" className="button-secondary subtle" onClick={() => setExpanded(true)}>
          Going to more than one place?
        </button>
      )}
    </div>
  )
}
