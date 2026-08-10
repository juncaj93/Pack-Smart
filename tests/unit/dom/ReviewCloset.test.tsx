// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNRECORDED_TRAITS, type Item } from '@shared/items'
import type { ReviewCard, ReviewQueue } from '@shared/closet-review'
import type * as ClosetReviewNamespace from '@/lib/closetReview'
import { fetchReviewQueue } from '@/lib/closetReview'
import ReviewCloset from '@/routes/ReviewCloset'

/**
 * Rating a garment must not wait for the database (H1d, on P1A's rules).
 *
 * These are the TIMING tests, and every write below is held open deliberately
 * and released by the test — nothing waits on a clock. They exist because
 * "tapping a star feels instant" is not something a screenshot can show and not
 * something a passing save proves: the failure mode is a reply that arrives
 * after Alex has moved on and quietly puts the old value back, which looks
 * exactly like working software until it does not.
 *
 * The extra case this file has over `useSlotChoice.test.tsx` is **cross-field**:
 * comfort, versatility and dressiness are three independent answers about one
 * garment, so a slow comfort reply must not disturb a versatility rating given
 * after it — through the SUCCESS path, not just the stale one.
 */

const patches: Array<{
  itemId: string
  patch: Record<string, unknown>
  resolve: (item: Item) => void
  reject: () => void
}> = []

const decisions: Array<{ itemId: string; topic: string; decision: string }> = []

/** The bag answers sent, each held open so the test decides when it settles. */
const traitPatches: Array<{
  itemId: string
  traits: Record<string, unknown>
  resolve: (item: Item) => void
  reject: () => void
}> = []

vi.mock('@/lib/closetReview', async (importOriginal) => ({
  ...(await importOriginal<typeof ClosetReviewNamespace>()),
  fetchReviewQueue: vi.fn(() => Promise.resolve(queueFixture())),
  patchItemFields: vi.fn(
    (itemId: string, patch: Record<string, unknown>) =>
      new Promise((resolve, reject) => {
        patches.push({
          itemId,
          patch,
          resolve: (item) => resolve({ item, refused: [] }),
          reject: () => reject(new Error('offline')),
        })
      }),
  ),
  patchItemTraits: vi.fn(
    (itemId: string, traits: Record<string, unknown>) =>
      new Promise((resolve, reject) => {
        traitPatches.push({
          itemId,
          traits,
          resolve: (item) => resolve({ item }),
          reject: () => reject(new Error('offline')),
        })
      }),
  ),
  recordReviewDecision: vi.fn((itemId: string, topic: string, decision: string) => {
    decisions.push({ itemId, topic, decision })
    // Deliberately never settles: advancing must not depend on it.
    return new Promise(() => {})
  }),
}))

