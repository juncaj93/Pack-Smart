import { bagFor, type ChecklistEntry } from './checklist'
import { isPacked, needsFinalCheck, sectionFor } from './rules'

/**
 * The morning you leave (doc 09 §12).
 *
 * Everything else in Pack Smart answers "what am I taking". This answers a
 * different and much narrower question, asked in a hallway with a coat half on:
 * **what is still not in the bag, and what do I put on.**
 *
 * So it is deliberately NOT the packing list with a filter over it. A filter
 * still gives Alex a forty-row screen to read, and the whole point of a
 * departure view is that there is nothing to read — three things, in the order
 * he will do them, and then it is empty.
 *
 * Every row here comes from data he or the rules already recorded: the packing
 * timing, the final-check flag, the bag, the essential flag. **Nothing is
 * inferred from a name.**
 */

/** One section of the departure screen, and the act it stands for. */
export interface DayOfPlan {
  /**
   * What he puts on rather than packs.
   *
   * Read from the resolved bag, so a recommendation counts: on the morning
   * itself "what am I wearing" is worth answering whether or not he ever
   * tapped the row to confirm it.
   */
  wear: ChecklistEntry[]
  /**
   * Still out of the bag, and it has to go in now.
   *
   * The two reasons a thing is legitimately still out on departure morning:
   * it was marked **Pack day of** because it is in use until he leaves, or it
   * needs a **final check** and has not been packed at all. Both are the same
   * act — pick it up, put it in — so they are one section rather than two.
   */
  grab: ChecklistEntry[]
  /**
   * In the bag, but he has not said so out loud.
   *
   * A different act from `grab`, and the reason `requires_final_check` exists:
   * the passport is packed, and "packed" was ticked three days ago. This asks
   * him to look.
   */
  confirm: ChecklistEntry[]
  /**
   * Everything else that is still not packed.
   *
   * Not listed row by row — that is the packing list, and repeating it here is
   * what §12 rules out. A count, and the essentials among them by name, because
   * "9 things still to pack" and "9 things still to pack, one of which is your
   * medication" are different sentences.
   */
  outstanding: {
    total: number
    essentials: ChecklistEntry[]
  }
  /** How many acts this screen is still asking for, across all four. */
  remaining: number
}

/**
 * Essentials first, then alphabetical.
 *
 * Not by category and not in list order: at the door the only ranking that
 * matters is what it costs to leave without it. Alphabetical underneath so the
 * order is stable between two glances at the same screen — a section that
 * reshuffles is one he has to re-read.
 */
function departureOrder(a: ChecklistEntry, b: ChecklistEntry): number {
  if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1
  return a.name.localeCompare(b.name)
}

/**
 * Splits a checklist into the four departure-morning questions.
 *
 * Pure, and total over any checklist — a trip with nothing packed and a trip
 * with everything packed both produce a valid plan, and the second one produces
 * an empty screen, which is the answer.
 */
export function dayOfPlan(entries: ChecklistEntry[]): DayOfPlan {
  // Not bringing is not "still to pack". It is a decision, and counting it here
  // would leave the number at the door permanently wrong by however many things
  // Alex deliberately left behind.
  const bringing = entries.filter((entry) => entry.excludedAt === null)

  const wear: ChecklistEntry[] = []
  const grab: ChecklistEntry[] = []
  const confirm: ChecklistEntry[] = []
  const outstanding: ChecklistEntry[] = []

  for (const entry of bringing) {
    /*
     * Wearing it is the first question and it wins outright.
     *
     * A jacket assigned to `wear` that also needs a final check is not two
     * jobs — he puts it on, and it is on him. The trip screen deliberately
     * shows a final-check row twice, in two sections, because there it is
     * answering two different questions about a bag. Here there is one bag and
     * one morning, and a screen meant to empty out cannot have rows that
     * reappear somewhere else on it.
     */
    if (bagFor(entry).bag === 'wear') {
      wear.push(entry)
      continue
    }

    const packed = isPacked(entry)
    const finalCheck = needsFinalCheck(entry)

    if (!packed) {
      if (sectionFor(entry) === 'pack_later' || finalCheck) grab.push(entry)
      else outstanding.push(entry)
      continue
    }

    if (finalCheck) confirm.push(entry)
  }

  wear.sort(departureOrder)
  grab.sort(departureOrder)
  confirm.sort(departureOrder)

  return {
    wear,
    grab,
    confirm,
    outstanding: {
      total: outstanding.length,
      essentials: outstanding.filter((entry) => entry.isCritical).sort(departureOrder),
    },
    remaining:
      wear.filter((entry) => !isPacked(entry)).length +
      grab.length +
      confirm.length +
      outstanding.length,
  }
}

/**
 * Whether the departure screen is the one worth recommending.
 *
 * **Two whole days**, not one. A trip that leaves at six in the morning is
 * packed the night before, and a screen that only appears on the day itself
 * appears after the moment it was for. It stops the moment the trip starts,
 * because from then on the question is Today's outfit rather than the door.
 */
export function isDepartureImminent(untilDeparture: number): boolean {
  return untilDeparture >= 0 && untilDeparture <= 1
}
