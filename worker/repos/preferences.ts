/**
 * The `preference` table, read and written through one pair of functions.
 *
 * The table has existed since migration 0002 and until now nothing in the Worker
 * wrote to it: the only values in it were seeded by migration, and the one
 * reader — `enginePreferences` in `repos/outfits.ts` — carries its own SQL. That
 * was fine while there was exactly one reader. It stops being fine the moment a
 * second feature needs a durable scalar, which is what the home location is.
 *
 * `enginePreferences` is deliberately NOT refactored onto this. It works, it is
 * on the outfit planner's critical path, and moving it would put an unrelated
 * change in a pass about the Home screen. It should move later.
 */

/**
 * Reads a stored preference, treating anything unreadable as absent.
 *
 * A corrupt `value_json` returns null rather than throwing, which is the rule
 * `enginePreferences` already follows: a preference that cannot be parsed is a
 * preference nobody set, and it must never be the reason a screen fails to load.
 */
export async function getPreference<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db
    .prepare('SELECT value_json FROM preference WHERE key = ?')
    .bind(key)
    .first<{ value_json: string }>()

  if (!row) return null

  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return null
  }
}

/** Writes one, replacing whatever was there. */
export async function setPreference(
  db: D1Database,
  key: string,
  value: unknown,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO preference (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                        updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), now)
    .run()
}

/** The two keys this pass introduces, named once so a typo cannot split them. */
export const HOME_LOCATION_KEY = 'home_location'
export const HOME_WEATHER_KEY = 'home_weather'
