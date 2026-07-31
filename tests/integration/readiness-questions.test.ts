import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openQuestions } from '@shared/readiness'
import type { Trip } from '@shared/trips'

/**
 * Every question Pack Smart asks is about a fact some rule actually reads.
 *
 * A question whose answer changes nothing is a form field wearing a question's
 * clothes, and doc 09 §5 asks only for questions that MATERIALLY change
 * recommendations. So this checks the claim against the rules themselves rather
 * than against the comment beside the list.
 *
 * It lives in `tests/integration/` rather than beside the rest of the readiness
 * tests because it reads the seed sources off disk, and
 * `tsconfig.integration.json` is the only project carrying Node types.
 */

function unanswered(): Trip {
  return {
    id: 'trip', name: 'Lisbon', emoji: '🧳',
    startDate: '2026-08-15', endDate: '2026-08-22',
    status: 'planning', notes: null, luggageMode: null,
    laundryAvailable: null, maxDressiness: null, flightHours: null, international: null,
    timezone: null, destinations: [], activities: [], days: [], facts: [],
    archivedAt: null, createdAt: 0, updatedAt: 0,
  }
}

/**
 * Everywhere a seeded rule's condition can come from.
 *
 * Both, because assuming one was this test's own first failure: the migrations
 * seed a handful of conditions directly, and `shared/import.ts` writes the rest
 * as it reads the spreadsheet — which is where `international` and
 * `flight_hours` actually originate.
 */
function seedSources(): string {
  const dir = join(process.cwd(), 'migrations')
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .concat(readFileSync(join(process.cwd(), 'shared/import.ts'), 'utf8'))
    .join('\n')
}

describe('the questions Pack Smart asks', () => {
  it('every one names a fact a seeded rule compares against', () => {
    const sources = seedSources()
    // Two spellings, since one source is JSON in SQL and the other TypeScript.
    const reads = (fact: string) =>
      sources.includes(`"fact":"${fact}"`) || sources.includes(`fact: '${fact}'`)

    const asked = openQuestions(unanswered())
    expect(asked.length).toBeGreaterThan(0)

    for (const question of asked) {
      /*
       * `laundry_available` is the deliberate exception, and naming it here is
       * why this is an assertion rather than a comment: no SEEDED rule reads
       * it, but `computeQuantity` does — an unrecorded value makes a
       * laundry-dependent rule evaluate to unknown rather than pack — and it is
       * the first fact a user-written rule is likely to use now that rules can
       * be written at all. If that stops being true, this is where it shows.
       */
      if (question.fact === 'laundry_available') continue
      expect(reads(question.fact), `nothing reads ${question.fact}`).toBe(true)
    }
  })

  it('says what answering changes, not that it helps', () => {
    // Doc 09 §25 rules out confident language the data does not support, and
    // "improves your recommendations" is the purest example of it.
    for (const question of openQuestions(unanswered())) {
      expect(question.because).not.toMatch(/better|improve|smarter|optimi[sz]e/i)
      expect(question.because.length).toBeGreaterThan(10)
    }
  })
})
