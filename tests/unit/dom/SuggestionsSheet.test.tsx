// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuggestionsSheet } from '@/routes/Settings'
import type { OverrideProposal } from '@shared/learning'
import type * as SettingsNamespace from '@/lib/settings'

/** The module's own shape, for `importOriginal`. `import()` types are linted out. */
type SettingsModule = typeof SettingsNamespace

/**
 * The learning sheet's contract for a repeated correction (P4c).
 *
 * ## Why this is a DOM test and not an e2e one
 *
 * It was an e2e spec first, and it was a shared-state hazard. Producing three
 * trips of evidence means creating a garment with a rule, and a `packing_rule`
 * is not scoped to a trip — so for as long as the spec ran, that item was on the
 * list of every trip every OTHER spec created, in a `fullyParallel` suite. It
 * made two unrelated specs fail on counts, which is exactly the interference
 * class `fixtures.ts` was written to end.
 *
 * The endpoint behaviour — three trips, consistency, what accepting writes, what
 * declining silences — is proved against real SQL in
 * `tests/integration/learning-corrections.test.ts`, where the database holds
 * nothing but what the test made. What is left is the SHEET's contract, and that
 * is a question about a component: three answers rather than one, and a decline
 * that actually removes the card.
 */

const api = vi.hoisted(() => ({
  suggestions: {
    removals: [] as unknown[],
    unworn: [] as unknown[],
    corrections: [] as unknown[],
    setAside: false,
  },
  calls: [] as Array<{ what: string; with: unknown }>,
}))

const proposal: OverrideProposal = {
  subject: 'item-1',
  topic: 'bag:personal_item',
  itemId: 'item-1',
  itemName: 'Sunglasses',
  trips: 3,
  message: 'You put Sunglasses in your personal bag on 3 trips.',
  effect: 'Suggest that bag from now on. A bag you choose on a trip still wins.',
  change: { kind: 'default_bag', itemId: 'item-1', to: 'personal_item' },
}

vi.mock('@/lib/settings', async (importOriginal) => {
  const actual = await importOriginal<SettingsModule>()
  return {
    ...actual,
    fetchSuggestions: () => Promise.resolve(api.suggestions),
    acceptCorrection: (change: unknown) => {
      api.calls.push({ what: 'accept', with: change })
      api.suggestions = { ...api.suggestions, corrections: [] }
      return Promise.resolve(api.suggestions)
    },
    decideCorrection: (subject: string, topic: string, decision: string) => {
      api.calls.push({ what: 'decide', with: { subject, topic, decision } })
      api.suggestions = {
        ...api.suggestions,
        corrections: [],
        setAside: decision === 'not_sure',
      }
      return Promise.resolve(api.suggestions)
    },
    restoreSetAside: () => {
      api.calls.push({ what: 'restore', with: null })
      api.suggestions = { ...api.suggestions, corrections: [proposal], setAside: false }
      return Promise.resolve(api.suggestions)
    },
  }
})

beforeEach(() => {
  api.suggestions = { removals: [], unworn: [], corrections: [proposal], setAside: false }
  api.calls = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

/*
 * The sheet alone, rather than the whole Settings route.
 *
 * `Settings` is a route: it calls `useNavigate` and fetches amounts and rules on
 * mount, none of which this file is about. Rendering the sheet directly keeps
 * the test to the one component whose contract is under test, and is why
 * `SuggestionsSheet` is exported.
 */
async function openSheet() {
  render(<SuggestionsSheet open onClose={() => {}} />)
  return await screen.findByText(proposal.message)
}

describe('a repeated correction in the learning sheet', () => {
  /*
   * Three answers, not one. A suggestion with only a yes is a suggestion that
   * comes back forever, which is what this slice existed to fix.
   */
  it('offers yes, no and not now', async () => {
    await openSheet()

    expect(screen.getByRole('button', { name: 'Remember it' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
  })

  it('says what it saw and what accepting would do, before he does it', async () => {
    await openSheet()

    expect(screen.getByText(proposal.message)).toBeInTheDocument()
    expect(screen.getByText(proposal.effect)).toBeInTheDocument()
  })

  it('sends the proposal it showed, rather than re-deriving one', async () => {
    await openSheet()
    await userEvent.click(screen.getByRole('button', { name: 'Remember it' }))

    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0]).toEqual({ what: 'accept', with: proposal.change })
  })

  it('removes a declined suggestion from the sheet', async () => {
    await openSheet()
    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }))

    await waitFor(() => expect(screen.queryByText(proposal.message)).not.toBeInTheDocument())
    expect(api.calls[0]).toEqual({
      what: 'decide',
      with: { subject: proposal.subject, topic: proposal.topic, decision: 'declined' },
    })
  })

  /*
   * A question put off has to be findable rather than lost — the same escape
   * hatch Review Closet Items gives `Not sure`.
   */
  it('offers a way back to anything set aside, and only then', async () => {
    await openSheet()
    expect(screen.queryByRole('button', { name: 'Show what I set aside' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    const back = await screen.findByRole('button', { name: 'Show what I set aside' })

    await userEvent.click(back)
    expect(await screen.findByText(proposal.message)).toBeInTheDocument()
  })

  /* Nothing noticed is the normal state and says so plainly (doc 02 §11). */
  it('says so plainly when there is nothing to offer', async () => {
    api.suggestions = { removals: [], unworn: [], corrections: [], setAside: false }
    render(<SuggestionsSheet open onClose={() => {}} />)

    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument()
  })
})
