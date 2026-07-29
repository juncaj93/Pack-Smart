import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen } from '@/components/Screen'
import { ApiRequestError } from '@/lib/api'
import {
  fetchTrip,
  readItineraryLink,
  readItineraryPdf,
  readItineraryText,
  saveTripDays,
  updateTrip,
  type ItineraryReading,
} from '@/lib/trips'
import type { ItineraryProposal } from '@shared/itinerary'
import { ACTIVITY_LABELS, type Trip as TripModel, type TripDay } from '@shared/trips'
import './Itinerary.css'

type Mode = 'text' | 'link' | 'pdf'

/**
 * Reading an itinerary into a trip.
 *
 * Two halves, and the boundary between them is the point. The top half turns
 * something — pasted text, a link, a PDF — into a PROPOSAL. The bottom half is
 * Alex accepting or rejecting each part of it. Nothing crosses that line without
 * a tap (doc 01 §4 "Infer, then confirm").
 *
 * Every row quotes the line it came from, because a proposal he cannot check
 * against his own itinerary is not reviewable, and an unreviewable proposal is
 * a guess wearing a confirmation dialog.
 */
export default function Itinerary() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const [trip, setTrip] = useState<TripModel | null>(null)
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [reading, setReading] = useState<ItineraryReading | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Which proposed days Alex has kept. Everything starts accepted. */
  const [keptDays, setKeptDays] = useState<Set<string>>(new Set())
  const [keptActivities, setKeptActivities] = useState<Set<string>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setTrip(await fetchTrip(id))
    } catch {
      setError('Could not load that trip.')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  function accept(result: ItineraryReading) {
    setReading(result)
    setKeptDays(new Set(result.proposal.days.map(dayKey)))
    setKeptActivities(new Set(result.proposal.activities.map((a) => a.tag)))
  }

  async function read(run: () => Promise<ItineraryReading>) {
    if (busy) return
    setBusy(true)
    setError(null)
    setReading(null)
    try {
      accept(await run())
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'Could not read that. Check your connection and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const context = { startDate: trip?.startDate ?? null, endDate: trip?.endDate ?? null }

  /**
   * Writes the accepted parts to the trip.
   *
   * Activities go on the trip, days go on the calendar, and saving the days
   * replans the outfits — which is the whole reason a dated itinerary is worth
   * reading. Approved outfits are protected by `generateOutfits` itself.
   */
  async function apply() {
    if (!trip || !reading || busy) return
    setBusy(true)
    setError(null)

    try {
      const activities = [...new Set([...trip.activities, ...keptActivities])]

      await updateTrip(trip.id, {
        name: trip.name,
        emoji: trip.emoji,
        startDate: trip.startDate,
        endDate: trip.endDate,
        destinations: trip.destinations.length
          ? trip.destinations.map((d) => ({ name: d.name, country: d.country }))
          : [{ name: reading.proposal.destinations[0] ?? '', country: null }],
        activities,
        international: trip.international,
        laundryAvailable: trip.laundryAvailable,
        luggageMode: trip.luggageMode as 'carry_on' | 'checked' | 'unknown' | null,
        flightHours: trip.flightHours,
        notes: trip.notes,
      })

      /*
       * Merged with the days already on the trip, not substituted for them.
       *
       * `saveTripDays` replaces the whole set, so sending only the itinerary's
       * days would silently wipe anything Alex had set by hand on the Which
       * days? screen.
       */
      const days = new Map<string, TripDay>(
        trip.days.map((day) => [day.date, day]),
      )
      for (const day of reading.proposal.days) {
        if (!keptDays.has(dayKey(day))) continue
        if (!keptActivities.has(day.activityTag)) continue
        days.set(day.date, { date: day.date, activityTag: day.activityTag })
      }

      await saveTripDays(trip.id, [...days.values()])
      navigate(`/trips/${trip.id}/outfits`)
    } catch {
      setError('Could not save that to the trip.')
      setBusy(false)
    }
  }

  if (!trip && !error) return <Screen title="Itinerary" />

  const proposal = reading?.proposal ?? null

  return (
    <Screen title="Itinerary" subtitle={trip ? `${trip.emoji} ${trip.name}` : undefined}>
      {error ? <p className="field-error">{error}</p> : null}

      <p className="hint">
        Paste your itinerary, a link to it, or a PDF. Pack Smart reads what it can and shows you
        before anything is added — nothing is changed until you say so.
      </p>

      <div className="chips" role="group" aria-label="How do you want to add it?">
        {(
          [
            ['text', 'Paste text'],
            ['link', 'Paste a link'],
            ['pdf', 'Upload a PDF'],
          ] as Array<[Mode, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`chip ${mode === value ? 'is-on' : ''}`}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'text' ? (
        <label className="field">
          <span className="field-label">Your itinerary</span>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'2 August — game drive at first light\n4 August — wine tasting'}
          />
          <button
            type="button"
            className="button-primary"
            disabled={busy || text.trim().length === 0}
            onClick={() => void read(() => readItineraryText(text, context))}
          >
            {busy ? 'Reading…' : 'Read this'}
          </button>
        </label>
      ) : null}

      {mode === 'link' ? (
        <label className="field">
          <span className="field-label">Link to your itinerary</span>
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button
            type="button"
            className="button-primary"
            disabled={busy || url.trim().length === 0}
            onClick={() => void read(() => readItineraryLink(url, context))}
          >
            {busy ? 'Reading…' : 'Read this link'}
          </button>
          <span className="hint">
            A link that needs a login cannot be read — pages behind a sign-in show Pack Smart the
            sign-in page, not your itinerary. Open it yourself and paste the text instead.
          </span>
        </label>
      ) : null}

      {mode === 'pdf' ? (
        <div className="field">
          <span className="field-label">Your itinerary as a PDF</span>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void read(() => readItineraryPdf(file, context))
            }}
          />
          <span className="hint">
            A PDF made from text. A scan or a photo of one holds pictures rather than text, and
            cannot be read.
          </span>
        </div>
      ) : null}

      {reading?.problem ? <p className="critical-warning">{reading.problem}</p> : null}

      {proposal && !proposal.empty ? (
        <section className="proposal">
          <h2 className="section-title">Here is what Pack Smart understood</h2>
          <p className="section-hint">
            Everything is quoted from your itinerary. Untick anything that is wrong.
          </p>

          {proposal.destinations.length > 0 ? (
            <p className="proposal-line">
              <strong>Destination</strong> · {proposal.destinations.join(', ')}
            </p>
          ) : null}

          {proposal.startDate && proposal.endDate ? (
            <p className="proposal-line">
              <strong>Dates</strong> · {proposal.startDate} to {proposal.endDate}
              {trip && (proposal.startDate !== trip.startDate || proposal.endDate !== trip.endDate) ? (
                <span className="hint"> — your trip’s own dates are kept; edit the trip to change them.</span>
              ) : null}
            </p>
          ) : null}

          <h3 className="proposal-heading">Activities</h3>
          <ul className="proposal-list">
            {proposal.activities.map((activity) => (
              <li key={activity.tag}>
                <button
                  type="button"
                  className={`proposal-row ${keptActivities.has(activity.tag) ? 'is-on' : ''}`}
                  aria-pressed={keptActivities.has(activity.tag)}
                  onClick={() => setKeptActivities(toggled(keptActivities, activity.tag))}
                >
                  <span className="proposal-tick" aria-hidden="true">
                    {keptActivities.has(activity.tag) ? '✓' : ''}
                  </span>
                  <span className="proposal-text">
                    <span className="proposal-name">
                      {activity.label}
                      {activity.dayCount > 0
                        ? ` · ${activity.dayCount} ${activity.dayCount === 1 ? 'day' : 'days'}`
                        : ' · no day given'}
                    </span>
                    <span className="proposal-evidence">“{activity.evidence}”</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {proposal.days.length > 0 ? (
            <>
              <h3 className="proposal-heading">Which days</h3>
              <ul className="proposal-list">
                {proposal.days.map((day) => (
                  <li key={dayKey(day)}>
                    <button
                      type="button"
                      className={`proposal-row ${keptDays.has(dayKey(day)) ? 'is-on' : ''}`}
                      aria-pressed={keptDays.has(dayKey(day))}
                      onClick={() => setKeptDays(toggled(keptDays, dayKey(day)))}
                    >
                      <span className="proposal-tick" aria-hidden="true">
                        {keptDays.has(dayKey(day)) ? '✓' : ''}
                      </span>
                      <span className="proposal-text">
                        <span className="proposal-name">
                          {day.date} · {ACTIVITY_LABELS[day.activityTag] ?? day.activityLabel}
                        </span>
                        <span className="proposal-evidence">“{day.evidence}”</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {/*
           * Ambiguity is shown, never resolved silently. 03/08 is the third of
           * August in one convention and the eighth of March in another, and
           * picking one would move an activity by months.
           */}
          {proposal.ambiguousDates.length > 0 ? (
            <div className="proposal-ambiguous">
              <h3 className="proposal-heading">Dates Pack Smart could not settle</h3>
              {proposal.ambiguousDates.map((date) => (
                <p key={`${date.text}-${date.evidence}`} className="hint">
                  “{date.text}” could mean {date.readings.join(' or ')}. Set that day yourself on
                  Which days?
                </p>
              ))}
            </div>
          ) : null}

          <button type="button" className="button-primary" onClick={() => void apply()} disabled={busy}>
            {busy ? 'Saving…' : 'Add these to the trip'}
          </button>
          <p className="hint">
            This adds the activities to your trip and puts them on their days, then plans the
            outfits. Outfits you have already approved are left alone.
          </p>
        </section>
      ) : null}

      <button type="button" className="button-secondary" onClick={() => navigate(`/trips/${id}`)}>
        Back to the trip
      </button>
    </Screen>
  )
}

/** A proposed day is identified by its date AND its activity — one date can hold two. */
function dayKey(day: { date: string; activityTag: string }): string {
  return `${day.date}|${day.activityTag}`
}

function toggled(set: Set<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

export type { ItineraryProposal }
