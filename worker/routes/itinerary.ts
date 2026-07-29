import { Hono } from 'hono'
import { extractHtmlText, extractPdfText } from '@shared/extract-text'
import { parseItinerary, type ItineraryProposal } from '@shared/itinerary'
import { apiError } from '../auth'
import type { AppBindings } from '../env'

export const itineraryRoutes = new Hono<AppBindings>()

/**
 * Reading an itinerary — text, a link, or a PDF.
 *
 * All three end at the same `parseItinerary`. This file only turns the input
 * into text and says honestly when it could not (product doc 02 §5 Step 3).
 *
 * Nothing here writes to the database. Reading an itinerary produces a PROPOSAL
 * and stops; applying it is a separate, explicit act on the trip. Keeping the
 * two apart is what makes "infer, then confirm" structural rather than a habit.
 */

/** Beyond this, it is not an itinerary — it is a book, and it will not parse usefully. */
const MAX_TEXT_BYTES = 400_000
const MAX_PDF_BYTES = 8_000_000
const FETCH_TIMEOUT_MS = 6_000

interface ParseResponse {
  proposal: ItineraryProposal
  source: 'text' | 'link' | 'pdf'
  problem: string | null
}

function readingOf(
  source: ParseResponse['source'],
  text: string,
  options: { startDate?: string | null; endDate?: string | null },
): ParseResponse {
  const proposal = parseItinerary(text, options)
  return {
    proposal,
    source,
    problem: proposal.empty
      ? 'Nothing recognisable was found — no dates and no activities. Check it is the itinerary rather than a booking confirmation.'
      : null,
  }
}

itineraryRoutes.post('/parse', async (c) => {
  const contentType = c.req.header('content-type') ?? ''

  /* ---------------- PDF ---------------- */
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData().catch(() => null)
    const file = form?.get('file')

    if (!(file instanceof File)) {
      return c.json(apiError('bad_request', 'No file was attached.'), 400)
    }
    if (file.size > MAX_PDF_BYTES) {
      return c.json(apiError('bad_request', 'That PDF is too large to read.'), 400)
    }

    const extraction = await extractPdfText(new Uint8Array(await file.arrayBuffer()))
    if (!extraction.ok) {
      return c.json(apiError('bad_request', extraction.problem ?? 'That PDF could not be read.'), 400)
    }

    const query = c.req.query()
    return c.json(readingOf('pdf', extraction.text, {
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
    }))
  }

  /* ---------------- text or link ---------------- */
  const body = await c.req
    .json<{ text?: string; url?: string; startDate?: string | null; endDate?: string | null }>()
    .catch(() => ({}) as Record<string, never>)

  const options = { startDate: body.startDate ?? null, endDate: body.endDate ?? null }

  if (typeof body.text === 'string' && body.text.trim()) {
    if (body.text.length > MAX_TEXT_BYTES) {
      return c.json(apiError('bad_request', 'That is far more text than an itinerary.'), 400)
    }
    return c.json(readingOf('text', body.text, options))
  }

  if (typeof body.url === 'string' && body.url.trim()) {
    let url: URL
    try {
      url = new URL(body.url.trim())
    } catch {
      return c.json(apiError('bad_request', 'That does not look like a link.'), 400)
    }

    /*
     * Only http and https, and only public hosts.
     *
     * A Worker fetch runs on Cloudflare's network, not Alex's, so this cannot
     * reach his home router — but `file:` and `data:` URLs are worth refusing on
     * principle, and refusing them here is cheaper than reasoning about what the
     * runtime happens to allow.
     */
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return c.json(apiError('bad_request', 'Only web links can be read.'), 400)
    }

    let response: Response
    try {
      response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: 'text/html,application/pdf,text/plain' },
        redirect: 'follow',
      })
    } catch {
      return c.json(
        apiError('bad_request', 'That page could not be reached. Open it yourself and paste the text.'),
        400,
      )
    }

    if (!response.ok) {
      return c.json(
        apiError('bad_request', `That page answered ${response.status}. Open it yourself and paste the text.`),
        400,
      )
    }

    const type = response.headers.get('content-type') ?? ''

    // A link straight to a PDF is common enough to be worth handling.
    if (type.includes('application/pdf')) {
      const extraction = await extractPdfText(new Uint8Array(await response.arrayBuffer()))
      if (!extraction.ok) {
        return c.json(apiError('bad_request', extraction.problem ?? 'That PDF could not be read.'), 400)
      }
      return c.json(readingOf('link', extraction.text, options))
    }

    const raw = await response.text()
    const extraction = type.includes('text/plain')
      ? { text: raw, ok: raw.trim().length > 0, problem: null as string | null }
      : extractHtmlText(raw)

    if (!extraction.ok) {
      return c.json(apiError('bad_request', extraction.problem ?? 'That page could not be read.'), 400)
    }

    return c.json(readingOf('link', extraction.text, options))
  }

  return c.json(apiError('bad_request', 'Paste some text, a link, or attach a PDF.'), 400)
})
