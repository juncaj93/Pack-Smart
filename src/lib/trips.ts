import type { PlanChange } from '@shared/replan'
import type { PlanDelta } from '@shared/plan-delta'
import { apiFetch } from '@/lib/api'
import type { ChecklistEntry } from '@shared/checklist'
import type { CoverageGap } from '@shared/essentials'
import type { Trip, TripDay, TripInput, TripTemplate } from '@shared/trips'
import type { ItineraryProposal } from '@shared/itinerary'
import type {
  CarryGroup,
  DateBasis,
  TodayIssue,
  TodayWeather,
} from '@shared/today'
import type { WeatherFreshness } from '@shared/weather'
import type { WeatherConflict } from '@shared/weather-conflict'
import type { WeatherDay } from '@shared/weather'

export interface GenerationResult {
  created: number
  updated: number
  preserved: number
  needsAnswer: string[]
}

export function fetchTrips(): Promise<{ trips: Trip[] }> {
  return apiFetch<{ trips: Trip[] }>('/api/trips')
}

export function fetchTrip(id: string): Promise<Trip> {
  return apiFetch<Trip>(`/api/trips/${id}`)
}

export function createTrip(input: TripInput): Promise<{ trip: Trip; generation: GenerationResult }> {
  return apiFetch<{ trip: Trip; generation: GenerationResult }>('/api/trips', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateTrip(
  id: string,
  input: TripInput,
): Promise<{ trip: Trip; generation: GenerationResult; deltas: PlanDelta[] }> {
  return apiFetch<{ trip: Trip; generation: GenerationResult; deltas: PlanDelta[] }>(
    `/api/trips/${id}`,
    { method: 'PUT', body: JSON.stringify(input) },
  )
}

/** Last trip's answers, for "Plan again". Reads only — creates nothing. */
export function archiveTrip(id: string): Promise<Trip> {
  return apiFetch<Trip>(`/api/trips/${id}/archive`, { method: 'POST' })
}

export function restoreTrip(id: string): Promise<Trip> {
  return apiFetch<Trip>(`/api/trips/${id}/restore`, { method: 'POST' })
}

/** Permanent. `deleteTrip` in the repo says what goes and what stays. */
export function deleteTrip(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/api/trips/${id}`, { method: 'DELETE' })
}

export function fetchTripTemplate(
  id: string,
): Promise<{ template: TripTemplate; from: { id: string; name: string } }> {
  return apiFetch(`/api/trips/${id}/duplicate`)
}

/** An approved outfit built on a garment this trip is not bringing (doc 04 §8). */
export interface OutfitConflict {
  groupId: string
  groupName: string
  slotId: string
  roleLabel: string
  itemId: string
  itemName: string
  /** Set aside for this trip, or gone from the wardrobe altogether (D1b). */
  why: 'not_bringing' | 'archived'
}

export interface ChecklistResult {
  trip: Trip
  entries: ChecklistEntry[]
  coverage: CoverageGap[]
  conflicts: OutfitConflict[]
}

export function fetchChecklist(tripId: string): Promise<ChecklistResult> {
  return apiFetch<ChecklistResult>(`/api/trips/${tripId}/checklist`)
}

export interface EntryPatch {
  packedQty?: number
  qtyOverride?: number | null
  packingTiming?: string
  finalChecked?: boolean
  /** `null` hands the row back to Pack Smart's recommendation (doc 09 §11). */
  bag?: string | null
  /**
   * Apply this only if the row has not been written since (F2).
   *
   * Sent by the offline queue and by nothing else. An ordinary tap with a live
   * connection is unconditional — the read and the write are a second apart, so
   * there is no stale intent to protect against.
   */
  ifUnmodifiedSince?: number
}

export function patchEntry(
  tripId: string,
  entryId: string,
  patch: EntryPatch,
): Promise<ChecklistEntry> {
  return apiFetch<ChecklistEntry>(`/api/trips/${tripId}/checklist/${entryId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** The outfit a removed garment leaves short, and the slot to fill (doc 04 §8). */
export interface AffectedOutfit {
  groupId: string
  name: string
  slotId: string
  role: string
  roleLabel: string
}

/**
 * Not bringing this — and what that costs the outfit plan.
 *
 * `affectedOutfits` is empty for anything no approved outfit uses, which is most
 * of the list. The screen offers a replacement only when there is genuinely one
 * to offer.
 */
export function excludeEntry(
  tripId: string,
  entryId: string,
): Promise<ChecklistEntry & { affectedOutfits: AffectedOutfit[] }> {
  return apiFetch<ChecklistEntry & { affectedOutfits: AffectedOutfit[] }>(
    `/api/trips/${tripId}/checklist/${entryId}/exclude`,
    { method: 'POST' },
  )
}

export function restoreEntry(tripId: string, entryId: string): Promise<ChecklistEntry> {
  return apiFetch<ChecklistEntry>(`/api/trips/${tripId}/checklist/${entryId}/restore`, {
    method: 'POST',
  })
}

export function addTripOnlyItem(
  tripId: string,
  name: string,
  category: string,
  quantity: number,
): Promise<ChecklistEntry> {
  return apiFetch<ChecklistEntry>(`/api/trips/${tripId}/checklist/items`, {
    method: 'POST',
    body: JSON.stringify({ name, category, quantity }),
  })
}

/* ------------------------------------------------------------------ */
/* outfits                                                             */
/* ------------------------------------------------------------------ */

export interface OutfitSlot {
  id: string
  role: string
  roleLabel: string
  required: boolean
  itemId: string | null
  itemName: string | null
  /** "Columbia · Black" — who made it and which one (G6), or null. */
  itemDetail: string | null
  /** The colour on its own, as stored, for the row's swatch. */
  itemColor: string | null
  wearings: number
  /** The garment is on this trip's Not bringing list (doc 04 §8). */
  setAside: boolean
  unmetReason: string | null
  reason: string | null
  /** `user_swap` when Alex chose this garment himself — see `explainOutfit`. */
  filledBy: string | null
  sortOrder: number
}

export interface OutfitGroup {
  id: string
  tripId: string
  name: string
  activityTag: string | null
  occurrences: number
  status: 'draft' | 'approved' | 'incomplete'
  /** When Alex said "decide later", or null. Never resolves the outfit. */
  deferredAt: number | null
  /**
   * One short sentence when the trip has moved out from under an APPROVED
   * outfit — the jacket that is not warm enough for the new forecast, the shirt
   * that is too casual now the dinner is formal.
   *
   * Never an un-approval. Alex's explicit choice stands until he changes it;
   * this only says the ground under it moved.
   */
  reviewReason: string | null
  slots: OutfitSlot[]
  sortOrder: number
}

export interface SyncResult {
  added: number
  updated: number
  removed: number
}

export interface SwapOption {
  id: string
  name: string
  subcategory: string | null
  color: string | null
  brand: string | null
  /** "Columbia · Black" — who made it and which one (G6), or null. */
  detail: string | null
  suitable: boolean
  reason: string | null
  /**
   * Whether this is the kind of garment the slot usually holds (G3).
   *
   * The list now carries the whole active wardrobe. This is what separates the
   * slot's own garments from the rest, and nothing more — an item outside the
   * slot is still choosable, still shown, and still explained.
   */
  inSlot: boolean
  /**
   * The one criterion that put this garment above the next one down (§18).
   *
   * Null far more often than set, and that is the design: `rank` refuses to
   * name a criterion that did not separate the two, so a row carrying a reason
   * is a row where the reason decided something.
   */
  recommendation: string | null
}

/**
 * The line under a garment in an outfit slot: which one, how often, and why.
 *
 * One function for both the outfits list and the guided review, because the two
 * screens show the same slot and a disagreement between them about which
 * quarter-zip is in it would be indistinguishable from a bug. The detail comes
 * first (G6): the name stopped repeating the row's own brand and colour, so
 * this is what tells one of seven quarter-zips from the next, and the wearings
 * and the reason are facts about a garment already identified.
 */
export function slotSecondary(slot: OutfitSlot): string {
  return [
    slot.itemDetail,
    slot.wearings > 1 ? `Worn ${slot.wearings} days` : null,
    slot.reason,
  ]
    .filter((part): part is string => !!part)
    .join(' · ')
}

export interface OutfitsResult {
  groups: OutfitGroup[]
  /**
   * The plan is older than the days it plans for, and needs replanning (P1B).
   *
   * Server-computed from two timestamps on the trip, never inferred here — see
   * `outfitsAreStale`. It is what lets saving days answer immediately without
   * the replan becoming a promise the client might not keep.
   */
  stale: boolean
  /**
   * What is different about the trip since the plan was made (§31).
   *
   * Empty is the normal answer and the one that keeps the bottom of the screen
   * quiet. Non-empty is what turns `Refresh suggestions` into `Update outfits
   * for changes` with a reason attached.
   */
  changes: PlanChange[]
}

export function fetchOutfits(tripId: string): Promise<OutfitsResult> {
  return apiFetch<OutfitsResult>(`/api/trips/${tripId}/outfits`)
}

export interface GenerateOutfitsResult {
  groups: OutfitGroup[]
  regenerated: boolean
  /** How many outfits were planned again, and how many approvals were honoured. */
  replannedCount: number
  keptApproved: number
  /** What had changed about the trip, as of the moment this plan ran. */
  changes: PlanChange[]
  /** Approved outfits the changes have put a question mark over (§30 case C). */
  flagged: Array<{ id: string; name: string; reason: string }>
  /**
   * What the replan actually did, as opposed to what prompted it.
   *
   * Separate from `changes` because they answer different questions and can
   * legitimately disagree: a forecast that crossed a band but left every
   * garment still the best choice reports a change and an empty delta.
   */
  deltas: PlanDelta[]
}

export function generateOutfits(tripId: string): Promise<GenerateOutfitsResult> {
  return apiFetch<GenerateOutfitsResult>(`/api/trips/${tripId}/outfits/generate`, {
    method: 'POST',
  })
}

export function setOutfitStatus(
  tripId: string,
  groupId: string,
  status: 'approved' | 'draft',
): Promise<{
  groups: OutfitGroup[]
  sync: SyncResult
  refused: boolean
  /** Whether approving recorded a lasting saved-outfit relationship. */
  remembered: boolean
}> {
  return apiFetch<{
    groups: OutfitGroup[]
    sync: SyncResult
    refused: boolean
    remembered: boolean
  }>(`/api/trips/${tripId}/outfits/${groupId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  })
}

/**
 * "Decide later", and coming back from it.
 *
 * Changes nothing but the marker — no status, no slots, no packing list. A
 * deferred outfit is still unresolved and its clothes are still not packed,
 * which the review says out loud rather than leaving to be discovered.
 */
export function deferOutfit(
  tripId: string,
  groupId: string,
  deferred: boolean,
): Promise<{ groups: OutfitGroup[] }> {
  return apiFetch<{ groups: OutfitGroup[] }>(`/api/trips/${tripId}/outfits/${groupId}/defer`, {
    method: 'POST',
    body: JSON.stringify({ deferred }),
  })
}

/**
 * Declines the saved-outfit relationship an approval just created, keeping the
 * approval. Doc 04 §5: the lasting effect must be refusable on its own.
 */
export function forgetOutfitPairings(tripId: string, groupId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/api/trips/${tripId}/outfits/${groupId}/forget-pairings`,
    { method: 'POST' },
  )
}

/**
 * What the replacement list was filtered by (C2b).
 *
 * Shown in the sheet, because a list that silently rejects half the wardrobe is
 * indistinguishable from a broken one — "8–10 Aug, Kruger, rain likely" is what
 * makes "not recorded as keeping rain out" read as an answer.
 */
export interface SwapContext {
  roleLabel: string
  when: string
  place: string | null
  activity: string | null
  travelDay: boolean
  formality: string | null
  conditions: string | null
  /**
   * The rest of the outfit — every filled slot but the one being changed.
   *
   * Replacing a garment is a relational question, and this is the half of it
   * the sheet used to leave behind on the previous screen.
   */
  paired: PairedGarment[]
}

/** One garment the replacement will be worn with. */
export interface PairedGarment {
  role: string
  roleLabel: string
  itemId: string
  itemName: string
  /** "Nordstrom · Bone", or null. */
  detail: string | null
  /** The colour on its own, as stored, for the swatch beside it. */
  color: string | null
}

export function fetchSwapOptions(
  tripId: string,
  groupId: string,
  slotId: string,
): Promise<{ candidates: SwapOption[]; context: SwapContext | null }> {
  return apiFetch<{ candidates: SwapOption[]; context: SwapContext | null }>(
    `/api/trips/${tripId}/outfits/${groupId}/slots/${slotId}/candidates`,
  )
}

export function setSlotItem(
  tripId: string,
  groupId: string,
  slotId: string,
  itemId: string | null,
): Promise<{ groups: OutfitGroup[]; sync: SyncResult; deltas: PlanDelta[] }> {
  return apiFetch<{ groups: OutfitGroup[]; sync: SyncResult; deltas: PlanDelta[] }>(
    `/api/trips/${tripId}/outfits/${groupId}/slots/${slotId}`,
    { method: 'PUT', body: JSON.stringify({ itemId }) },
  )
}

/* ------------------------------------------------------------------ */
/* during trip                                                         */
/* ------------------------------------------------------------------ */

export interface PlannedItem {
  itemId: string
  name: string
  role: string
  roleLabel: string
  reason: string | null
}

/** One replacement Today can offer: packed, and told apart from its twins (G6). */
export interface AlternativeItem {
  itemId: string
  name: string
  detail: string | null
}

export interface DayPlan {
  date: string
  groupName: string | null
  wear: PlannedItem[]
  bring: PlannedItem[]
  missing: Array<{
    role: string
    roleLabel: string
    name: string
    itemId: string | null
    alternatives: PlannedItem[]
  }>
}

export type WearAction = 'will_wear' | 'already_wore' | 'not_available' | 'too_warm' | 'too_cold'

/**
 * Today, as the server assembled it.
 *
 * One response, not five. Everything after `actionLabels` is the E1 briefing —
 * where Alex is, what he is doing, what the weather is, what is unresolved and
 * what to carry — and it arrives with the plan because Today is held to a single
 * serial round trip (`tests/e2e/performance.spec.ts`).
 */
export interface TodayResponse extends TodayBriefing {
  trip: Trip
  date: string
  dates: string[]
  plan: DayPlan
  /**
   * Every outfit this date calls for, in the order the day happens (G2).
   *
   * Optional because it is additive: a page running the JavaScript the service
   * worker cached before G2 shipped receives a response carrying both, and one
   * running the new code against an older Worker receives only `plan`. Either
   * way the screen falls back to `[plan]`, which is what it always showed.
   */
  plans?: DayPlan[]
  wearLog: Record<string, WearAction>
  actionLabels: Record<WearAction, string>
}

export interface TodayBriefing {
  place: { name: string; country: string | null } | null
  activity: { tag: string; label: string } | null
  weather: TodayWeather | null
  /** Live, stale, seasonal or unavailable. The four must never look alike (E2). */
  freshness: WeatherFreshness
  weatherFetchedAt: number | null
  /** Where today's weather disagrees with today's outfit. Never acted on. */
  conflicts: WeatherConflict[]
  issue: TodayIssue
  carry: CarryGroup[]
  todayDate: string
  dateBasis: DateBasis
  timezone: string | null
  dateCaveat: boolean
}

/**
 * Go and look at the weather again, because Alex asked.
 *
 * Answers with the whole Today briefing rather than just the forecast, so the
 * conflicts and the freshness label move together with the numbers they are
 * about. A POST, so `sw.js` never serves it from cache — checking again has to
 * actually check.
 */
export function refreshTodayWeather(tripId: string, date: string): Promise<TodayUpdate> {
  return apiFetch<TodayUpdate>(`/api/trips/${tripId}/today/weather`, {
    method: 'POST',
    headers: { [CLIENT_DATE_HEADER]: deviceToday() },
    body: JSON.stringify({ date }),
  })
}

/** "Keep this outfit" — recorded against the forecast it was answered about. */
export function dismissConflict(
  tripId: string,
  date: string,
  kind: string,
): Promise<TodayUpdate> {
  return apiFetch<TodayUpdate>(`/api/trips/${tripId}/today/dismiss`, {
    method: 'POST',
    headers: { [CLIENT_DATE_HEADER]: deviceToday() },
    body: JSON.stringify({ date, kind }),
  })
}

/**
 * The phone's own calendar date.
 *
 * Sent with every Today request so the server can answer "what day is it"
 * without falling back to UTC — which, for Alex on the US east coast, is the
 * next day from seven in the evening. The trip's own time zone still outranks
 * it; this is the middle rung, not the top one.
 */
export function deviceToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The header the date rides in on, and why it is not a query parameter.
 *
 * `sw.js` caches `GET /api/*` by the full URL, so `?today=2026-08-04` would
 * mint a new cache entry every midnight and — worse — miss yesterday's entry
 * entirely, which is exactly the day an offline read matters. A header leaves
 * the cache key alone: offline, Alex gets the last Today he actually saw, which
 * is the honest answer and the one F2 will build on.
 */
export const CLIENT_DATE_HEADER = 'X-Client-Date'

export function fetchToday(tripId: string, date?: string): Promise<TodayResponse> {
  const query = date ? `?date=${date}` : ''
  return apiFetch<TodayResponse>(`/api/trips/${tripId}/today${query}`, {
    headers: { [CLIENT_DATE_HEADER]: deviceToday() },
  })
}

export function fetchAlternatives(
  tripId: string,
  date: string,
  role: string,
): Promise<{ options: AlternativeItem[] }> {
  return apiFetch<{ options: AlternativeItem[] }>(
    `/api/trips/${tripId}/today/alternatives?date=${date}&role=${encodeURIComponent(role)}`,
  )
}

export interface TodayUpdate extends TodayBriefing {
  date: string
  plan: DayPlan
  plans?: DayPlan[]
  wearLog: Record<string, WearAction>
}

export function recordWear(
  tripId: string,
  date: string,
  itemId: string,
  action: WearAction,
  replaceWith?: string | null,
): Promise<TodayUpdate> {
  return apiFetch<TodayUpdate>(`/api/trips/${tripId}/today/wear`, {
    method: 'POST',
    headers: { [CLIENT_DATE_HEADER]: deviceToday() },
    body: JSON.stringify({ date, itemId, action, replaceWith: replaceWith ?? null }),
  })
}

export function swapForToday(
  tripId: string,
  date: string,
  fromItemId: string,
  toItemId: string | null,
): Promise<TodayUpdate> {
  return apiFetch<TodayUpdate>(`/api/trips/${tripId}/today/swap`, {
    method: 'POST',
    headers: { [CLIENT_DATE_HEADER]: deviceToday() },
    body: JSON.stringify({ date, fromItemId, toItemId }),
  })
}

/* ------------------------------------------------------------------ */
/* one last look                                                       */
/* ------------------------------------------------------------------ */

export interface LastLookItem {
  itemId: string
  name: string
  subcategory: string | null
  color: string | null
  role: string | null
  roleLabel: string | null
  reason: string
}

export interface LastLookResult {
  nearMatches: LastLookItem[]
  remaining: LastLookItem[]
}

export function fetchLastLook(tripId: string): Promise<LastLookResult> {
  return apiFetch<LastLookResult>(`/api/trips/${tripId}/outfits/last-look`)
}

export function addFromWardrobe(tripId: string, itemId: string): Promise<ChecklistEntry> {
  return apiFetch<ChecklistEntry>(`/api/trips/${tripId}/checklist/from-wardrobe`, {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  })
}

/* ------------------------------------------------------------------ */
/* which days are what                                                 */
/* ------------------------------------------------------------------ */

/**
 * Saving days no longer replans, so it no longer reports what the replan did.
 *
 * D1c's `replanned` / `replannedCount` / `keptApproved` moved to
 * `generateOutfits`, which is where the work moved (P1B). They were never shown
 * anywhere: both callers navigate straight to Outfits, which is now the screen
 * that both runs the replan and has somewhere to say `2 replanned, 1 left as
 * you approved it`.
 *
 * `outfitsStale` is not read by either caller either — the Outfits screen asks
 * the server rather than being told, so that a refresh or a dropped connection
 * cannot lose the fact. It is here because it is what the route now answers,
 * and a type that quietly omitted it would be the first thing to go stale.
 */
export interface TripDaysResult {
  trip: Trip
  outfitsStale: boolean
}

export function saveTripDays(tripId: string, days: TripDay[]): Promise<TripDaysResult> {
  return apiFetch<TripDaysResult>(`/api/trips/${tripId}/days`, {
    method: 'PUT',
    body: JSON.stringify({ days }),
  })
}

/* ------------------------------------------------------------------ */
/* weather                                                             */
/* ------------------------------------------------------------------ */

export interface TripWeather {
  days: WeatherDay[]
  status: 'ok' | 'too_far_out' | 'no_destination' | 'unavailable'
  /** When it was last fetched, and what that makes it (E2). */
  fetchedAt: number | null
  freshness: WeatherFreshness
  summary: string | null
  note: string | null
}

/** Reads what is stored. Never reaches out, so it is safe offline. */
export function fetchWeather(tripId: string): Promise<TripWeather> {
  return apiFetch<TripWeather>(`/api/trips/${tripId}/weather`)
}

/** Asks Pack Smart to go and look. Answers with a status either way. */
export function refreshWeather(tripId: string): Promise<TripWeather> {
  return apiFetch<TripWeather>(`/api/trips/${tripId}/weather`, { method: 'POST' })
}

/* ------------------------------------------------------------------ */
/* itinerary                                                           */
/* ------------------------------------------------------------------ */

export interface ItineraryReading {
  proposal: ItineraryProposal
  source: 'text' | 'link' | 'pdf'
  problem: string | null
}

interface ItineraryContext {
  startDate?: string | null
  endDate?: string | null
}

export function readItineraryText(
  text: string,
  context: ItineraryContext = {},
): Promise<ItineraryReading> {
  return apiFetch<ItineraryReading>('/api/itinerary/parse', {
    method: 'POST',
    body: JSON.stringify({ text, ...context }),
  })
}

export function readItineraryLink(
  url: string,
  context: ItineraryContext = {},
): Promise<ItineraryReading> {
  return apiFetch<ItineraryReading>('/api/itinerary/parse', {
    method: 'POST',
    body: JSON.stringify({ url, ...context }),
  })
}

/**
 * Sends the PDF itself rather than its text.
 *
 * No Content-Type is set: the browser has to add the multipart boundary, and a
 * hand-set header would leave it off and make the body unparseable on arrival.
 */
export function readItineraryPdf(
  file: File,
  context: ItineraryContext = {},
): Promise<ItineraryReading> {
  const body = new FormData()
  body.set('file', file)

  const query = new URLSearchParams()
  if (context.startDate) query.set('startDate', context.startDate)
  if (context.endDate) query.set('endDate', context.endDate)
  const suffix = query.toString()

  return apiFetch<ItineraryReading>(`/api/itinerary/parse${suffix ? `?${suffix}` : ''}`, {
    method: 'POST',
    body,
  })
}
