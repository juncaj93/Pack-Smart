import { describe, expect, it } from 'vitest'
import { parseItinerary, readDates } from '../../../shared/itinerary'
import { extractHtmlText } from '../../../shared/extract-text'

/**
 * Reading an itinerary.
 *
 * The tests that matter most here are the ones about what it REFUSES to
 * conclude. An itinerary is somebody else's document — full of booking dates,
 * cancellation deadlines and marketing — and a parser that is merely
 * enthusiastic will happily pack for the wrong week.
 */

const TRIP = { startDate: '2026-08-01', endDate: '2026-08-08' }

describe('reading dates', () => {
  it('reads the forms an itinerary actually uses', () => {
    const forms = [
      '2026-08-03',
      '3 August 2026',
      'August 3, 2026',
      '3 Aug 2026',
      'Aug 3 2026',
    ]

    for (const form of forms) {
      const readings = readDates(form, 2026).flatMap((d) => d.readings)
      expect(readings, form).toContain('2026-08-03')
    }
  })

  /*
   * The one that would quietly ruin a trip. 03/08 is the third of August in most
   * of the world and the eighth of March in the United States, and an itinerary
   * almost never says which. Both readings are kept and the caller decides.
   */
  it('keeps both readings of a slashed date rather than picking one', () => {
    const readings = readDates('03/08/2026', 2026)[0]!.readings
    expect(readings).toContain('2026-08-03')
    expect(readings).toContain('2026-03-08')
  })

  it('borrows the year when the itinerary does not give one', () => {
    expect(readDates('3 August', 2027)[0]!.readings).toEqual(['2027-08-03'])
  })

  it('does not invent a date out of an impossible one', () => {
    expect(readDates('2026-02-30', 2026)).toHaveLength(0)
    expect(readDates('45 Augtember', 2026)).toHaveLength(0)
  })
})

describe('reading activities and the days they fall on', () => {
  const ITINERARY = `
    Your trip to South Africa
    Destination: Cape Town

    1 August 2026 — arrive, check in
    2 August 2026 — game drive at first light
    3 August 2026 — game drive, afternoon at leisure
    4 August 2026 — wine tasting in Stellenbosch
    5 August 2026 — game drive
    6 August 2026 — fine dining at The Test Kitchen
    8 August 2026 — fly home
  `

  it('counts the days an activity actually runs, not just that it happens', () => {
    const proposal = parseItinerary(ITINERARY, TRIP)
    const safariDays = proposal.days.filter((d) => d.activityTag === 'safari')

    // This is the whole point of the feature.
    expect(safariDays.map((d) => d.date)).toEqual(['2026-08-02', '2026-08-03', '2026-08-05'])
  })

  it('finds the other activities too', () => {
    const tags = parseItinerary(ITINERARY, TRIP).activities.map((a) => a.tag)
    expect(tags).toContain('safari')
    expect(tags).toContain('winery')
    expect(tags).toContain('nice_dinner')
  })

  it('quotes the line every proposal came from', () => {
    const proposal = parseItinerary(ITINERARY, TRIP)
    for (const day of proposal.days) {
      expect(day.evidence.length).toBeGreaterThan(0)
      expect(ITINERARY).toContain(day.evidence)
    }
  })

  it('reads the destination from a line that announces itself as one', () => {
    expect(parseItinerary(ITINERARY, TRIP).destinations).toContain('Cape Town')
  })

  /*
   * Recognising place names in prose needs a gazetteer this app does not carry,
   * and the destination decides the weather — a guess produces a confident
   * forecast for the wrong continent.
   */
  it('does not guess a destination out of prose', () => {
    const proposal = parseItinerary('We fly into Lisbon on 2 August 2026 for a game drive', TRIP)
    expect(proposal.destinations).toHaveLength(0)
  })

  it('resolves Day 3 against the trip start', () => {
    const proposal = parseItinerary('Day 3 — game drive at dawn', TRIP)
    expect(proposal.days[0]).toMatchObject({ date: '2026-08-03', activityTag: 'safari' })
  })

  it('detects an undated activity without inventing a day for it', () => {
    const proposal = parseItinerary('At some point we want to do a game drive', TRIP)
    expect(proposal.activities.map((a) => a.tag)).toEqual(['safari'])
    expect(proposal.days).toHaveLength(0)
    expect(proposal.activities[0]?.dayCount).toBe(0)
  })
})

