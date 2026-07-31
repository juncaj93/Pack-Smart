# Where a trip is, and what to do next

Doc 09 §2 calls the readiness model *"the central gap — nothing derives one next
action"*, and §4 asks for one derived state driving Home, Trips, Trip, the
packing list, Outfits and During Trip.

**This describes what `readiness` in `shared/readiness.ts` actually does**,
written from the code rather than from intent, and pinned by
`tests/unit/worker/readiness.test.ts`.

---

## 1. Why there is a model at all

Before this, every screen worked out its own answer. Home had a countdown, a
progress bar and an essentials banner; the trip screen had a different progress
bar and a different banner; neither agreed about what mattered most, and Home's
primary action was decided by a single test — has the trip started — so before
departure it always said *Packing list*, whether the list existed, whether two
outfits were waiting for review, or whether everything was already packed.

That is not a missing feature so much as four screens quietly disagreeing. One
derived answer, read everywhere, is the fix.

---

## 2. Three properties, all load-bearing

**Derived, never stored.** A stored readiness label needs something to keep it
fresh, and the thing that keeps it fresh is what goes wrong. `tripStatusOn`
already makes this argument for status; it applies with more force here, because
readiness changes every time a row is packed. Doc 09 §4 permits persistence only
where technically necessary, and nothing here is.

**Exactly one next action.** `next` is one action or `null` — not a ranked list
the screen picks from, because then the screen is deciding and two screens will
decide differently. `null` is a real answer: when the trip is ready or finished,
there is nothing to suggest, and an app that always has a suggestion has one
because it is padding.

**Pure.** No fetching, no clock. `today` is passed in, so a test can put a trip
in any relationship to the present without waiting for it, and the day-counting
is UTC so "days to go" does not move when the clocks do.

---

## 3. The order the stages are decided in

The order IS the product decision. Each stage is checked only once the ones
above it do not apply:

| | Stage | Why it is here |
|---|---|---|
| 1 | `finished` | Every other stage is a judgement about work still worth doing |
| 2 | `underway` | The job changes from "help me pack" to "what do I wear" (doc 04 §11) |
| 3 | `no_dates` | Duration decides how much of everything is needed |
| 4 | `nothing_planned` | Every stage below judges a list that does not exist yet |
| 5 | `questions` | An answer can ADD to the list; finding that out after packing is wasted work |
| 6 | `outfits` | Approving an outfit adds what it needs to the list |
| 7 | `packing` | The ordinary case |
| 8 | `final_check` | A toothbrush in the bathroom is not a finished bag |
| 9 | `ready` | Nothing to suggest |

Two of these are worth stating as rules rather than rows:

**Questions never block.** Doc 09 §5 requires a question to be deferrable
without blocking. Two things enforce that: they are asked *after* the list
exists rather than before, and they stop being the recommended action inside the
last three days — at that point a question is an interruption, and the list Alex
has is the list he is taking. They stay in `openQuestions` throughout, so a
screen can still offer them quietly.

**An unplanned trip is not an outfit problem.** `outfits` only applies when some
group already exists. A trip with none may be one Alex does not want outfits
for, and deciding otherwise is the app deciding his taste for him.

---

## 4. Which questions get asked

Only facts that materially change a recommendation (doc 09 §5). Three today:

| Fact | Asked as | What the answer changes |
|---|---|---|
| `international` | Are you leaving the country? | Whether the passport is packed |
| `flight_hours` | How long is the longest flight? | The neck pillow and the seat cushion |
| `laundry_available` | Will you have laundry? | How much needs taking |

`tests/integration/readiness-questions.test.ts` asserts that every fact offered
is one a **seeded rule actually compares against**, reading the migrations and
`shared/import.ts` rather than trusting the comment beside the list. A question
whose answer changes nothing is a form field wearing a question's clothes.

`laundry_available` is the documented exception: no seeded rule reads it, but
`computeQuantity` does — an unrecorded value makes a laundry-dependent rule
evaluate to `unknown` rather than pack — and it is the first fact a user-written
rule is likely to use now that rules can be written at all (A4b).

---

## 5. When essentials escalate

Doc 09 §4.1, expressed as one boolean the model owns rather than as a judgement
each screen repeats.

`essentialsUrgent` is true only when an essential is outstanding **and** one of:

- departure is within **three days**; or
- the bag is at least **80% packed**.

Those are the two moments where *"you have not packed your passport"* is
something Alex can act on right now. A fortnight out it is not a problem — it is
a trip that has not been packed yet, and saying so in red every time he opens
the app is how he learns to ignore the one that matters on the morning of the
flight.

**Nothing about essentials detection changed.** `criticalOutstanding` and
`outstandingEssentialsLine` are untouched; this is presentation and timing, as
§4.1 says explicitly.

Where they appear now:

| Screen | Essentials |
|---|---|
| Home | No banner. The recommended action reads *Pack the essentials* when they are urgent |
| Trips | Never had one |
| Trip / packing list | The full line, always — this is where naming them is actionable |

The banner came off Home for a sharper reason than §4.1 anticipated: with a
recommended action that already read *Pack the essentials*, the red panel said
the same thing a second time, louder, directly above it.

---

## 6. What this may not do

- Show a stage as a permanent section. This is an internal vocabulary deciding
  one sentence and one button, not a four-section screen (doc 09 §6).
- Build a URL. `next.route` is a name; screens resolve it, so a renamed route
  breaks in one place.
- Claim readiness that is not real. `final_check` exists precisely so "ready"
  never covers a trip with something still in the bathroom.
- Invent work to have something to say. `next` is `null` when there is nothing.
