import { apiFetch } from '@/lib/api'
import type { ChecklistEntry } from '@shared/checklist'
import type { Trip, TripDay, TripInput, TripTemplate } from '@shared/trips'
import type { ItineraryProposal } from '@shared/itinerary'
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
): Promise<{ trip: Trip; generation: GenerationResult }> {
  return apiFetch<{ trip: Trip; generation: GenerationResult }>(`/api/trips/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

/** Last trip's answers, for "Plan again". Reads only — creates nothing. */
export function fetchTripTemplate(
  id: string,
): Promise<{ template: TripTemplate; from: { id: string; name: string } }> {
  return apiFetch(`/api/trips/${id}/duplicate`)
}

export function setTripStatus(id: string, status: Trip['status']): Promise<Trip> {
  return apiFetch<Trip>(`/api/trips/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  })
}

export function fetchChecklist(tripId: string): Promise<{ trip: Trip; entries: ChecklistEntry[] }> {
  return apiFetch<{ trip: Trip; entries: ChecklistEntry[] }>(`/api/trips/${tripId}/checklist`)
}

export interface EntryPatch {
  packedQty?: number
  qtyOverride?: number | null
  packingTiming?: string
  finalChecked?: boolean
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

export function excludeEntry(tripId: string, entryId: string): Promise<ChecklistEntry> {
  return apiFetch<ChecklistEntry>(`/api/trips/${tripId}/checklist/${entryId}/exclude`, {
    method: 'POST',
  })
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
  wearings: number
  unmetReason: string | null
  reason: string | null
  sortOrder: number
}

export interface OutfitGroup {
  id: string
  tripId: string
  name: string
  activityTag: string | null
  occurrences: number
  status: 'draft' | 'approved' | 'incomplete'
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
  favorite: boolean
  suitable: boolean
  reason: string | null
}

export function fetchOutfits(tripId: string): Promise<{ groups: OutfitGroup[] }> {
  return apiFetch<{ groups: OutfitGroup[] }>(`/api/trips/${tripId}/outfits`)
}

export function generateOutfits(
  tripId: string,
): Promise<{ groups: OutfitGroup[]; regenerated: boolean }> {
  return apiFetch<{ groups: OutfitGroup[]; regenerated: boolean }>(
    `/api/trips/${tripId}/outfits/generate`,
    { method: 'POST' },
  )
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
 * Declines the saved-outfit relationship an approval just created, keeping the
 * approval. Doc 04 §5: the lasting effect must be refusable on its own.
 */
export function forgetOutfitPairings(tripId: string, groupId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/api/trips/${tripId}/outfits/${groupId}/forget-pairings`,
    { method: 'POST' },
  )
}

export function fetchSwapOptions(
  tripId: string,
  groupId: string,
  slotId: string,
): Promise<{ candidates: SwapOption[] }> {
  return apiFetch<{ candidates: SwapOption[] }>(
    `/api/trips/${tripId}/outfits/${groupId}/slots/${slotId}/candidates`,
  )
}

export function setSlotItem(
  tripId: string,
  groupId: string,
  slotId: string,
  itemId: string | null,
): Promise<{ groups: OutfitGroup[]; sync: SyncResult }> {
  return apiFetch<{ groups: OutfitGroup[]; sync: SyncResult }>(
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

export interface DayPlan {
  date: string
  groupName: string | null
  wear: PlannedItem[]
  bring: PlannedItem[]
  missing: Array<{
    role: string
    roleLabel: string
    name: string
    alternatives: PlannedItem[]
  }>
}

export type WearAction = 'will_wear' | 'already_wore' | 'not_available' | 'too_warm' | 'too_cold'

export interface TodayResponse {
  trip: Trip
  date: string
  dates: string[]
  plan: DayPlan
  wearLog: Record<string, WearAction>
  actionLabels: Record<WearAction, string>
}

export function fetchToday(tripId: string, date?: string): Promise<TodayResponse> {
  const query = date ? `?date=${date}` : ''
  return apiFetch<TodayResponse>(`/api/trips/${tripId}/today${query}`)
}

export function fetchAlternatives(
  tripId: string,
  date: string,
  role: string,
): Promise<{ options: Array<{ itemId: string; name: string }> }> {
  return apiFetch<{ options: Array<{ itemId: string; name: string }> }>(
    `/api/trips/${tripId}/today/alternatives?date=${date}&role=${encodeURIComponent(role)}`,
  )
}

export interface TodayUpdate {
  date: string
  plan: DayPlan
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
  favorite: boolean
  role: string | null
  roleLabel: string | null
  reason: string
}

export interface LastLookResult {
  favourites: LastLookItem[]
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

export function saveTripDays(
  tripId: string,
  days: TripDay[],
): Promise<{ trip: Trip; replanned: boolean }> {
  return apiFetch<{ trip: Trip; replanned: boolean }>(`/api/trips/${tripId}/days`, {
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
