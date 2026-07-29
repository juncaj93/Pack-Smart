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
): Promise<{ groups: OutfitGroup[]; sync: SyncResult; refused: boolean }> {
  return apiFetch<{ groups: OutfitGroup[]; sync: SyncResult; refused: boolean }>(
    `/api/trips/${tripId}/outfits/${groupId}/status`,
    { method: 'POST', body: JSON.stringify({ status }) },
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
