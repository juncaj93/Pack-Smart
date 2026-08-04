import type { RuleSource, RuleType } from './rules'

/**
 * The post-trip review (F1, doc 09 §16).
 *
 * Half of F1 was already deployed before this file existed: `learning.ts`
 * derives *removal* and *unworn* proposals from evidence Alex never types, and
 * both are gated on three trips of it. This is the other half — the short
 * sitting after a trip that captures what the app CANNOT observe.
 *
 * The dividing line is the whole design, and it is worth stating as a rule
 * rather than as a preference:
 *
 *   If the app can see it, the review SHOWS it. If only Alex knows it, the
 *   review ASKS.
 *
 * "What did you pack but never use" is on the wrong side of that line —
 * `wear_log` answers it passively and `pendingUnwornProposals` already reads
 * it — so asking it would be homework whose answer is already on the screen
 * above the question. What is on the right side is small: what never made it
 * into the bag, what ran out, what there was too much of, which outfit was
 * wrong, and what a screen failed to say.
 *
 * Everything here is a pure function over already-fetched rows, for the same
 * reason `today.ts` is: the cases that matter — no wear log, an item that was
 * removed rather than forgotten, a rule Alex wrote himself — are all states of
 * the data, and a test that has to stand a Worker up to reach them is a test
 * nobody writes.
 */

/* ------------------------------------------------------------------ */
/* what the app already saw                                            */
/* ------------------------------------------------------------------ */

export interface ReviewObservations {
  /** Rows on the list that were not taken off it. */
  bringing: number
  /** How many of those were ticked. */
  packed: number
  /**
   * Whether During Trip was used at all, proven by the trip having a wear log.
   *
   * The same guard `pendingUnwornProposals` applies, for the same reason: on a
   * trip where Today was never opened, EVERY packed item looks unworn. Absence
   * of evidence is not evidence of absence, and a summary that claimed
   * "you wore none of it" would be confidently wrong.
   */
  wearLogUsed: boolean
  /** Packed and never recorded as worn. Empty when there is no wear log. */
  unworn: string[]
  /** Taken off this trip's list. */
  removed: string[]
  /** Outfits approved for this trip. */
  outfitsApproved: number
}

/**
 * The summary, in sentences.
 *
 * Shown ABOVE the questions and never as a question — this is the half of the
 * review that proves the app was paying attention, and it is what makes the
 * three questions below it feel short rather than partial.
 *
 * Every line is a count of something real. Nothing here is a judgement, because
 * a judgement about a finished trip is one Alex is better placed to make and is
 * about to be asked for.
 */
export function summaryLines(observations: ReviewObservations): string[] {
  const lines: string[] = []
  const { bringing, packed, wearLogUsed, unworn, removed, outfitsApproved } = observations

  if (bringing > 0) {
    lines.push(`You packed ${packed} of ${bringing} things on your list.`)
  }

  if (outfitsApproved > 0) {
    lines.push(
      outfitsApproved === 1 ? 'One outfit was approved.' : `${outfitsApproved} outfits were approved.`,
    )
  }

  if (removed.length > 0) {
    lines.push(`You took ${listOf(removed)} off the list.`)
  }

  /*
   * The unworn line is the one that has to be careful.
   *
   * With a wear log it is a fact. Without one it is not "nothing was worn", it
   * is "nobody was watching" — and saying so is what stops the next sentence,
   * and the whole `unworn` proposal family, from being read as a finding.
   */
  if (!wearLogUsed) {
    lines.push('You did not use Today on this trip, so Pack Smart did not see what you wore.')
  } else if (unworn.length === 0) {
    lines.push('Everything you packed was worn at least once.')
  } else {
    lines.push(`${listOf(unworn)} came home unworn.`)
  }

  return lines
}

