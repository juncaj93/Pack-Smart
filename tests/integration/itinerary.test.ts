import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { itineraryRoutes } from '../../worker/routes/itinerary'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * The itinerary endpoint, driven through the real HTTP route.
 *
 * The interpreter has its own unit tests; what this covers is the boundary —
 * that the three ways in reach the same interpreter, that a bad input is
 * refused with words rather than a stack trace, and above all that reading an
 * itinerary WRITES NOTHING. Applying it is a separate, explicit act on the trip,
 * and that separation is what makes "infer, then confirm" structural.
 */

let db: TestDatabase

async function call(body: unknown, headers: Record<string, string> = {}) {
  return itineraryRoutes.request(
    new Request('https://example.test/parse', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
    undefined,
    { DB: db.binding } as never,
  )
}

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

const ITINERARY = [
  'Destination: Cape Town',
  '2 August 2026 - game drive at first light',
  '3 August 2026 - game drive',
  '5 August 2026 - wine tasting in Stellenbosch',
].join('\n')

const TRIP = { startDate: '2026-08-01', endDate: '2026-08-08' }

describe('reading pasted text', () => {
  it('returns the days it found, with the lines they came from', async () => {
    const response = await call({ text: ITINERARY, ...TRIP })
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      source: string
      proposal: { days: Array<{ date: string; activityTag: string; evidence: string }> }
    }

    expect(body.source).toBe('text')
    expect(body.proposal.days.filter((d) => d.activityTag === 'safari').map((d) => d.date)).toEqual([
      '2026-08-02',
      '2026-08-03',
    ])
    for (const day of body.proposal.days) expect(day.evidence.length).toBeGreaterThan(0)
  })

  /*
   * The guarantee the whole design rests on. Reading is not applying, and a
   * parser that wrote straight to the trip would pack for the wrong week the
   * first time it misread a cancellation deadline.
   */
  it('writes nothing at all', async () => {
    await call({ text: ITINERARY, ...TRIP })

    for (const table of ['trip', 'trip_event', 'trip_fact', 'checklist_entry', 'outfit_group']) {
      const row = db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      expect(row.n, table).toBe(0)
    }
  })

  it('says nothing was found rather than returning a hopeful reading', async () => {
    const response = await call({ text: 'Terms and conditions apply.', ...TRIP })
    const body = (await response.json()) as { problem: string | null; proposal: { empty: boolean } }

    expect(response.status).toBe(200)
    expect(body.proposal.empty).toBe(true)
    expect(body.problem).toContain('Nothing recognisable')
  })

  it('refuses an empty request in words', async () => {
    const response = await call({})
    expect(response.status).toBe(400)

    const body = (await response.json()) as { error: { message: string } }
    expect(body.error.message).toContain('Paste some text')
  })

  it('refuses far more text than an itinerary', async () => {
    const response = await call({ text: 'game drive '.repeat(60_000) })
    expect(response.status).toBe(400)
  })
})

describe('reading a link', () => {
  it('refuses something that is not a link', async () => {
    const response = await call({ url: 'not a url' })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      'does not look like a link',
    )
  })

  it('refuses a scheme that is not the web', async () => {
    for (const url of ['file:///etc/passwd', 'data:text/html,hi', 'ftp://example.test/x']) {
      const response = await call({ url })
      expect(response.status, url).toBe(400)
    }
  })

  /*
   * The sandbox this runs in cannot reach the open internet, so a real fetch
   * fails here — which is exactly the path being asserted. A link that cannot be
   * reached has to come back as a sentence Alex can act on, not as a 500.
   */
  it('reports an unreachable page in words rather than failing', async () => {
    const response = await call({ url: 'https://example.invalid/itinerary' })
    expect(response.status).toBe(400)

    const body = (await response.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/could not be reached|answered/)
  })
})

describe('reading a PDF', () => {
  it('refuses a request with no file attached', async () => {
    const form = new FormData()
    const response = await itineraryRoutes.request(
      new Request('https://example.test/parse', { method: 'POST', body: form }),
      undefined,
      { DB: db.binding } as never,
    )

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      'No file',
    )
  })

  it('refuses a file that is not a PDF, by its bytes rather than its name', async () => {
    const form = new FormData()
    form.set('file', new File(['just some text'], 'itinerary.pdf', { type: 'application/pdf' }))

    const response = await itineraryRoutes.request(
      new Request('https://example.test/parse', { method: 'POST', body: form }),
      undefined,
      { DB: db.binding } as never,
    )

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      'does not look like a PDF',
    )
  })
})