function garment(id: string, partial: Partial<Item> = {}): Item {
  return {
    id,
    kind: 'clothing',
    displayName: id,
    category: 'Tops & Outerwear',
    subcategory: 'T-Shirt',
    color: null,
    pattern: null,
    brand: null,
    notes: null,
    usageFrequency: 'sometimes',
    warmth: null,
    dressiness: 1,
    dressinessContexts: [],
    weatherTags: [],
    typicalUses: [],
    reuseCapacity: null,
    ownedQuantity: null,
    comfort: null,
    versatility: null,
    ...UNRECORDED_TRAITS,
    isCritical: false,
    requiresFinalCheck: false,
    defaultPackingTiming: 'anytime',
    alwaysInclude: false,
    neverInclude: false,
    archivedAt: null,
    source: 'manual',
    fieldProvenance: {},
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

function card(item: Item, partial: Partial<ReviewCard> = {}): ReviewCard {
  return {
    item,
    reason: 'no_comfort',
    why: 'Pack Smart has no idea how comfortable this is.',
    asks: ['comfort', 'versatility', 'contexts'],
    nameSuggestion: null,
    duplicate: null,
    disagreements: [],
    bagQuestions: [],
    skipped: false,
    ...partial,
  }
}

/** A card whose question is a possible duplicate, not a rating. */
function duplicateCard(): ReviewCard {
  return {
    ...card(garment('grey-tee-a', { displayName: 'Grey Tee', brand: 'Uniqlo', comfort: 3, versatility: 3 })),
    reason: 'possible_duplicate',
    why: 'Same name and brand, and the colours overlap — this may be one thing or two.',
    asks: [],
    duplicate: {
      itemId: 'grey-tee-b',
      displayName: 'Grey Tee',
      detail: 'Uniqlo · Black',
      packedTrips: 5,
      otherPackedTrips: 0,
      why: 'Same name and brand, and the colours overlap — this may be one thing or two.',
    },
  }
}

function queueFixture(): ReviewQueue {
  return {
    cards: [
      card(garment('linen-shirt', { displayName: 'Linen Shirt' })),
      card(garment('rust-tee', { displayName: 'Rust Tee' })),
    ],
    notSure: 0,
  }
}

/** The nth star of a rating group, by the sentence it carries. */
function star(group: 'Comfort' | 'Versatility', rating: number) {
  const meanings: Record<string, string[]> = {
    Comfort: [
      'Uncomfortable',
      'Limited comfort',
      'Comfortable',
      'Very comfortable',
      'One of my most comfortable items',
    ],
    Versatility: [
      'Very specific use',
      'Limited situations',
      'Works in several situations',
      'Highly versatile',
      'Works almost anywhere appropriate for this item type',
    ],
  }
  return screen.getByRole('radio', {
    name: `${rating} of 5 — ${meanings[group]![rating - 1]}`,
  })
}

/** What the card currently says the chosen rating MEANS, in Alex's own words. */
function meaning(group: 'Comfort' | 'Versatility'): string {
  const label = screen.getByText(group, { selector: '.rating-label' })
  const control = label.closest('.rating-choice')!
  return control.querySelector('.rating-meaning')!.textContent ?? ''
}

async function open() {
  render(
    <MemoryRouter>
      <ReviewCloset />
    </MemoryRouter>,
  )
  await screen.findByText('Linen Shirt')
}

beforeEach(() => {
  patches.length = 0
  decisions.length = 0
  traitPatches.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

/* ------------------------------------------------------------------ */

describe('a rating shows before it is saved', () => {
  it('selects the star in the same tick as the tap, with nothing resolved', async () => {
    await open()

    /*
     * `fireEvent` inside `act` rather than `userEvent.click`, deliberately.
     *
     * `userEvent` awaits between its steps, so an assertion after it cannot
     * tell "immediate" from "one microtask later" — and one microtask is all a
     * naive `await save()` needs to look instant in a test while blocking on a
     * real network. This asserts SYNCHRONOUSLY after the event, which is a
     * claim about the architecture rather than about the clock.
     */
    act(() => {
      fireEvent.click(star('Comfort', 4))
    })

    expect(meaning('Comfort')).toBe('Very comfortable')
    expect(star('Comfort', 4)).toHaveAttribute('aria-checked', 'true')
    // The write has been started and has NOT come back.
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({ itemId: 'linen-shirt', patch: { comfort: 4 } })
  })

  it('moves to the next garment without waiting for the write', async () => {
    await open()
    act(() => {
      fireEvent.click(star('Comfort', 5))
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    })

    expect(screen.getByText('Rust Tee')).toBeInTheDocument()
    expect(patches).toHaveLength(1)
  })

  it('records a skip and advances without waiting for it either', async () => {
    await open()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    })

    expect(screen.getByText('Rust Tee')).toBeInTheDocument()
    expect(decisions).toEqual([
      { itemId: 'linen-shirt', topic: 'ratings', decision: 'skipped' },
    ])
  })

  it('withdraws the card entirely on Not sure', async () => {
    await open()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Not sure' }))
    })

    // Dropped, not advanced past — so the next card takes its index.
    expect(screen.getByText('Rust Tee')).toBeInTheDocument()
    expect(screen.getByText('1 of 1')).toBeInTheDocument()
    expect(decisions[0]?.decision).toBe('not_sure')
  })
})

