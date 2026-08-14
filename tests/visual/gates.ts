import { mkdirSync, writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

/**
 * The mechanical half of `VISUAL_ACCEPTANCE.md` §1.
 *
 * These are the rules a screenshot review keeps missing: a 38px control and a
 * 44px one look identical in an image, and a two-pixel horizontal overflow is
 * invisible until a thumb finds it. So they are measured, on every captured
 * state, at every width.
 *
 * Violations are COLLECTED rather than thrown. A run that stops at the first
 * failure produces one finding and no screenshots; the point of this harness is
 * to produce the whole list plus the evidence, and then fail once at the end.
 */

export const WIDTHS = [360, 375, 390, 430] as const
export const OUT_DIR = '.visual'

export interface Violation {
  screen: string
  width: number
  rule: string
  detail: string
}

const violations: Violation[] = []

export function record(screen: string, width: number, rule: string, detail: string): void {
  violations.push({ screen, width, rule, detail })
}

export function collected(): Violation[] {
  return violations
}

export function writeReport(): void {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(`${OUT_DIR}/report.json`, `${JSON.stringify(violations, null, 2)}\n`)

  const lines = violations.map((v) => `${v.screen} @${v.width}  ${v.rule}: ${v.detail}`)
  writeFileSync(`${OUT_DIR}/report.txt`, `${lines.join('\n')}\n`)
}

/**
 * Captures one state at every width, running the gates at each.
 *
 * Screenshot first, measure second, so the evidence exists even for a state that
 * violates something.
 */
/**
 * Focus must not escape an open sheet.
 *
 * Behavioural rather than structural: the elements behind a modal stay focusable
 * in the DOM, and that is fine — what matters is whether Tab can reach them. So
 * this presses Tab further than any sheet has controls and checks where focus
 * actually landed. Measuring the DOM instead reported every sheet in the product
 * as broken while the trap was working correctly.
 */
export async function assertFocusStaysInSheet(page: Page, screen: string): Promise<void> {
  const escaped = await page.evaluate(async () => {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return 'no sheet open'
    return null
  })
  if (escaped) {
    record(screen, 0, 'no-sheet-open', escaped)
    return
  }

  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab')
    const outside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const active = document.activeElement
      if (!dialog || !active || active === document.body) return null
      return dialog.contains(active)
        ? null
        : (active.getAttribute('aria-label') ?? active.textContent ?? active.tagName)
            .trim()
            .slice(0, 40)
    })
    if (outside) {
      record(screen, 0, 'focus-escaped-sheet', `Tab ${i + 1} reached "${outside}"`)
      return
    }
  }
}

/** How long a sheet takes to slide up (`--duration-sheet`), plus a frame. */
const SHEET_SLIDE_MS = 300

/**
 * What each control in the open sheet is, and where its top edge is.
 *
 * Keyed by accessible name rather than by position, so a control is compared
 * with ITSELF across the two samples and a list arriving in between does not
 * make every row look like it moved. Controls whose name is not unique in the
 * sheet are dropped rather than guessed at.
 */
async function sampleSheet(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return {}

    const out: Record<string, number> = {}
    const seen = new Set<string>()
    out['the sheet itself'] = Math.round(dialog.getBoundingClientRect().top)

    for (const el of Array.from(dialog.querySelectorAll('button, a[href], input, textarea'))) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      const name = (
        el.getAttribute('aria-label') ??
        (el as HTMLInputElement).placeholder ??
        el.textContent ??
        ''
      )
        .trim()
        .slice(0, 40)
      if (!name) continue
      if (seen.has(name)) {
        delete out[name]
        continue
      }
      seen.add(name)
      out[name] = Math.round(rect.top)
    }
    return out
  })
}

/**
 * Nothing Alex can already touch may move once the sheet's content lands.
 *
 * ## The defect this is for
 *
 * A sheet is `position: fixed; bottom: 0` and sizes to its content, so it grows
 * UPWARD. A sheet opened before its list has arrived is short — a search field,
 * one action, the word "Loading…" — and leaps when the reply comes back. Alex
 * reported it from his phone: he tapped `Add a rule` on the packing-rules sheet
 * and a rule 278px further down turned off instead. Measured at the time:
 *
 *     Add to this trip 419->100, Your usual amounts 414->117,
 *     Packing rules 378->100, One last look 513->427
 *
 * The touch-target gate above cannot see this. A control can be a comfortable
 * 44x44 and correctly painted and still be somewhere else by the time the tap
 * resolves, and a screenshot of the settled sheet shows nothing wrong at all.
 * What makes it dangerous rather than merely annoying is that the wrong tap is
 * SILENT — a packing rule switches off with no undo bar and nothing on screen
 * to say so, and Alex finds out when something is missing from his bag.
 *
 * ## Why the API is deliberately slowed
 *
 * Against a local preview the reply lands in single-digit milliseconds — inside
 * the sheet's own slide-up — so the loading state never renders and the gate
 * could not fail even with the bug present. AUTONOMY §8: a check that cannot
 * fail is not evidence. The route delay below is what makes the phone's timing
 * reproducible on this machine.
 *
 * Call it with the action that OPENS the sheet; it owns the waiting.
 */
