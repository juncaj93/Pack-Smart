import type { Readiness } from '@shared/readiness'

/**
 * Turns the readiness model's named destination into a path.
 *
 * The model names WHERE to go and never builds a URL, so routing stays a
 * concern of the screens and a renamed route breaks in one place rather than in
 * whichever screens happened to hardcode it.
 *
 * Lifted out of `Home.tsx` when the outfit review became the third screen to
 * show the one recommended action. Two copies of this switch is how a renamed
 * route starts working from Home and stops working from the review.
 */
export function routeFor(
  tripId: string,
  route: NonNullable<Readiness['next']>['route'],
): string {
  switch (route) {
    case 'today':
      return `/trips/${tripId}/today`
    case 'day_of':
      return `/trips/${tripId}/day-of`
    case 'outfits':
      return `/trips/${tripId}/outfits`
    // The checklist and the questions both live on the trip screen today. Named
    // separately all the same: they are different intentions, and the day the
    // trip screen splits, this is the only thing that has to change.
    case 'checklist':
    case 'setup':
    case 'trip':
    default:
      return `/trips/${tripId}`
  }
}
