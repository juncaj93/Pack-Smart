import type { TripInput } from '@shared/trips'
import type { TestDatabase } from './d1'

/**
 * The wardrobe and the trip that the outfit tests plan against.
 *
 * Shared rather than copied because two files now need the same starting point,
 * and a wardrobe that drifts between them would make one of them quietly test a
 * different product. Twelve days in Cape Town with a safari and nice dinners is
 * the shape doc 04 was written about: several occasions, one trip, garments that
 * only suit some of them.
 */

export const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari', 'nice_dinner'],
  international: true,
  laundryAvailable: false,
  flightHours: 15,
}

export function garment(
  db: TestDatabase,
  overrides: {
    id?: string
    name: string
    subcategory: string
    dressiness?: number | null
    warmth?: number | null
    uses?: string[]
    favorite?: boolean
    reuseCapacity?: number | null
  },
): string {
  const id = overrides.id ?? crypto.randomUUID()
  const category =
    overrides.subcategory === 'Shoes' || overrides.subcategory === 'Sandals'
      ? 'Footwear'
      : ['Pants', 'Shorts', 'Swimwear'].includes(overrides.subcategory)
        ? 'Bottoms & Swimwear'
        : 'Tops & Outerwear'

  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, subcategory, color, pattern, brand,
                         notes, favorite, usage_frequency, warmth, dressiness, weather_tags,
                         typical_uses, reuse_capacity, owned_quantity, is_critical,
                         requires_final_check, default_packing_timing, always_include,
                         never_include, archived_at, source, created_at, updated_at)
       VALUES (?,'clothing',?,?,?,NULL,NULL,NULL,NULL,?,'sometimes',?,?,NULL,?,?,NULL,
               0,0,'anytime',0,0,NULL,'seed_import',1,1)`,
    )
    .run(
      id, overrides.name, category, overrides.subcategory,
      overrides.favorite ? 1 : 0,
      overrides.warmth ?? null,
      overrides.dressiness ?? 1,
      JSON.stringify(overrides.uses ?? ['casual']),
      overrides.reuseCapacity ?? null,
    )
  return id
}

export function seedWardrobe(db: TestDatabase) {
  return {
    tee: garment(db, { id: 'tee', name: 'Grey Tee', subcategory: 'T-Shirt' }),
    tee2: garment(db, { id: 'tee2', name: 'Navy Tee', subcategory: 'T-Shirt' }),
    tee3: garment(db, { id: 'tee3', name: 'Olive Tee', subcategory: 'T-Shirt' }),
    // Enough tops to actually dress a twelve-day trip. A t-shirt is worn once,
    // so a short wardrobe leaves days genuinely uncovered — which the planner
    // reports rather than papers over.
    tee4: garment(db, { id: 'tee4', name: 'Black Tee', subcategory: 'T-Shirt' }),
    tee5: garment(db, { id: 'tee5', name: 'White Tee', subcategory: 'T-Shirt' }),
    tee6: garment(db, { id: 'tee6', name: 'Red Tee', subcategory: 'T-Shirt' }),
    tee7: garment(db, { id: 'tee7', name: 'Blue Tee', subcategory: 'T-Shirt' }),
    tee8: garment(db, { id: 'tee8', name: 'Green Tee', subcategory: 'T-Shirt' }),
    tee9: garment(db, { id: 'tee9', name: 'Brown Tee', subcategory: 'T-Shirt' }),
    tee10: garment(db, { id: 'tee10', name: 'Tan Tee', subcategory: 'T-Shirt' }),
    tee11: garment(db, { id: 'tee11', name: 'Rust Tee', subcategory: 'T-Shirt' }),
    jeans: garment(db, { id: 'jeans', name: 'Blue Jeans', subcategory: 'Pants' }),
    shorts: garment(db, { id: 'shorts', name: 'Grey Shorts', subcategory: 'Shorts' }),
    // Trousers are worn three times each, so twelve days needs four pairs.
    cargo: garment(db, { id: 'cargo', name: 'Cargo Pants', subcategory: 'Pants' }),
    shirt: garment(db, {
      id: 'shirt', name: 'White Oxford', subcategory: 'Shirt',
      dressiness: 3, uses: ['dressy'], favorite: true,
    }),
    pants: garment(db, { id: 'pants', name: 'Khaki Chinos', subcategory: 'Pants' }),
    dressPants: garment(db, {
      id: 'dress-pants', name: 'Charcoal Trousers', subcategory: 'Pants',
      dressiness: 3, uses: ['dressy'],
    }),
    shoes: garment(db, { id: 'shoes', name: 'Walking Shoes', subcategory: 'Shoes' }),
    dressShoes: garment(db, {
      id: 'dress-shoes', name: 'Leather Loafers', subcategory: 'Shoes',
      dressiness: 3, uses: ['dressy'],
    }),
  }
}
