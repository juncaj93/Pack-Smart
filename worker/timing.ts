/**
 * What a request spent its time on, reported to whoever asked for it (P1B).
 *
 * Doc 09 §8.2 sets the rule that a responsiveness fix starts with a
 * measurement. The measurement it started from — a vitest harness timing three
 * repository calls in a row — answers the question once, on this machine, for a
 * seeded wardrobe. It cannot answer it for Alex's actual wardrobe on Alex's
 * actual phone, which is the only place the complaint came from.
 *
 * `Server-Timing` can. It is a standard response header, Safari's network
 * inspector renders it as a bar chart without any setup, and the e2e harness
 * reads it out of the response to fill in the four stages of the P1B brief that
 * happen inside the Worker — server receive, persistence, recomputation begins,
 * recomputation ends — which nothing on the client can see from outside.
 *
 * Deliberately NOT middleware over every route. A stage is worth naming when
 * somebody has decided it is a stage; a wrapper that timed every handler would
 * produce a header on paths nobody is investigating and would still not know
 * what to call the parts.
 */

/** One named stage, and how long it took. */
interface Stage {
  name: string
  ms: number
}

export interface Stopwatch {
  /** Runs `work`, records how long it took under `name`, returns its result. */
  at<T>(name: string, work: () => Promise<T>): Promise<T>
  /**
   * The header value: every stage in the order it ran, then `total`.
   *
   * `total` is measured from construction rather than summed, so the gap
   * between stages — parsing a body, validating it — is visible as the
   * difference rather than silently attributed to nothing.
   */
  header(): string
}

export function stopwatch(): Stopwatch {
  const startedAt = performance.now()
  const stages: Stage[] = []

  return {
    async at<T>(name: string, work: () => Promise<T>): Promise<T> {
      const from = performance.now()
      try {
        return await work()
      } finally {
        stages.push({ name, ms: performance.now() - from })
      }
    },

    header(): string {
      const all = [...stages, { name: 'total', ms: performance.now() - startedAt }]
      /*
       * `dur` to one decimal. The header is read by a person in a network
       * inspector as often as by the harness, and `dur=19.4623000000001` is
       * worse at both jobs than `dur=19.5`.
       */
      return all.map((stage) => `${stage.name};dur=${stage.ms.toFixed(1)}`).join(', ')
    },
  }
}