describe('latest intent wins, per garment and per field', () => {
  it('settles two rapid taps on the second, whichever reply lands first', async () => {
    await open()
    act(() => {
      fireEvent.click(star('Comfort', 2))
    })
    act(() => {
      fireEvent.click(star('Comfort', 5))
    })

    /*
     * The FIRST write finishes last, and must change nothing.
     *
     * Flushed and asserted SYNCHRONOUSLY. `waitFor` would succeed on its first
     * check — before the late reply had been applied — so it passes whether or
     * not the guard exists. Mutation caught exactly that on P1A's own test.
     */
    await act(async () => {
      patches[0]!.resolve(garment('linen-shirt', { comfort: 2 }))
    })
    expect(meaning('Comfort')).toBe('One of my most comfortable items')

    await act(async () => {
      patches[1]!.resolve(garment('linen-shirt', { comfort: 5 }))
    })
    expect(meaning('Comfort')).toBe('One of my most comfortable items')
  })

  /**
   * The cross-field case, and the one this screen has that the picker does not.
   *
   * The server's reply to the comfort write carries the WHOLE garment as it was
   * before the versatility tap. Applying all of it — the obvious `settle` —
   * would silently undo a rating Alex gave a second earlier, through the
   * success path, with no stale reply and no failure anywhere.
   */
  it('does not let a comfort reply undo a versatility rating given after it', async () => {
    await open()
    act(() => {
      fireEvent.click(star('Comfort', 3))
    })
    act(() => {
      fireEvent.click(star('Versatility', 4))
    })

    await act(async () => {
      // The server's answer to the COMFORT write: versatility is still unrated.
      patches[0]!.resolve(garment('linen-shirt', { comfort: 3, versatility: null }))
    })

    expect(meaning('Comfort')).toBe('Comfortable')
    expect(meaning('Versatility')).toBe('Highly versatile')
  })

  it('rolls back only the field that failed', async () => {
    await open()
    act(() => {
      fireEvent.click(star('Comfort', 3))
    })
    act(() => {
      fireEvent.click(star('Versatility', 4))
    })

    await act(async () => {
      patches[0]!.reject()
    })

    expect(meaning('Comfort')).toBe('Not rated')
    // Untouched, because the failure was comfort's and comfort's alone.
    expect(meaning('Versatility')).toBe('Highly versatile')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save that rating.')
  })

  it('does not let a late failure roll back a newer success', async () => {
    await open()
    act(() => {
      fireEvent.click(star('Comfort', 2))
    })
    act(() => {
      fireEvent.click(star('Comfort', 5))
    })

    // The FIRST write fails, after 5 was chosen. Undoing to "Not rated" would
    // discard something Alex did afterwards.
    await act(async () => {
      patches[0]!.reject()
    })

    expect(meaning('Comfort')).toBe('One of my most comfortable items')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps each garment on its own timeline', async () => {
    await open()
    act(() => {
      fireEvent.click(star('Comfort', 2))
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    })
    act(() => {
      fireEvent.click(star('Comfort', 5))
    })

    // The first garment's write fails while the second garment is on screen.
    // A shared ticket would have dropped it as stale; a shared ROLLBACK would
    // have undone the wrong garment's rating.
    await act(async () => {
      patches[0]!.reject()
    })

    expect(meaning('Comfort')).toBe('One of my most comfortable items')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save that rating.')
  })

  it('clears a rating, and a clear is just another write', async () => {
    await open()
    act(() => {
      fireEvent.click(star('Comfort', 4))
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear rating' }))
    })

    // The screen is already clear, with only the FIRST write out.
    expect(meaning('Comfort')).toBe('Not rated')
    expect(patches).toHaveLength(1)

    // The set's reply lands after the clear. It must not put the rating back —
    // and the clear goes out behind it.
    await act(async () => {
      patches[0]!.resolve(garment('linen-shirt', { comfort: 4 }))
    })
    expect(meaning('Comfort')).toBe('Not rated')
    expect(patches[1]?.patch).toEqual({ comfort: null })
  })

  /**
   * The defect a slow network found, and the reason writes are serialised.
   *
   * Measured in a real browser with every rating write held for 1500 ms:
   * ticking two dressiness contexts in quick succession put both requests in
   * flight, they completed OUT OF ORDER, and the older one landed last — the
   * card said `Loungewear, Casual, Smart casual` and the row said
   * `Loungewear, Casual`. The ticket guard protected the screen and nothing
   * protected the database.
   *
   * So one key has at most one request out, and a newer edit replaces whatever
   * was waiting. Three taps become two requests, and the LAST request carries
   * the LAST value, which is the only property that makes the row agree with
   * the screen.
   */
  it('keeps one request per field in flight, and sends the newest value last', async () => {
    await open()
    act(() => {
      fireEvent.click(star('Comfort', 1))
    })
    act(() => {
      fireEvent.click(star('Comfort', 3))
    })
    act(() => {
      fireEvent.click(star('Comfort', 4))
    })

    // One request, holding the first value. The screen is already on the third.
    expect(patches.map((p) => p.patch)).toEqual([{ comfort: 1 }])
    expect(meaning('Comfort')).toBe('Very comfortable')

    await act(async () => {
      patches[0]!.resolve(garment('linen-shirt', { comfort: 1 }))
    })

    /*
     * The middle tap never becomes a request — it was superseded before it
     * could be sent, and every write here is absolute rather than a delta, so
     * skipping it loses nothing. What matters is that the request that DID go
     * out carries 4.
     */
    expect(patches.map((p) => p.patch)).toEqual([{ comfort: 1 }, { comfort: 4 }])
  })

  it('does not make one field wait behind another', async () => {
    await open()
    act(() => {
      fireEvent.click(star('Comfort', 1))
    })
    act(() => {
      fireEvent.click(star('Versatility', 2))
    })

    // Different keys, different timelines: versatility does not queue behind
    // comfort, because they cannot overwrite each other.
    expect(patches.map((p) => p.patch)).toEqual([{ comfort: 1 }, { versatility: 2 }])
  })
})

