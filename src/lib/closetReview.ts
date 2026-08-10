import { apiFetch } from '@/lib/api'
import type { ReviewDecision, ReviewQueue, ReviewTopic } from '@shared/closet-review'
import type { Item } from '@shared/items'
import type { ItemTraits } from '@shared/bags'
import type { ProvenancedField, RefusedWrite } from '@shared/provenance'

/**
 * Review Closet Items, from the client's side (H1d).
 *
 * Every write here is a SINGLE answer — one rating, one confirmation, one
 * decision — because that is what the screen collects. Nothing sends a whole
 * garment back: a card that only knows a comfort score has no business
 * transmitting a category it never read, which is the defect H1a removed from
 * the importer and the reason `PATCH /api/items/:id` exists at all.
 */

export type {
  DuplicateCandidate,
  Disagreement,
  NameSuggestion,
  RatingAsk,
  ReviewCard,
  ReviewDecision,
  ReviewQueue,
  ReviewReason,
} from '@shared/closet-review'

export function fetchReviewQueue(): Promise<ReviewQueue> {
  return apiFetch<ReviewQueue>('/api/closet-review')
}

/** The fields one tap may move. Mirrors the Worker's `PATCHABLE` allowlist. */
export interface ItemPatch {
  comfort?: number | null
  versatility?: number | null
  dressinessContexts?: string[]
  displayName?: string
}

export interface PatchResponse {
  item: Item
  /** Empty at `user_confirmed`, and part of the contract regardless. */
  refused: RefusedWrite[]
}

export function patchItemFields(id: string, patch: ItemPatch): Promise<PatchResponse> {
  return apiFetch<PatchResponse>(`/api/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * One bag answer — its own door, because a trait is not a provenanced field.
 *
 * Nothing but Alex writes these, so there is no authority to arbitrate and no
 * `refused` to report back. The response is the row alone.
 */
export function patchItemTraits(
  id: string,
  traits: Partial<ItemTraits>,
): Promise<{ item: Item }> {
  return apiFetch<{ item: Item }>(`/api/items/${id}/traits`, {
    method: 'PATCH',
    body: JSON.stringify(traits),
  })
}

/** *Keep as is* — the value does not move, its authority does. */
export function confirmItemFields(id: string, fields: ProvenancedField[]): Promise<Item> {
  return apiFetch<Item>(`/api/items/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  })
}

/** *Use the value from my spreadsheet* — restores the value AND its source. */
export function revertItemField(id: string, field: ProvenancedField): Promise<Item> {
  return apiFetch<Item>(`/api/items/${id}/revert`, {
    method: 'POST',
    body: JSON.stringify({ field }),
  })
}

export function recordReviewDecision(
  itemId: string,
  topic: ReviewTopic,
  decision: ReviewDecision,
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/closet-review/decisions', {
    method: 'POST',
    body: JSON.stringify({ itemId, topic, decision }),
  })
}

export function reopenNotSure(): Promise<{ reopened: number }> {
  return apiFetch<{ reopened: number }>('/api/closet-review/reopen', { method: 'POST' })
}

/**
 * *Same item* — archives the copy Alex did not keep.
 *
 * Not a merge. Merging is H1e and is not proven safe, so this does the
 * strongest thing that is: the archived row survives, every trip and outfit
 * pointing at it still resolves, and Restore in My Stuff undoes it completely.
 */
export function archiveDuplicate(
  keepItemId: string,
  archiveItemId: string,
): Promise<{ archived: Item }> {
  return apiFetch<{ archived: Item }>('/api/closet-review/archive-duplicate', {
    method: 'POST',
    body: JSON.stringify({ keepItemId, archiveItemId }),
  })
}