export async function assertSheetHoldsStill(
  page: Page,
  screen: string,
  openSheet: () => Promise<void>,
): Promise<void> {
  const DELAY_MS = 700
  /* 2px, not 0: a sub-pixel row height can round a stable edge by one. */
  const TOLERANCE = 2

  /*
   * `fallback`, not `continue`. This handler is registered last and therefore
   * runs FIRST, so continuing here would swallow a caller's own stub for the
   * same URL — which is how the review-banner case silently measured a sheet
   * with no banner in it.
   */
  /** Replies handed to the page since the sheet was asked to open. */
  let delivered = 0

  await page.route('**/api/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
    await route.fallback()
    delivered += 1
  })

  try {
    await openSheet()
    // After the slide-up, so the transform is done — but well before the reply,
    // which is the window in which the sheet is touchable and still wrong.
    await page.waitForTimeout(SHEET_SLIDE_MS)

    /*
     * Proof that this measurement happened in the window it is about.
     *
     * Without it the whole check passes vacuously whenever the reply beats the
     * first sample: `before` and `after` are then two photographs of the same
     * settled sheet, and they agree perfectly. That is not a hypothetical — it
     * is what this gate did on its first run, because `page.route` cannot see a
     * request the service worker makes and every sheet answered from cache in
     * single-digit milliseconds. Three of the four reported themselves stable
     * with the bug still in the build.
     *
     * So the timing is asserted rather than assumed. If the delay stops biting
     * — a service worker creeps back in, a caller stubs the route itself, a URL
     * moves out from under the pattern — this fails loudly instead of going
     * quietly green (AUTONOMY §8).
     */
    if (delivered > 0) {
      record(
        screen,
        0,
        'measurement-window-missed',
        `${delivered} repl${delivered === 1 ? 'y' : 'ies'} already delivered when the sheet was first measured — the loading state was never on screen, so this check proved nothing`,
      )
      return
    }

    const before = await sampleSheet(page)
    if (Object.keys(before).length === 0) {
      record(screen, 0, 'no-sheet-open', 'nothing to measure')
      return
    }

    await page.waitForTimeout(DELAY_MS + 700)
    const after = await sampleSheet(page)

    for (const [name, top] of Object.entries(before)) {
      const now = after[name]
      if (now === undefined) continue
      const moved = now - top
      if (Math.abs(moved) > TOLERANCE) {
        record(
          screen,
          0,
          'moves-under-the-thumb',
          `"${name}" moved ${moved}px when the content landed`,
        )
      }
    }
  } finally {
    await page.unroute('**/api/**')
  }
}

/*
 * The height Safari actually gives a page on an iPhone 14, once its own
 * toolbars are on screen. 844 is the SCREEN; a web page never gets all of it.
 *
 * These captures were taken at 844 until now, which showed 180px more of the
 * product than the phone does — so every "this fits on one screen" judgement
 * made from them was optimistic by most of a sheet. `devices['iPhone 14']` uses
 * 664 and so does CI.
 */
const FOLD = 664

export async function capture(page: Page, screen: string): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: FOLD })
    // Let the layout settle before measuring: a width change can reflow a row
    // from one line to two, which is exactly the case worth catching.
    await page.waitForTimeout(120)

    mkdirSync(`${OUT_DIR}/${width}`, { recursive: true })
    await page.screenshot({ path: `${OUT_DIR}/${width}/${screen}.png`, fullPage: false })
    await page.screenshot({ path: `${OUT_DIR}/${width}/${screen}.full.png`, fullPage: true })

    await runGates(page, screen, width)
  }

  await page.setViewportSize({ width: 390, height: FOLD })
}

async function runGates(page: Page, screen: string, width: number): Promise<void> {
  const found = await page.evaluate(() => {
    const out: Array<{ rule: string; detail: string }> = []
    const describe = (el: Element) => {
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)
      return name || el.className || el.tagName
    }

    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
      out.push({
        rule: 'horizontal-scroll',
        detail: `${document.documentElement.scrollWidth}px content in ${document.documentElement.clientWidth}px viewport`,
      })
    }

    for (const el of Array.from(document.querySelectorAll('button, a[href], [role="button"]'))) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.height < 44 || rect.width < 44) {
        out.push({
          rule: 'touch-target',
          detail: `${Math.round(rect.width)}x${Math.round(rect.height)} — ${describe(el)}`,
        })
      }
    }

    for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
      const size = Number.parseFloat(getComputedStyle(el).fontSize)
      if (size < 16) out.push({ rule: 'input-font-size', detail: `${size}px — ${describe(el)}` })
    }

    for (const el of Array.from(
      document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]'),
    )) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      const name = (
        el.getAttribute('aria-label') ??
        el.getAttribute('title') ??
        (el as HTMLInputElement).labels?.[0]?.textContent ??
        el.textContent ??
        ''
      ).trim()
      if (!name) out.push({ rule: 'no-accessible-name', detail: describe(el) })
    }

    /*
     * Nothing of ours pinned to the bottom edge: in Safari it lands on top of the
     * browser's own toolbar (`09_IMPLEMENTATION_NOTES.md` §12).
     *
     * Three deliberate exemptions, by kind rather than by loosening the rule, so
     * anything NEW that pins itself to that edge still fails:
     *  - the Undo bar and toasts, which appear for seconds and leave;
     *  - an open sheet, which is a modal surface and belongs on that edge;
     *  - a full-viewport backdrop, which touches the bottom only because it
     *    covers everything.
     */
    const dialog = document.querySelector('[role="dialog"]')
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const style = getComputedStyle(el)
      if (style.position !== 'fixed') continue
      if (el.classList.contains('undo-bar') || el.classList.contains('toast')) continue
      if (dialog && (el === dialog || dialog.contains(el) || el.contains(dialog))) continue

      const rect = el.getBoundingClientRect()
      if (rect.height === 0) continue
      const coversViewport = rect.top <= 1 && rect.height >= window.innerHeight - 1
      if (coversViewport) continue

      if (Math.abs(rect.bottom - window.innerHeight) <= 1) {
        out.push({ rule: 'fixed-to-bottom', detail: describe(el) })
      }
    }

    return out
  })

  for (const { rule, detail } of found) record(screen, width, rule, detail)
}
