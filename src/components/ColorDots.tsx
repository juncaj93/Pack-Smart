import { swatchesFor } from '@shared/colors'
import './ColorDots.css'

interface ColorDotsProps {
  /** The garment's colour string, exactly as it is stored. */
  color: string | null | undefined
  className?: string
}

/**
 * A garment's colour, as one or two small dots.
 *
 * ## Why this is `aria-hidden`
 *
 * It is a second rendering of a fact the row already states in words. Every
 * place these appear, the colour name is in the text beside them — `Top ·
 * Nordstrom · Navy` — so announcing "Navy colour" as well would read the same
 * word twice on every row of a list, which is how a screen reader becomes
 * unusable on a screen that is fine to look at.
 *
 * The text is the information and the dot is the accelerator, which is also why
 * the dot is never the only signal: a reader who cannot distinguish the fills
 * loses nothing at all.
 *
 * ## Why it renders nothing rather than a placeholder
 *
 * Eleven of the wardrobe's thirty-one colour strings are not colours —
 * `Custom Printed`, `Suede`, `Various Colors`. A grey placeholder dot on those
 * rows would be the interface claiming knowledge nobody has, and a "add a
 * colour" prompt would be a maintenance chore invented by a display feature.
 * The row simply has no dot.
 */
export function ColorDots({ color, className }: ColorDotsProps) {
  const swatches = swatchesFor(color)
  if (swatches.length === 0) return null

  return (
    <span className={`color-dots ${className ?? ''}`} aria-hidden="true">
      {swatches.map((swatch) => (
        <span
          key={swatch.family}
          className={`color-dot ${swatch.pale ? 'is-pale' : ''}`}
          style={{ background: swatch.hex }}
        />
      ))}
    </span>
  )
}
