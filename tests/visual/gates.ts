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
