import { apiFetch } from '@/lib/api'
import type { ChecklistEntry } from '@shared/checklist'
import type { Trip, TripInput } from '@shared/trips'

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