describe('what it refuses to conclude', () => {
  /*
   * A confirmation email carries booking dates, payment dates and cancellation
   * deadlines. Every one of them is a real date, and none of them is a day of
   * the trip.
   */
  it('drops a date outside the trip', () => {
    const proposal = parseItinerary(
      [
        'Booked on 14 March 2026 — free cancellation until 1 July 2026',
        '2 August 2026 — game drive',
      ].join('\n'),
      TRIP,
    )

    expect(proposal.days.map((d) => d.date)).toEqual(['2026-08-02'])
  })

  it('asks about a slashed date rather than choosing, when both readings fit', () => {
    // 04/08 and 08/04 — but the trip is 1–8 August, so only one fits, and it
    // should resolve rather than ask.
    const resolved = parseItinerary('04/08/2026 wine tasting', TRIP)
    expect(resolved.days[0]?.date).toBe('2026-08-04')
    expect(resolved.ambiguousDates).toHaveLength(0)

    // Now a trip that spans both readings. It must not pick.
    const ambiguous = parseItinerary('03/08/2026 game drive', {
      startDate: '2026-03-01',
      endDate: '2026-08-31',
    })
    expect(ambiguous.days).toHaveLength(0)
    expect(ambiguous.ambiguousDates[0]?.readings).toHaveLength(2)
  })

  it('reports nothing found rather than a hopeful reading', () => {
    const proposal = parseItinerary(
      'Terms and conditions apply. Please retain this for your records.',
      TRIP,
    )
    expect(proposal.empty).toBe(true)
    expect(proposal.days).toHaveLength(0)
  })

  it('is empty for empty input', () => {
    expect(parseItinerary('', TRIP).empty).toBe(true)
    expect(parseItinerary('   \n \n ', TRIP).empty).toBe(true)
  })

  /*
   * Without word boundaries "gym" fires on "Gymnasium Street" and "spa" on
   * "Spain" — matches that put a workout outfit on a city break and cannot be
   * explained afterwards.
   */
  it('does not match an activity inside an unrelated word', () => {
    const proposal = parseItinerary('2 August 2026 — dinner on Gymnasiumstrasse in Spain', TRIP)
    const tags = proposal.activities.map((a) => a.tag)
    expect(tags).not.toContain('gym')
    expect(tags).not.toContain('swimming')
  })

  it('infers the trip dates from the itinerary when none were given', () => {
    const proposal = parseItinerary(
      ['1 August 2026 arrive', '2 August 2026 game drive', '8 August 2026 fly home'].join('\n'),
      {},
    )
    expect(proposal.startDate).toBe('2026-08-01')
    expect(proposal.endDate).toBe('2026-08-08')
  })
})

describe('reading a web page', () => {
  it('strips the markup and keeps the itinerary', () => {
    const html = `
      <html><head><style>.x{color:red}</style><script>var d="2020-01-01"</script></head>
      <body><h1>Your trip</h1><p>2 August 2026 — game drive</p>
      <p>4 August 2026 — wine tasting at the vineyard</p></body></html>
    `
    const extraction = extractHtmlText(html)
    expect(extraction.ok).toBe(true)

    // The script's date must not survive into the reading.
    expect(extraction.text).not.toContain('2020-01-01')

    const proposal = parseItinerary(extraction.text, TRIP)
    expect(proposal.days.map((d) => d.activityTag)).toEqual(['safari', 'winery'])
  })

  /*
   * The realistic failure. Airline and hotel itinerary links are nearly all
   * behind a login, and a login page comes back with a perfectly ordinary 200 —
   * so "no itinerary found" would be a misleading way to describe it.
   */
  it('recognises a sign-in page instead of reporting an empty itinerary', () => {
    const html = `
      <html><body><h1>Sign in to your account</h1>
      <p>Please enter your password to view this booking. Create an account if you do not have one.</p>
      <p>Need help signing in? Contact us at any time for assistance with your reservation.</p>
      </body></html>
    `
    const extraction = extractHtmlText(html)
    expect(extraction.ok).toBe(false)
    expect(extraction.problem).toContain('sign-in page')
  })

  it('reports a page with no text rather than returning nothing quietly', () => {
    expect(extractHtmlText('<html><body><div></div></body></html>').ok).toBe(false)
  })
})
