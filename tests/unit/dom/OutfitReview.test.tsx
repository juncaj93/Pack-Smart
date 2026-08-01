// @vitest-environment jsdom
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutfitReview from '@/routes/OutfitReview'
import type * as TripsNamespace from '@/lib/trips'

/** The module's own shape, for `importOriginal`. `import()` types are linted out. */
type TripsModule = typeof TripsNamespace

/**
 * The announcement regions have to exist BEFORE the first thing goes wrong.
 *
 * A live region inserted into the DOM already containing its text is not
 * reliably announced in Safari — the region has to exist first and then change.
 * The regions were originally rendered only in the loaded branch, behind an
 * early return that fires while the trip and the error are both null. So on the
 * very first failure the screen can produce — the load itself — the guard
 * flipped and the alert region arrived already full. Precisely the shape it
 * exists to avoid, on the earliest error there is.
 *
 * A DOM test, and deliberately not an end-to-end one. The first attempt WAS
 * end-to-end: it held the API requests open with `page.route` and asserted the
 * regions during the loading state. It passed against the bug. The service
 * worker serves those requests and `page.route` does not intercept it, so the
 * screen had quietly finished loading and the assertion was reading the happy
 * path — a test that could not fail, which is the exact mistake C1's review
 * caught once already. Here the promise genuinely never settles.
 */

vi.mock('@/lib/trips', async (importOriginal) => ({
  ...(await importOriginal<TripsModule>()),
  // Never settles. The screen stays in the state the defect lived in.
  fetchTrip: () => new Promise(() => {}),
  fetchOutfits: () => new Promise(() => {}),
  fetchChecklist: () => new Promise(() => {}),
  fetchWeather: () => new Promise(() => {}),
}))

afterEach(() => {
  document.body.classList.remove('is-locked')
  document.body.style.top = ''
})

function renderLoading() {
  return render(
    <MemoryRouter initialEntries={['/trips/t1/outfits/review']}>
      <Routes>
        <Route path="/trips/:id/outfits/review" element={<OutfitReview />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('the review screen while it is still loading', () => {
  it('already has both announcement regions', async () => {
    renderLoading()

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy())

    const alert = document.querySelector('[role="alert"]')
    const status = document.querySelector('[role="status"]')

    expect(alert, 'no alert region while loading — an error would arrive pre-filled').toBeTruthy()
    expect(status, 'no status region while loading').toBeTruthy()

    // Present AND empty. A region that already holds text is not a region that
    // changed, which is the whole of the guarantee.
    expect(alert?.textContent).toBe('')
    expect(status?.textContent).toBe('')
  })

  it('shows nothing it does not yet know', async () => {
    renderLoading()

    // No outfit, no summary, no invented state — just the screen and its regions.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy())
    expect(document.querySelector('.review-panel')).toBeNull()
    expect(document.querySelector('.review-summary-headline')).toBeNull()
  })
})
