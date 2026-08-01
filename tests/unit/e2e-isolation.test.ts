import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The isolation rules, enforced rather than written down and hoped for.
 *
 * Q1 fixed a class of flake, not a bug: three spec files acted on a trip they
 * did not own, and two mutated global rows that every other spec was reading.
 * Nothing stopped the next spec doing it again — and the symptom, when it came
 * back, would be "some unrelated test is flaky", which is the hardest kind of
 * report to act on and the one this repository has already spent two slices
 * chasing (doc 09 §5a).
 *
 * A source-reading test rather than a runtime one on purpose. The defect is a
 * PATTERN, and the moment it costs anything is when it is written, not when it
 * eventually makes some other file fail an hour later on CI.
 */

const E2E = join(process.cwd(), 'tests', 'e2e')

function specs(): Array<{ name: string; source: string }> {
  return readdirSync(E2E)
    .filter((name) => name.endsWith('.spec.ts'))
    .map((name) => ({ name, source: readFileSync(join(E2E, name), 'utf8') }))
}

/** Strips comments, so the prose explaining a rule cannot trip the rule. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('the end-to-end suite owns its data', () => {
  it('has specs to check', () => {
    expect(specs().length).toBeGreaterThan(15)
  })

  /*
   * The single line most of doc 09 §5a came from.
   *
   * `/api/trips` answers `ORDER BY start_date DESC`, so `trips[0]` is whichever
   * trip another spec last created. Three files were packing rows, unpacking
   * them and asserting on the reasons of a trip they had borrowed, while its
   * owner mutated it in parallel — passing alone, failing in a full run, and
   * depending on the order the files happened to run in.
   */
  it('never acts on a trip another spec created', () => {
    const offenders = specs()
      .filter(({ source }) => /trips\s*\[\s*0\s*\]/.test(code(source)))
      .map(({ name }) => name)

    expect(
      offenders,
      'use createTrip() from fixtures.ts — see AUTONOMY.md §6, "End-to-end tests own their data"',
    ).toEqual([])
  })

  /*
   * The second class, and the worse one: it did not present as a flake at all.
   *
   * `packing_rule` is global, so an amount left behind changes the quantity on
   * every future list — and the amount picker hides items that already have
   * one, so a test that died before its cleanup could never find its item
   * again. Permanent, until the local database was deleted.
   *
   * The rule is not "clean up"; it is "clean up on the FAILURE path", which
   * means a teardown hook. A spec that opens the amounts sheet and never
   * mentions `clearAmounts` is either not writing one, or writing one it will
   * not always remove.
   */
  it('tears down every global amount it creates, on the failure path too', () => {
    const offenders = specs()
      .filter(({ source }) => {
        const body = code(source)
        return /Add an amount/.test(body) && !/clearAmounts/.test(body)
      })
      .map(({ name }) => name)

    expect(
      offenders,
      'creating an amount requires createOwnedItem() + clearAmounts() in afterEach',
    ).toEqual([])
  })

  /*
   * Names have to survive two workers reaching the same millisecond. The old
   * helpers were `${prefix} ${Math.floor(performance.now())}`, which is a
   * collision waiting for a parallel run — and a collision here means one
   * spec's locator matching another spec's trip, which is the borrowed-trip
   * defect wearing a different hat.
   */
  it('builds unique names from something better than a clock', () => {
    const offenders = specs()
      .filter(({ source }) => {
        const body = code(source)
        const hasLocalGenerator = /function uniqueName/.test(body)
        return hasLocalGenerator && !/Math\.random/.test(body)
      })
      .map(({ name }) => name)

    expect(offenders, 'use ownedName() from fixtures.ts').toEqual([])
  })
})