describe('the dressiness contexts, on the same rules', () => {
  it('shows a ticked context before the write resolves, and keeps several', async () => {
    await open()
    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Smart casual' }))
    })
    expect(screen.getByRole('checkbox', { name: 'Smart casual' })).toBeChecked()

    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Dressy' }))
    })
    expect(screen.getByRole('checkbox', { name: 'Smart casual' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Dressy' })).toBeChecked()

    // One request out, holding the first tick.
    expect(patches.map((p) => p.patch)).toEqual([{ dressinessContexts: ['smart_casual'] }])

    /*
     * A late reply for the FIRST tick must not collapse the pair back to one —
     * and the second tick's request, carrying BOTH contexts, goes out behind
     * it. This is the exact sequence that lost a tick against a slow network
     * before writes were serialised.
     */
    await act(async () => {
      patches[0]!.resolve(garment('linen-shirt', { dressinessContexts: ['smart_casual'] }))
    })
    expect(screen.getByRole('checkbox', { name: 'Dressy' })).toBeChecked()
    expect(patches[1]?.patch).toEqual({ dressinessContexts: ['smart_casual', 'dressy'] })
  })
})

describe('reaching the end', () => {
  it('offers the way back once every card is behind him', async () => {
    await open()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    })

    await waitFor(() => expect(screen.getByText('That is everything for now')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Back to My Stuff' })).toBeInTheDocument()
  })
})


/* ------------------------------------------------------------------ */

