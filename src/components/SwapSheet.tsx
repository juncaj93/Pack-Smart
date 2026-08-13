import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/BottomSheet'
import { ColorDots } from '@/components/ColorDots'
import {
  fetchSwapOptions,
  type SwapContext,
  type SwapOption,
} from '@/lib/trips'
import { storedSpelling } from '@shared/items'
import { SearchInput } from '@/components/SearchInput'
import './SwapSheet.css'

/** The one slot being filled. Ids, so a screen without the outfit loaded can ask. */
export interface SwapTarget {
  groupId: string
  slotId: string
  roleLabel: string
  /** What is in the slot now, so it can be marked Current. */
  itemId: string | null
}

interface SwapSheetProps {
  open: boolean
  tripId: string
  target: SwapTarget | null
  onClose: () => void
  /**
   * Applied at once, before anything is persisted (P1A).
   *
   * Synchronous and returning nothing, which is the point: the sheet hands the
   * choice over and closes, and whoever owns the outfit state decides what to
   * show and when to reconcile. The sheet used to await the write and close only
   * on the reply, which made every pick cost a full round trip.
   */
  onChoose: (itemId: string | null, option: SwapOption | null) => void
}

/**
 * Which part of the wardrobe the list is showing (G3).
 *
 * `slot` is the recommendation and the garments around it; `all` is everything
 * Alex owns. Two chips rather than a disclosure arrow because the second one is
 * a real destination — "my jacket is not in this list" is the complaint that
 * produced this slice, and the answer has to be visible before he starts
 * doubting the list rather than hidden behind an affordance he has to find.
 */
type Scope = 'slot' | 'all'

const SCOPES: Array<{ key: Scope; label: string }> = [
  { key: 'slot', label: 'Recommended' },
  { key: 'all', label: 'All items' },
]

/**
 * One Swap action for every slot.
 *
 * Product doc 04 §7 asks for a single Swap rather than a control per garment
 * type. Unsuitable garments are listed too, below a divider and labelled with
 * why — the app's job is to say a linen shirt is wrong for the cold, not to make
 * it unchoosable. Alex knows things about his trip that the app does not.
 *
 * G3 finishes that thought. Until now the list held only the one kind of garment
 * the slot maps to, so replacing a `Layer` could not reach a jacket by any path:
 * not by scrolling, not by searching, not at all. The whole active wardrobe now
 * arrives in the same response, the recommendation still comes first, and
 * everything else is one chip away with a sentence saying what it is.
 *
 * Takes ids rather than the loaded outfit so the packing list can open it too:
 * doc 04 §8 offers a replacement at the moment a garment leaves the list, and
 * that screen has a slot id and no outfits in hand.
 */
