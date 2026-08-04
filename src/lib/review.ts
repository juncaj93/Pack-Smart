import { apiFetch } from '@/lib/api'
import type { ReviewAnswerKind, ReviewObservations, ReviewProposal } from '@shared/review'

/**
 * The post-trip review's client half (F1).
 *
 * Every call answers with the WHOLE view rather than with what it changed. That
 * is deliberate: a proposal's text depends on the rules as they are now, so
 * accepting one can change what another one says — accept *pack one spare* and
 * the *too many* proposal for the same item has a different step to offer. A
 * screen patching its own state from a narrow response would keep showing the
 * old sentence.
 */

export interface ReviewChoice {
  id: string
  name: string
  category: string | null
}

export interface Review {
  tripId: string
  tripName: string
  startDate: string
  endDate: string
  reviewedAt: number | null
  /** What the app already saw, in sentences. Never a question. */
  summary: string[]
  observations: ReviewObservations
  proposals: ReviewProposal[]
  outstanding: number
  choices: {
    packed: ReviewChoice[]
    notPacked: ReviewChoice[]
    outfits: ReviewChoice[]
  }
}

export interface NewReviewAnswer {
  kind: ReviewAnswerKind
  itemId?: string
  outfitGroupId?: string
  note?: string
}

export function fetchReview(tripId: string): Promise<Review> {
  return apiFetch<Review>(`/api/trips/${tripId}/review`)
}

export function addReviewAnswer(tripId: string, answer: NewReviewAnswer): Promise<Review> {
  return apiFetch<Review>(`/api/trips/${tripId}/review/answers`, {
    method: 'POST',
    body: JSON.stringify(answer),
  })
}

/** Accepting is the explicit act that changes a rule; declining changes nothing. */
export function resolveReviewAnswer(
  tripId: string,
  answerId: string,
  resolution: 'accepted' | 'declined',
): Promise<Review> {
  return apiFetch<Review>(`/api/trips/${tripId}/review/answers/${answerId}`, {
    method: 'PATCH',
    body: JSON.stringify({ resolution }),
  })
}

export function removeReviewAnswer(tripId: string, answerId: string): Promise<Review> {
  return apiFetch<Review>(`/api/trips/${tripId}/review/answers/${answerId}`, { method: 'DELETE' })
}

export function finishReview(tripId: string): Promise<Review> {
  return apiFetch<Review>(`/api/trips/${tripId}/review/finish`, { method: 'POST' })
}