describe('a card whose question is not a rating', () => {
  beforeEach(() => {
    vi.mocked(fetchReviewQueue).mockResolvedValueOnce({
      cards: [duplicateCard()],
      notSure: 0,
    })
  })

  /**
   * Skip and Not sure have to be about the question the card ASKED.
   *
   * The first version chose the topic from whether the card carried ratings, so
   * *Not sure* on a duplicate withdrew the NAME question — suppressing
   * something Alex was never asked, and leaving the thing he could not answer
   * in the queue. Both halves wrong, from one convenient guess.
   */
  it('records Not sure against the duplicate, not against the name', async () => {
    render(
      <MemoryRouter>
        <ReviewCloset />
      </MemoryRouter>,
    )
    await screen.findByText('Grey Tee', { selector: '.review-name' })

    act(() => {
      // The card-level control, scoped away from the duplicate block's own.
      fireEvent.click(
        within(document.querySelector('.review-actions')!).getByRole('button', {
          name: 'Not sure',
        }),
      )
    })

    expect(decisions).toEqual([
      { itemId: 'grey-tee-a', topic: 'duplicate:grey-tee-b', decision: 'not_sure' },
    ])
  })

  /**
   * Two buttons reading "Keep this one" are ONE button as far as a screen
   * reader's control list is concerned — on the one card where the two things
   * genuinely might be identical. The label has to carry what separates them.
   */
  it('names each Keep this one by what actually tells the two apart', async () => {
    render(
      <MemoryRouter>
        <ReviewCloset />
      </MemoryRouter>,
    )
    await screen.findByText('Grey Tee', { selector: '.review-name' })

    const keeps = screen.getAllByRole('button', { name: /^Keep Grey Tee/ })
    expect(keeps).toHaveLength(2)
    const names = keeps.map((button) => button.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(2)
    expect(names[0]).toContain('packed on 5 trips')
    expect(names[1]).toContain('never packed')
  })

  /** *Not sure* about a duplicate is recorded, never merely dismissed. */
  it('does not silently drop a duplicate question it could not answer', async () => {
    render(
      <MemoryRouter>
        <ReviewCloset />
      </MemoryRouter>,
    )
    await screen.findByText('Grey Tee', { selector: '.review-name' })

    act(() => {
      // The one inside the duplicate block, not the card-level control.
      fireEvent.click(
        screen.getByRole('button', { name: 'Not sure whether these are the same item' }),
      )
    })

    expect(decisions).toEqual([
      { itemId: 'grey-tee-a', topic: 'duplicate:grey-tee-b', decision: 'not_sure' },
    ])
  })
})

/* ------------------------------------------------------------------ */

/**
 * A bag question, which is the one kind of card whose answer Pack Smart is
 * about to act on (P3b).
 *
 * The timing argument is the same as it is for a star and matters slightly
 * more: two bag questions can sit on one card, so an answer to the first must
 * not disturb the second while its write is still in flight — and a failed
 * write has to put the QUESTION back rather than merely restoring a value,
 * because a question whose answer did not save has not been answered.
 */
describe('answering a bag question', () => {
  function bagCard(): ReviewCard {
    return {
      ...card(garment('shampoo', { displayName: 'Shampoo', category: 'Toiletries', kind: 'gear' })),
      reason: 'bag_question',
      why: 'You are flying on Lisbon, and this decides whether it can go in your cabin bag.',
      asks: [],
      bagQuestions: [
        {
          key: 'liquid',
          prompt: 'Is this a full-size liquid?',
          because: 'You are flying on Lisbon, and this decides whether it can go in your cabin bag.',
          answers: [
            { label: 'Yes, full size', traits: { liquid: true, liquidSize: 'full' } },
            { label: 'No, travel size', traits: { liquid: true, liquidSize: 'cabin' } },
            { label: 'Not a liquid', traits: { liquid: false, liquidSize: null } },
          ],
        },
        {
          key: 'fragile',
          prompt: 'Is this breakable?',
          because: 'This decides whether Lisbon keeps it with you or packs it below.',
          answers: [
            { label: 'Yes', traits: { fragile: true } },
            { label: 'No', traits: { fragile: false } },
          ],
        },
      ],
    }
  }

  beforeEach(() => {
    vi.mocked(fetchReviewQueue).mockResolvedValueOnce({ cards: [bagCard()], notSure: 0 })
  })

  it('shows the question and why it is being asked now', async () => {
    render(
      <MemoryRouter>
        <ReviewCloset />
      </MemoryRouter>,
    )
    await screen.findByText('Shampoo', { selector: '.review-name' })

    expect(screen.getByText('Is this a full-size liquid?')).toBeInTheDocument()
    // It names the trip. A question that cannot say which trip it is about
    // should not have passed the gate that produced it.
    expect(screen.getAllByText(/Lisbon/).length).toBeGreaterThan(0)
  })

  it('takes the answered question off the card without waiting for the write', async () => {
    render(
      <MemoryRouter>
        <ReviewCloset />
      </MemoryRouter>,
    )
    await screen.findByText('Shampoo', { selector: '.review-name' })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, full size — Is this a full-size liquid?' }))
    })

    // Gone immediately, with nothing settled.
    expect(screen.queryByText('Is this a full-size liquid?')).not.toBeInTheDocument()
    // And the OTHER question is untouched, which is the cross-question case.
    expect(screen.getByText('Is this breakable?')).toBeInTheDocument()
    expect(traitPatches).toHaveLength(1)
    expect(traitPatches[0]).toMatchObject({
      itemId: 'shampoo',
      traits: { liquid: true, liquidSize: 'full' },
    })
  })

  it('puts the question back when the answer could not be saved', async () => {
    render(
      <MemoryRouter>
        <ReviewCloset />
      </MemoryRouter>,
    )
    await screen.findByText('Shampoo', { selector: '.review-name' })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes — Is this breakable?' }))
    })
    expect(screen.queryByText('Is this breakable?')).not.toBeInTheDocument()

    await act(async () => {
      traitPatches[0]!.reject()
    })

    await waitFor(() => {
      expect(screen.getByText('Is this breakable?')).toBeInTheDocument()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save that answer.')
  })

  it('records Not sure against that question alone', async () => {
    render(
      <MemoryRouter>
        <ReviewCloset />
      </MemoryRouter>,
    )
    await screen.findByText('Shampoo', { selector: '.review-name' })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Not sure — Is this a full-size liquid?' }))
    })

    /*
     * `bag:liquid`, not `ratings` and not the card. Saying "I do not know
     * whether that bottle is full-size" says nothing at all about whether the
     * same bottle is breakable, and the question below it is still on screen.
     */
    expect(decisions).toEqual([
      { itemId: 'shampoo', topic: 'bag:liquid', decision: 'not_sure' },
    ])
    expect(screen.getByText('Is this breakable?')).toBeInTheDocument()
  })
})

