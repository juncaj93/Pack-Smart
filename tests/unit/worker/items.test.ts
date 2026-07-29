import { describe, expect, it } from 'vitest'
import {
  ALL_CATEGORIES,
  CLOTHING_CATEGORIES,
  categoryKind,
  defaultsForCategory,
  validateItemInput,
} from '@shared/items'

describe('item validation', () => {
  const valid = { displayName: 'Black Zip-Up', category: 'Tops & Outerwear' }

  it('accepts a name and category alone', () => {
    // Product doc 05 §8: saving must not require all optional data.
    expect(validateItemInput(valid).ok).toBe(true)
  })

  it('requires a name', () => {
    expect(validateItemInput({ ...valid, displayName: '   ' }).errors.displayName).toBeTruthy()
  })

  it('requires a category Pack Smart actually knows', () => {
    expect(validateItemInput({ ...valid, category: 'Hats & Nonsense' }).errors.category).toBeTruthy()
    expect(validateItemInput({ ...valid, category: '' }).errors.category).toBeTruthy()
  })

  it('rejects out-of-range warmth and dressiness', () => {
    expect(validateItemInput({ ...valid, warmth: 9 }).errors.warmth).toBeTruthy()
    expect(validateItemInput({ ...valid, dressiness: -1 }).errors.dressiness).toBeTruthy()
  })

  it('rejects a fractional owned quantity', () => {
    expect(validateItemInput({ ...valid, ownedQuantity: 2.5 }).errors.ownedQuantity).toBeTruthy()
    expect(validateItemInput({ ...valid, ownedQuantity: 15 }).ok).toBe(true)
  })

  it('accepts every category it offers', () => {
    for (const category of ALL_CATEGORIES) {
      expect(validateItemInput({ ...valid, category }).ok, category).toBe(true)
    }
  })
})

describe('category classification', () => {
  it('treats the four wardrobe buckets as clothing and the rest as gear', () => {
    for (const c of CLOTHING_CATEGORIES) expect(categoryKind(c)).toBe('clothing')
    expect(categoryKind('Medication')).toBe('gear')
    expect(categoryKind('Documents')).toBe('gear')
  })
})

describe('category defaults', () => {
  it('marks medication and documents critical and final-check by default', () => {
    // Product doc 03 §8's critical set — these are the ones a forgotten item ruins.
    expect(defaultsForCategory('Medication')).toMatchObject({
      isCritical: true,
      requiresFinalCheck: true,
    })
    expect(defaultsForCategory('Documents')).toMatchObject({
      isCritical: true,
      requiresFinalCheck: true,
    })
  })

  it('gives footwear effectively unlimited reuse and undergarments none', () => {
    // Product doc 04 §6: shoes are reused freely, socks and underwear are not.
    expect(defaultsForCategory('Footwear').reuseCapacity).toBeGreaterThan(10)
    expect(defaultsForCategory('Accessories & Undergarments').reuseCapacity).toBe(1)
  })

  it('never marks a garment critical by default', () => {
    for (const c of CLOTHING_CATEGORIES) {
      expect(defaultsForCategory(c).isCritical).toBeUndefined()
    }
  })
})