export function SwapSheet({ open, tripId, target, onClose, onChoose }: SwapSheetProps) {
  const [options, setOptions] = useState<SwapOption[] | null>(null)
  /** What the list was filtered by, so the sheet can say so (C2b). */
  const [context, setContext] = useState<SwapContext | null>(null)
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<Scope>('slot')
  const [error, setError] = useState<string | null>(null)

  const groupId = target?.groupId
  const slotId = target?.slotId

  useEffect(() => {
    if (!open || !groupId || !slotId) return

    setOptions(null)
    setContext(null)
    setSearch('')
    // Every slot starts on its own recommendation. Carrying `All items` over
    // from the last slot would quietly change what the next one is offering.
    setScope('slot')
    setError(null)

    let cancelled = false
    fetchSwapOptions(tripId, groupId, slotId)
      .then((result) => {
        if (cancelled) return
        setOptions(result.candidates)
        setContext(result.context)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your wardrobe.')
      })

    return () => {
      cancelled = true
    }
  }, [open, tripId, groupId, slotId])

  /**
   * Hand the choice over and get out of the way.
   *
   * No await, no `busy`, no error state of its own — the sheet is gone before
   * any of them could be shown, and the screen behind it owns both the
   * reconciliation and the failure message. Keeping a spinner here would be the
   * "hide a spinner over a blocked screen" that P1A forbids.
   */
  function choose(option: SwapOption | null) {
    if (!groupId || !slotId) return
    onChoose(option?.id ?? null, option)
    onClose()
  }

  if (!target) return null

  const needle = search.trim().toLowerCase()

  /*
   * Searched by what a garment IS, not only by what it is called.
   *
   * "jacket" has to find the Field Shell, or reaching the whole wardrobe is a
   * scroll rather than a search — and after G6 the name no longer carries the
   * brand or the colour at all, so "columbia" and "black" have to reach their
   * own fields or they stop finding anything.
   */
  /*
   * Both spellings of grey find the same garments.
   *
   * The rows read `Grey` and the column holds `Gray`, so a needle typed the way
   * the screen spells it would match nothing at all — a search that fails on
   * exactly the word it just showed him. Normalising the needle rather than the
   * fields keeps one comparison and leaves `gray` working too.
   */
  const canonicalNeedle = storedSpelling(needle)
  const matches = (option: SwapOption) =>
    !needle ||
    [option.name, option.subcategory, option.color, option.brand]
      .some((field) => (field ?? '').toLowerCase().includes(canonicalNeedle))

  const all = options ?? []
  /*
   * Whatever is in the slot right now is always in the default view, even when
   * it came from another part of the wardrobe.
   *
   * Otherwise the sheet contradicts the screen behind it: swap a jacket into a
   * Layer slot, reopen the sheet, and `Recommended` would show every mid-layer
   * and no sign of the garment actually in the slot — with nothing marked
   * `Current`, which reads as the swap having been undone.
   */
  const inSlot = all.filter((o) => o.inSlot || o.id === target.itemId)
  const elsewhere = all.filter((o) => !o.inSlot && o.id !== target.itemId)

  const shown = (scope === 'all' ? all : inSlot).filter(matches)
  const suitable = shown.filter((o) => o.suitable)
  const rest = shown.filter((o) => !o.suitable)

  /** What `All items` would add to the current search, for the way across. */
  const beyond = elsewhere.filter(matches).length

  /*
   * Judged on the WHOLE wardrobe, never on the search results.
   *
   * `suitable` is already narrowed by whatever Alex has typed, so keying the
   * "nothing suits this" message off it makes the sheet say something false the
   * moment he searches: type "wool", match one unsuitable garment, and it
   * announces that nothing he owns suits the occasion. A sighted user can
   * glance at the search field and discount it; someone listening cannot.
   */
  const nothingSuits = options !== null && inSlot.length > 0 && !all.some((o) => o.suitable)

  /*
   * Owning nothing OF THIS KIND, which is no longer the same as owning nothing.
   *
   * Before G3 the two were indistinguishable and the sheet sent Alex to My Stuff
   * for both. Sending him off to add a garment he may already own, in the one
   * case this slice exists to fix, would be the worst answer on the screen.
   */
  const noneInSlot = options !== null && inSlot.length === 0 && elsewhere.length > 0

  /*
   * "Change top", not "Top" (§14).
   *
   * A sheet titled with a noun says what it is about; a sheet titled with a
   * verb says what pressing something in it will do. Selection applies at once
   * here — there is no Save — so the title is the only place the action can be
   * named, and `Top` above a list of tops left that unsaid.
   */
  const title = `Change ${target.roleLabel.toLowerCase()}`

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="form swap-form">
        {error ? <p className="field-error">{error}</p> : null}

        {/*
          * What this list was filtered by (C2b).
          *
          * A sheet that rejects half the wardrobe without saying what it is
          * judging against is indistinguishable from a broken one. "8–10 Aug ·
          * Kruger · rain likely" is what turns "not recorded as keeping rain
          * out" from an odd refusal into an answer — and it is the same context
          * the review panel shows, from the same derivation, so the two cannot
          * disagree about which days this outfit covers.
          *
          * Every part is omitted when it is not recorded. There is no
          * "probably mild" here, and no weather guessed from the trip's overall
          * range when the outfit covers specific days.
          */}
        {/*
          * What this replacement has to work with (§15, §52).
          *
          * The most important thing on the sheet and the one it did not have.
          * Changing a top is not the question "which of my tops is good"; it is
          * "which top works with THESE trousers, THESE shoes and THIS layer" —
          * and the sheet used to answer the first while spending its first
          * third restating the trip's dates, place and formality, which Alex
          * had just read on the screen behind it.
          *
          * The garment being replaced is not here. It is on its way out, and
          * listing it among the things the replacement must suit would be the
          * sheet arguing with itself.
          */}
        {context && context.paired.length > 0 ? (
          <div className="swap-paired">
            <p className="swap-paired-label" id="swap-paired-label">
              Wearing it with
            </p>
            <ul className="swap-paired-list" aria-labelledby="swap-paired-label">
              {context.paired.map((garment) => (
                <li key={garment.itemId} className="swap-paired-item">
                  {/*
                    * The palette, and no separate module for it (§10).
                    *
                    * These three rows ARE the current outfit's colours — a
                    * `Current outfit colors` card above them would be the same
                    * information twice, and the dot leading each row puts them
                    * in one column that reads as a palette at a glance.
                    */}
                  <ColorDots color={garment.color} className="swap-paired-colors" />
                  {/*
                    * Name and metadata in ONE box, so the row's flex gap falls
                    * between the dot and the text and nowhere else. Left as
                    * three siblings, the gap landed either side of the middot
                    * too and the separator drifted away from both words.
                    */}
                  <span className="swap-paired-text">
                    <span className="swap-paired-name">{garment.itemName}</span>
                    {garment.detail ? (
                      <>
                        {/* Middot for the eye, comma for the ear. */}
                        <span className="swap-paired-detail" aria-hidden="true"> · </span>
                        <span className="visually-hidden">, </span>
                        <span className="swap-paired-detail">{garment.detail}</span>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/*
          * The occasion, demoted to one line (§16).
          *
          * It still matters — it is what the eligibility filter is judging
          * against, and a sheet that rejects half the wardrobe without saying
          * what it is judging by is indistinguishable from a broken one. What
          * it does not need is a paragraph above the clothes. Same facts, same
          * derivation, one line, and below the garments rather than above them.
          *
          * Every part is omitted when it is not recorded. There is no
          * "probably mild", and no weather guessed from the trip's overall
          * range when the outfit covers specific days.
          */}
        {context ? (
          <p className="swap-context">
            {[
              /*
               * The activity leads (§21).
               *
               * It is the fact that decides what is eligible — a dinner and a
               * hike admit different garments from the same wardrobe — and it
               * was third, after a date range and a city that narrow nothing.
               * Ordered by how much each part changes the list below it.
               */
              ...(context.activity && context.activity !== context.when ? [context.activity] : []),
              /*
               * `Once` is dropped. It is what `outfitContext` returns for a
               * group that happens a single time, which is nearly every group —
               * so it appeared on nearly every sheet and distinguished nothing.
               * A count that MATTERS (`3 days`) is not the string `Once` and
               * survives.
               */
              ...(context.when && context.when !== 'Once' ? [context.when] : []),
              ...(context.travelDay ? ['Travel day'] : []),
              ...(context.place ? [context.place] : []),
              ...(context.conditions ? [context.conditions] : []),
              /*
               * Formality, and ONLY where the activity has not already implied
               * it (§14).
               *
               * `Nice dinners · Smart casual to Formal` is one fact twice: the
               * band comes from the activity's own template, so naming the
               * activity has already said it to anyone who knows what a nice
               * dinner is — which is the person reading. Twenty-two characters
               * on the line directly above the clothes, on every sheet.
               *
               * It survives wherever the activity is NOT shown — an untagged
               * group, or one whose name and activity are the same string —
               * because there the band is the only thing saying how dressy this
               * is.
               *
               * **Presentation only.** `maxDressiness`, `acceptableContexts`
               * and the template's own band are untouched: formality is still a
               * hard filter in `passesFilters`, still decides eligibility,
               * still produces gaps and still ranks. Hiding a derived label is
               * not the same as removing the fact, and the test that holds this
               * asserts the planner still rejects an over-casual garment.
               */
              ...(context.formality && !context.activity ? [context.formality] : []),
            ].map((part, index) => (
              <span key={part}>
                {index > 0 ? (
                  <>
                    {/* Middot for the eye, comma for the ear — `·` is not
                      * announced at VoiceOver's default punctuation level. */}
                    <span aria-hidden="true"> · </span>
                    <span className="visually-hidden">, </span>
                  </>
                ) : null}
                {part}
              </span>
            ))}
          </p>
        ) : null}

        {options === null ? (
          <p className="hint">Looking through your wardrobe…</p>
        ) : options.length === 0 ? (
          <p className="hint">
            You do not own anything that could go here. Add something in My Stuff and plan again.
          </p>
        ) : (
          <>
            <label className="field">
              <span className="visually-hidden">Search your wardrobe</span>
              <SearchInput value={search} onChange={setSearch} placeholder="Search" />
            </label>

            {/*
              * The two chips, and the whole point of the slice.
              *
              * A radio group rather than two buttons that happen to be
              * exclusive, for the same reason the appearance chips are: the
              * semantics are what tell a listener that picking one un-picks the
              * other, and they cost nothing.
              */}
            <div
              className="chips chips-compact swap-scope"
              role="radiogroup"
              aria-label="Which of your clothes to show"
            >
              {SCOPES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={scope === option.key}
                  className={`chip ${scope === option.key ? 'is-on' : ''}`}
                  onClick={() => setScope(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/*
              * Owning nothing of this kind, said plainly, with the way on.
              *
              * This is Alex's original complaint at its sharpest: a Layer slot,
              * no mid-layers in the wardrobe, and an empty list that reads as a
              * broken screen. The jacket he wants is one chip away and the sheet
              * has to say so.
              */}
            {noneInSlot && scope === 'slot' ? (
              <p className="hint">
                You do not own anything that usually goes here.{' '}
                <button type="button" className="link-button" onClick={() => setScope('all')}>
                  Show all your clothes
                </button>
              </p>
            ) : null}

            {/*
              * Nothing SUITABLE, as distinct from nothing at all.
              *
              * The empty state above only fires when Alex owns nothing that
              * could go in this slot. The commoner case is owning several and
              * none of them suiting the occasion — and until doc 09 §7 asked
              * for "show when no eligible replacement exists", that case
              * rendered as a bare divider whose sentence began "Everything
              * ELSE you own", with nothing above it for "else" to refer to.
              */}
            {nothingSuits ? (
              <p className="hint">
                Nothing you own suits this. What is below is the rest of your wardrobe, with why
                Pack Smart set each one aside.
              </p>
            ) : null}

            <ul className="swap-list">
              {suitable.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className={`swap-row ${option.id === target.itemId ? 'is-current' : ''}`}
                    onClick={() => choose(option)}
                  >
                    <span className="swap-line">
                      <span className="swap-name">{option.name}</span>
                      {/* Which one of them this is (G6). Seven quarter-zips can
                        * reach this list, and after the name stopped repeating
                        * the brand and the colour this is what tells them
                        * apart. On the name's own line now, because a garment
                        * and which garment it is are one fact. */}
                      {option.detail ? <span className="swap-detail">{option.detail}</span> : null}
                      {/*
                        * What this one would put next to the three above it.
                        *
                        * The comparison the sheet exists to make, and it costs
                        * a dot rather than a line.
                        */}
                      <ColorDots color={option.color} />
                      {option.id === target.itemId ? (
                        <span className="swap-current">Current</span>
                      ) : null}
                    </span>
                    {/*
                      * One reason, and only where there is one (§18).
                      *
                      * `rank` writes `decidedBy` for the winner alone and only
                      * when a criterion actually separated it from the runner
                      * up — so this is null on most rows, which is the point. A
                      * list where every option is annotated is a list where the
                      * annotations are wallpaper.
                      */}
                    {option.recommendation ? (
                      <span className="swap-why">{option.recommendation}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>

            {rest.length > 0 ? (
              <>
                {/*
                  * The divider says which wardrobe it is dividing.
                  *
                  * "that fits here" is true of the slot's own garments and false
                  * of the rest, so it cannot be one sentence for both scopes —
                  * a jacket listed under "everything else that fits here" would
                  * be the sheet asserting the thing G3 exists to stop asserting.
                  */}
                <p className="swap-divider">
                  {scope === 'all'
                    ? nothingSuits
                      ? 'Everything you own. It is your call.'
                      : 'Everything else you own. Pack Smart does not think these suit the occasion, but it is your call.'
                    : nothingSuits
                      ? 'Everything you own that could go here. It is your call.'
                      : 'Everything else you own that fits here. Pack Smart does not think these suit the occasion, but it is your call.'}
                </p>
                <ul className="swap-list">
                  {rest.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        className={`swap-row is-unsuitable ${option.id === target.itemId ? 'is-current' : ''}`}
                        onClick={() => choose(option)}
                      >
                        <span className="swap-line">
                          <span className="swap-name">{option.name}</span>
                          {option.id === target.itemId ? (
                            <span className="swap-current">Current</span>
                          ) : null}
                        </span>
                        {/* The reason stays, and the marker is added rather than
                          * substituted. A garment Alex chose himself is on this
                          * side of the divider precisely BECAUSE he overruled
                          * the recommendation — dropping either half loses the
                          * fact that he did, or the fact of what it is.
                          *
                          * The detail joins the reason rather than taking a
                          * line of its own: on this side of the divider the row
                          * already carries a second line, and a third would
                          * make the unwanted options the tallest rows in the
                          * sheet. */}
                        <span className="swap-why">
                          {[option.detail, option.reason].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {/*
              * A search that found nothing HERE, and what it would find next
              * door.
              *
              * Both halves matter. An empty list under a search box is a dead
              * end wherever it happens; an empty list when the thing being
              * looked for is sitting in `All items` is the exact failure this
              * slice was reported for, and counting the matches is what makes
              * the offer worth taking.
              */}
            {shown.length === 0 && needle ? (
              <p className="hint">
                {/* "Nothing you own" is a bigger claim than "nothing here", and
                  * only one of them is true when the match is sitting behind
                  * the other chip. */}
                {scope === 'slot' && beyond > 0 ? (
                  <>Nothing here matches “{search.trim()}”.</>
                ) : (
                  <>Nothing in your wardrobe matches “{search.trim()}”.</>
                )}{' '}
                {scope === 'slot' && beyond > 0 ? (
                  <button type="button" className="link-button" onClick={() => setScope('all')}>
                    {beyond === 1
                      ? 'One more in all your clothes'
                      : `${beyond} more in all your clothes`}
                  </button>
                ) : null}
              </p>
            ) : scope === 'slot' && beyond > 0 && needle ? (
              /*
               * Found something, and there is more past the slot. Quieter than
               * the empty case — the list above is a real answer, this is only
               * the reminder that it is not the whole wardrobe.
               */
              <p className="hint">
                <button type="button" className="link-button" onClick={() => setScope('all')}>
                  {beyond === 1
                    ? 'One more match in all your clothes'
                    : `${beyond} more matches in all your clothes`}
                </button>
              </p>
            ) : null}
          </>
        )}

        {target.itemId ? (
          <button
            type="button"
            className="button-secondary destructive"
            onClick={() => choose(null)}
          >
            Leave this empty
          </button>
        ) : null}
      </div>
    </BottomSheet>
  )
}