/**
 * Going back to the garment just reviewed.
 *
 * The motivating complaint: answer a card, the queue advances, and the thing you
 * wanted to change is behind a wall. What it must NOT become is an undo — every
 * answer here is written the moment it is tapped, which is why the primary
 * action says *Next* rather than *Save*, so stepping backwards has to show Alex
 * what he saved rather than take it away.
 *
 * Those are two different failures and both are silent. A Back that reverted
 * would quietly discard a rating; a Back that re-fetched would reorder the queue
 * underneath him. Neither shows up as an error.
 */
describe('going back through the queue', () => {
  it('offers no way back from the first card, because there is nowhere to go', async () => {
    await open()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('returns to the previous garment', async () => {
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Rust Tee')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Linen Shirt')).toBeTruthy()
    expect(screen.getByText('1 of 2')).toBeTruthy()
  })

  /* The load-bearing one: Back is navigation, not undo. */
  it('shows the rating he saved, rather than clearing it', async () => {
    await open()

    fireEvent.click(star('Comfort', 4))
    act(() => patches[0]!.resolve(garment('linen-shirt', { displayName: 'Linen Shirt', comfort: 4 })))
    await waitFor(() => expect(meaning('Comfort')).toBe('Very comfortable'))

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Rust Tee')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await screen.findByText('Linen Shirt')
    expect(meaning('Comfort')).toBe('Very comfortable')
    // And nothing was written to get back here — Back is a local move.
    expect(patches.length).toBe(1)
  })

  /*
   * No refetch, so nothing can reorder underneath him. The queue is ordered by
   * what Pack Smart most wants to know, and a reload between two cards could
   * legitimately return a different order — which would make Back land on a
   * garment he has never seen.
   */
  it('does not reload the queue to go back', async () => {
    await open()
    const loadsAfterOpen = vi.mocked(fetchReviewQueue).mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(vi.mocked(fetchReviewQueue).mock.calls.length).toBe(loadsAfterOpen)
    expect(screen.getByText('Linen Shirt')).toBeTruthy()
  })

  it('comes back from the finished screen to the last card answered', async () => {
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('That is everything for now')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the last one' }))
    expect(screen.getByText('Rust Tee')).toBeTruthy()
  })

  /*
   * Skip records a preference about the QUESTION and advances, so going back
   * after one lands on the skipped card with its answers intact. It must not
   * un-skip: the decision is Alex's and it is already recorded.
   */
  it('goes back over a skipped card without unrecording the skip', async () => {
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await screen.findByText('Rust Tee')
    expect(decisions).toEqual([{ itemId: 'linen-shirt', topic: 'ratings', decision: 'skipped' }])

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Linen Shirt')).toBeTruthy()
    expect(decisions.length).toBe(1)
  })

  /*
   * *Not sure* is different in kind — it REMOVES the card from the queue rather
   * than advancing past it, so the count drops and there is no longer a card
   * behind the current one to go back to. Back has to follow the queue as it
   * now is, not as it was.
   */
  it('follows the queue after Not sure removes a card from it', async () => {
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'Not sure' }))
    await screen.findByText('Rust Tee')
    expect(screen.getByText('1 of 1')).toBeTruthy()

    // Index 0 of a one-card queue: nowhere behind it, and no Back offered.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })
})