/** `a`, `a and b`, `a, b and c`, and `a, b and 3 more` past four. */
function listOf(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/* ------------------------------------------------------------------ */
/* what Alex says                                                      */
/* ------------------------------------------------------------------ */

/**
 * The five things worth asking, and nothing else.
 *
 * Each one earns its place by being unobservable AND actionable, with one
 * deliberate exception. `missing_from_screen` produces no rule and says so —
 * there is no rule that expresses "the screen should have told me this", and
 * inventing one would be the fake confidence doc 06 §3 rules out. It is here
 * because on a single-user app it is the only channel that carries a screen's
 * omission out of Alex's head, and recording it honestly costs one text field.
 */
export type ReviewAnswerKind =
  | 'forgot'
  | 'ran_out'
  | 'too_many'
  | 'outfit_wrong'
  | 'missing_from_screen'

export type ReviewResolution = 'pending' | 'accepted' | 'declined'

export interface ReviewAnswer {
  id: string
  kind: ReviewAnswerKind
  itemId: string | null
  outfitGroupId: string | null
  note: string | null
  resolution: ReviewResolution
}

/** One rule in force for an item, as the review needs to read it. */
export interface ReviewRule {
  id: string
  ruleType: RuleType
  quantityValue: number | null
  source: RuleSource
  enabled: boolean
}

/** Everything the review knows about one item it is being asked about. */
export interface ReviewItemFacts {
  itemId: string
  itemName: string
  /** Whether this item had a row on this trip's list at all. */
  onTripList: boolean
  /** Whether that row was taken off. */
  excludedOnTrip: boolean
  /** Rules in force for it — already precedence-resolved by the caller. */
  rules: ReviewRule[]
}

export interface ReviewOutfitFacts {
  groupId: string
  name: string
  /** Only an approved outfit taught the planner anything to forget. */
  approved: boolean
  /** Whether it has garments at all; an empty outfit paired nothing. */
  hasGarments: boolean
}

/**
 * The change accepting a proposal makes.
 *
 * Data rather than a closure so that the screen, the endpoint and the tests all
 * name the same five operations, and so a proposal can be shown, stored and
 * applied without any of them re-deriving what it meant.
 *
 * Every one of them writes a `learned` rule or reverses a lasting effect that
 * already has an exact inverse. **None of them writes over a rule Alex wrote or
 * touches this trip's own record** — the trip is over, and what it says about
 * what he took is history.
 */
export type ReviewChange =
  | { kind: 'always_pack'; itemId: string }
  | { kind: 'add_spare'; itemId: string; spareRuleId: string | null; to: number }
  | { kind: 'step_down'; ruleId: string; to: number }
  | { kind: 'remove_spare'; ruleId: string }
  | { kind: 'forget_pairings'; outfitGroupId: string }

export interface ReviewProposal {
  answerId: string
  kind: ReviewAnswerKind
  resolution: ReviewResolution
  /**
   * What the answer was about, carried through so the pickers can stop offering
   * it.
   *
   * Two `ran out` answers about the same socks would produce two proposals to
   * add a spare, and accepting both would add two — which is not what saying it
   * twice meant. The endpoint refuses the duplicate; this is what stops it being
   * offered in the first place, which is the version Alex never sees fail.
   */
  itemId: string | null
  outfitGroupId: string | null
  /** What Alex said, back to him in plain words. Never a score, never a field name. */
  message: string
  /** What accepting does, stated before he does it. Null when nothing can be done. */
  effect: string | null
  /** Why nothing can be done, when nothing can be. Never blank and never vague. */
  limitation: string | null
  /**
   * Named when accepting would change a rule Alex wrote himself.
   *
   * The proposal is still shown and can still be accepted — refusing outright
   * would make his own settings unchangeable from here, which is not the same
   * as protecting them. What it may not do is happen quietly: the conflict is
   * stated, and accepting it is a separate deliberate tap
   * (`technical-docs/11_RULE_PRECEDENCE.md`).
   */
  conflict: string | null
  change: ReviewChange | null
}

export interface ReviewContext {
  items: Map<string, ReviewItemFacts>
  outfits: Map<string, ReviewOutfitFacts>
}

/**
 * Turns the answers into proposals, against the rules as they are RIGHT NOW.
 *
 * Derived at read time rather than stored, which is what `learning.ts` does and
 * for the same reason: a proposal stored beside its answer would still offer to
 * add a spare Alex has since added by hand. Here the spare simply is not
 * proposed, and nothing had to go back and invalidate anything.
 */
export function reviewProposals(answers: ReviewAnswer[], context: ReviewContext): ReviewProposal[] {
  return answers.map((answer) => proposalFor(answer, context))
}

function proposalFor(answer: ReviewAnswer, context: ReviewContext): ReviewProposal {
  const base = {
    answerId: answer.id,
    kind: answer.kind,
    resolution: answer.resolution,
    itemId: answer.itemId,
    outfitGroupId: answer.outfitGroupId,
  }

  switch (answer.kind) {
    case 'forgot':
      return { ...base, ...forgotProposal(answer, context) }
    case 'ran_out':
      return { ...base, ...ranOutProposal(answer, context) }
    case 'too_many':
      return { ...base, ...tooManyProposal(answer, context) }
    case 'outfit_wrong':
      return { ...base, ...outfitProposal(answer, context) }
    case 'missing_from_screen':
      return {
        ...base,
        message: `You said this was missing: ${answer.note ?? ''}`.trim(),
        effect: null,
        /*
         * The one question with no rule behind it, saying so.
         *
         * "Noted" is a small word doing real work: the alternative is a
         * proposal that sounds like a change and is not one, and a screen that
         * claims to have learned something it cannot act on is worse than a
         * screen that says it is only writing this down.
         */
        limitation: 'Noted. Pack Smart cannot change a screen on its own — this is here so it is not lost.',
        conflict: null,
        change: null,
      }
  }
}

type ProposalBody = Pick<ReviewProposal, 'message' | 'effect' | 'limitation' | 'conflict' | 'change'>

/* --- what never made it into the bag ------------------------------- */

function forgotProposal(answer: ReviewAnswer, context: ReviewContext): ProposalBody {
  const facts = answer.itemId ? context.items.get(answer.itemId) : undefined

  // Something he does not own. Recorded rather than refused — the evidence is
  // real even when there is no row to attach a rule to.
  if (!facts) {
    return {
      message: `You forgot ${answer.note ?? 'something'}.`,
      effect: null,
      limitation: 'This is not in My Stuff yet. Add it there and Pack Smart can pack it for you.',
      conflict: null,
      change: null,
    }
  }

  const message = `You forgot ${facts.itemName}.`

  /*
   * Removed is not forgotten, and the difference matters more than it looks.
   *
   * Proposing "always pack it" against a row Alex deliberately took off this
   * trip's list is the app arguing with a decision he already made — and it is
   * the same item the EXISTING removal proposal may be counting towards
   * "stop suggesting this". Two halves of one product pulling opposite ways.
   */
  if (facts.excludedOnTrip) {
    return {
      message,
      effect: null,
      limitation: 'It was on this trip\'s list and you took it off, so it was not left behind by Pack Smart.',
      conflict: null,
      change: null,
    }
  }

  // It was on the list and simply never ticked. The rule did its job; the bag
  // did not. There is nothing to learn from that and saying so is honest.
  if (facts.onTripList) {
    return {
      message,
      effect: null,
      limitation: 'It was already on this trip\'s list, waiting to be packed.',
      conflict: null,
      change: null,
    }
  }

  const already = facts.rules.find((rule) => rule.enabled && rule.ruleType === 'fixed_per_trip')
  if (already) {
    return {
      message,
      effect: null,
      limitation: 'There is already a rule to pack this every trip, and something about this trip kept it off the list.',
      conflict: null,
      change: null,
    }
  }

  return {
    message,
    effect: `Pack ${facts.itemName} on every trip. You can turn it off in Packing rules.`,
    limitation: null,
    conflict: null,
    change: { kind: 'always_pack', itemId: facts.itemId },
  }
}

/* --- what there was not enough of ---------------------------------- */

/**
 * A spare, not a bigger number.
 *
 * "I ran out of socks on a twelve-day trip" is one more than whatever the trip
 * worked out, and `spare` is exactly that: it adds a constant on top of the
 * base rather than changing the rate. A `minimum` of 8 would have applied to a
 * weekend as well, and raising the per-day rate would have turned one shortfall
 * into twelve extra pairs.
 */
function ranOutProposal(answer: ReviewAnswer, context: ReviewContext): ProposalBody {
  const facts = answer.itemId ? context.items.get(answer.itemId) : undefined
  if (!facts) {
    return {
      message: `You ran out of ${answer.note ?? 'something'}.`,
      effect: null,
      limitation: 'This is not in My Stuff yet. Add it there and Pack Smart can pack it for you.',
      conflict: null,
      change: null,
    }
  }

  const message = `You ran out of ${facts.itemName}.`
  const spare = facts.rules.find((rule) => rule.enabled && rule.ruleType === 'spare')
  const to = (spare?.quantityValue ?? 0) + 1

  return {
    message,
    effect:
      to === 1
        ? `Pack one spare ${facts.itemName} on every trip. You can change it in Packing rules.`
        : `Pack ${to} spare on every trip, one more than now. You can change it in Packing rules.`,
    limitation: null,
    conflict: conflictLine(spare),
    change: { kind: 'add_spare', itemId: facts.itemId, spareRuleId: spare?.id ?? null, to },
  }
}

/* --- what there was too much of ------------------------------------ */

/**
 * One step down, following whichever rule produced the number.
 *
 * The order is not arbitrary. "Clearly too many" for something packed by a rate
 * is a statement ABOUT the rate — twenty-four shirts on a twelve-day trip is
 * two a day, and removing a spare would take it to twenty-three and change
 * nothing about why. So the rate steps first, then a spare, then a flat count.
 *
 * And when none of the three applies there is no proposal, which is the case
 * this function exists to get right: capping the item with a `maximum` would
 * silently apply a three-day trip's number to a thirty-day one, and it would
 * look like the app had learned something.
 */
function tooManyProposal(answer: ReviewAnswer, context: ReviewContext): ProposalBody {
  const facts = answer.itemId ? context.items.get(answer.itemId) : undefined
  if (!facts) {
    return {
      message: `You had too many ${answer.note ?? 'of something'}.`,
      effect: null,
      limitation: 'This is not in My Stuff yet, so there is no rule to change.',
      conflict: null,
      change: null,
    }
  }

  const message = `You packed too many ${facts.itemName}.`
  const enabled = facts.rules.filter((rule) => rule.enabled)

  const rate = enabled.find(
    (rule) =>
      (rule.ruleType === 'per_day' ||
        rule.ruleType === 'per_night' ||
        rule.ruleType === 'duration_plus_buffer') &&
      (rule.quantityValue ?? 0) >= 2,
  )
  if (rate) {
    const to = (rate.quantityValue ?? 0) - 1
    const per = rate.ruleType === 'per_night' ? 'night' : 'day'
    return {
      message,
      effect: `Pack ${to} per ${per} instead of ${rate.quantityValue}. You can change it back in Your usual amounts.`,
      limitation: null,
      conflict: conflictLine(rate),
      change: { kind: 'step_down', ruleId: rate.id, to },
    }
  }

  const spare = enabled.find((rule) => rule.ruleType === 'spare' && (rule.quantityValue ?? 0) >= 1)
  if (spare) {
    return {
      message,
      effect: `Stop packing a spare ${facts.itemName}. You can turn it back on in Packing rules.`,
      limitation: null,
      conflict: conflictLine(spare),
      change: { kind: 'remove_spare', ruleId: spare.id },
    }
  }

  const flat = enabled.find(
    (rule) => rule.ruleType === 'fixed_per_trip' && (rule.quantityValue ?? 0) >= 2,
  )
  if (flat) {
    const to = (flat.quantityValue ?? 0) - 1
    return {
      message,
      effect: `Pack ${to} instead of ${flat.quantityValue}. You can change it back in Packing rules.`,
      limitation: null,
      conflict: conflictLine(flat),
      change: { kind: 'step_down', ruleId: flat.id, to },
    }
  }

  return {
    message,
    effect: null,
    limitation:
      'Pack Smart already packs the smallest number its rules allow. You can set a limit yourself in Packing rules.',
    conflict: null,
    change: null,
  }
}

/**
 * The sentence a `user` rule earns, and the reason it is a sentence rather than
 * a refusal.
 *
 * `11_RULE_PRECEDENCE.md`: an explicit user rule outranks anything learned. If
 * this returned "cannot change it", his own settings would become unreachable
 * from the one screen that has just been told they are wrong — which protects
 * the rule at the expense of the person. Naming it, and making the accept a
 * separate deliberate tap, is the version that does both.
 */
function conflictLine(rule: ReviewRule | undefined): string | null {
  if (!rule || rule.source !== 'user') return null
  return 'You set this one yourself. Accepting changes your own setting.'
}

/* --- the outfit that was wrong ------------------------------------- */

function outfitProposal(answer: ReviewAnswer, context: ReviewContext): ProposalBody {
  const facts = answer.outfitGroupId ? context.outfits.get(answer.outfitGroupId) : undefined
  if (!facts) {
    return {
      message: 'You said an outfit was wrong.',
      effect: null,
      limitation: 'That outfit is no longer on this trip.',
      conflict: null,
      change: null,
    }
  }

  const message = `${facts.name} was not right.`

  /*
   * Only an approval taught the planner anything, so only an approval has
   * anything to forget. `rememberGroup` runs on the draft -> approved
   * transition and nowhere else.
   */
  if (!facts.approved || !facts.hasGarments) {
    return {
      message,
      effect: null,
      limitation: 'That outfit was never approved, so nothing was learned from it.',
      conflict: null,
      change: null,
    }
  }

  return {
    message,
    /*
     * Said in two halves on purpose. Alex is looking at a finished trip, and
     * the first thing he needs to know about a change to it is that it is not
     * a change to it — the outfit he actually wore stays exactly as recorded.
     */
    effect: 'Stop putting those pieces together on future trips. This trip\'s outfit does not change.',
    limitation: null,
    conflict: null,
    change: { kind: 'forget_pairings', outfitGroupId: facts.groupId },
  }
}

/* ------------------------------------------------------------------ */
/* is there anything worth showing                                     */
/* ------------------------------------------------------------------ */

/**
 * Whether a proposal is still waiting on a decision.
 *
 * The screen counts these to decide whether *Finish* is the only thing left to
 * do. Accepted and declined are both decided; only `pending` with a change is
 * outstanding, because a proposal with nothing to apply has nothing to decide.
 */
export function isOutstanding(proposal: ReviewProposal): boolean {
  return proposal.resolution === 'pending' && proposal.change !== null
}
