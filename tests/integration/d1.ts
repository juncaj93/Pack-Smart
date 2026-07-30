import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * A real SQLite database behind the D1 interface, for tests that must prove
 * behaviour rather than assert against a stub.
 *
 * `tests/unit/worker/fake-d1.ts` answers three hand-written queries and throws on
 * everything else — deliberately, so an unnoticed query cannot silently no-op.
 * That is the wrong tool for the packing engine, where the thing under test IS
 * the SQL: real inserts, real CHECK constraints, real foreign keys, and the
 * actual migration files applied in order.
 *
 * D1 is SQLite, so this runs the same statements the Worker will run in
 * production. What it does not reproduce is D1's network behaviour and its CPU
 * accounting — neither of which affects whether the checklist comes out right.
 *
 * `node:sqlite` is built into Node 22, so this costs no dependency.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'migrations')

export interface TestDatabase {
  binding: D1Database
  raw: DatabaseSync
  close(): void
}

function statementFor(db: DatabaseSync, sql: string) {
  let bound: unknown[] = []

  const statement = {
    bind(...args: unknown[]) {
      bound = args.map((value) => {
        // D1 rejects undefined; surfacing it here as a loud failure beats
        // silently writing NULL and passing a test the Worker would fail.
        if (value === undefined) {
          throw new Error(`bound undefined parameter in: ${sql}`)
        }
        // node:sqlite has no boolean type. Every column in this schema stores
        // 0/1, so a stray boolean is a bug worth converting loudly rather than
        // crashing on — but the repos already bind numbers.
        if (typeof value === 'boolean') return value ? 1 : 0
        return value
      })
      return statement
    },

    async first<T>(): Promise<T | null> {
      const row = db.prepare(sql).get(...(bound as never[]))
      return (row as T) ?? null
    },

    async all<T>(): Promise<{ results: T[]; success: true }> {
      const rows = db.prepare(sql).all(...(bound as never[]))
      return { results: rows as T[], success: true }
    },

    /*
     * `meta.changes` is part of D1's contract and the harness used to omit it.
     *
     * A repo that asks "did that actually change a row?" — the honest way to
     * report "nothing to disable" rather than claiming a change that did not
     * happen — got `undefined`, read it as zero, and reported failure on a
     * successful write. The test failed and the production code was right, which
     * is the wrong way round.
     */
    async run() {
      const result = db.prepare(sql).run(...(bound as never[]))
      return {
        success: true,
        meta: {
          changes: Number(result.changes ?? 0),
          last_row_id: Number(result.lastInsertRowid ?? 0),
        },
      }
    },
  }

  return statement
}

/**
 * `D1Database.batch` — one round trip for many statements.
 *
 * The harness lacked it, so the first repo to reach for a real D1 API that the
 * rest of the codebase happened not to use failed with "db.batch is not a
 * function". That is a gap in the harness, not a reason to write slower repo
 * code: on the Worker's 10ms CPU budget, fifteen sequential round trips to
 * write one outfit's pairings is exactly what `batch` exists to avoid.
 *
 * D1 runs a batch in an implicit transaction, so this does too — a half-applied
 * batch would leave the pairing ledger disagreeing with the approvals that
 * produced it, which is the one thing those counts must never do.
 */
async function runBatch(
  db: DatabaseSync,
  statements: Array<{ run(): Promise<{ success: true }> }>,
): Promise<Array<{ success: true }>> {
  db.exec('BEGIN')
  try {
    const results = []
    for (const statement of statements) results.push(await statement.run())
    db.exec('COMMIT')
    return results
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** The migration files, in the order wrangler applies them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

export function applyMigration(db: DatabaseSync, file: string): void {
  db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
}

export interface TestDatabaseOptions {
  /**
   * Stop after this migration, so a test can stand a database up as it exists
   * in production TODAY and then apply the new one to it.
   *
   * A migration that only ever runs against an empty schema is a migration
   * nobody has tested — the rows it has to survive are the ones that were there
   * before it.
   */
  upTo?: string
}

export function createTestDatabase(options: TestDatabaseOptions = {}): TestDatabase {
  const db = new DatabaseSync(':memory:')

  // Foreign keys are off by default in SQLite. Turning them on means a test
  // catches an orphaned checklist row instead of happily storing one.
  db.exec('PRAGMA foreign_keys = ON')

  for (const file of migrationFiles()) {
    applyMigration(db, file)
    if (options.upTo && file === options.upTo) break
  }

  const binding = {
    prepare: (sql: string) => statementFor(db, sql),
    batch: (statements: Array<{ run(): Promise<{ success: true }> }>) => runBatch(db, statements),
  } as unknown as D1Database

  return {
    binding,
    raw: db,
    close: () => db.close(),
  }
}

/** Inserts a catalog item with sensible defaults, returning its id. */
export function insertItem(
  db: TestDatabase,
  overrides: Partial<{
    id: string
    kind: string
    displayName: string
    category: string
    isCritical: boolean
    requiresFinalCheck: boolean
    defaultPackingTiming: string
    alwaysInclude: boolean
    neverInclude: boolean
    archivedAt: number | null
  }> = {},
): string {
  const id = overrides.id ?? crypto.randomUUID()
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, subcategory, color, pattern, brand,
                         notes, favorite, usage_frequency, warmth, dressiness, weather_tags,
                         typical_uses, reuse_capacity, owned_quantity, is_critical,
                         requires_final_check, default_packing_timing, always_include,
                         never_include, archived_at, source, created_at, updated_at)
       VALUES (?,?,?,?,NULL,NULL,NULL,NULL,NULL,0,'sometimes',NULL,NULL,NULL,NULL,NULL,NULL,
               ?,?,?,?,?,?,'manual',1,1)`,
    )
    .run(
      id,
      overrides.kind ?? 'gear',
      overrides.displayName ?? 'Item',
      overrides.category ?? 'Travel Gear',
      overrides.isCritical ? 1 : 0,
      overrides.requiresFinalCheck ? 1 : 0,
      overrides.defaultPackingTiming ?? 'anytime',
      overrides.alwaysInclude ? 1 : 0,
      overrides.neverInclude ? 1 : 0,
      overrides.archivedAt ?? null,
    )
  return id
}

/** Attaches a packing rule to an item. */
export function insertRule(
  db: TestDatabase,
  itemId: string,
  rule: Partial<{
    ruleType: string
    quantityValue: number | null
    buffer: number | null
    condition: unknown
    dependsOnItemId: string | null
    enabled: boolean
    originalText: string | null
    /** Defaults to `system`, which is what everything seeded or imported is. */
    source: string
    /** The default this rule replaces. Set it to write an override by hand. */
    supersedesRuleId: string | null
  }>,
): string {
  const id = crypto.randomUUID()
  db.raw
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                 depends_on_item_id, enabled, original_text, needs_review,
                                 source, supersedes_rule_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,?,?,1)`,
    )
    .run(
      id,
      itemId,
      rule.ruleType ?? 'fixed_per_trip',
      rule.quantityValue ?? null,
      rule.buffer ?? null,
      rule.condition ? JSON.stringify(rule.condition) : null,
      rule.dependsOnItemId ?? null,
      rule.enabled === false ? 0 : 1,
      rule.originalText ?? null,
      rule.source ?? 'system',
      rule.supersedesRuleId ?? null,
    )
  return id
}

/**
 * The rule actually in force for an id — the override, when Alex has written
 * one.
 *
 * Tests that used to read the row back by id are asserting the wrong thing
 * since migration 0011: editing a default writes a copy that replaces it and
 * leaves the default alone, so the original row still holds the original
 * number. That is the point, and this is how a test says "what will the packing
 * list use" rather than "what is in that particular row".
 */
export function effectiveRule(
  db: TestDatabase,
  ruleId: string,
): {
  id: string
  rule_type: string
  quantity_value: number | null
  condition_json: string | null
  enabled: number
  needs_review: number
  source: string
} {
  const override = db.raw
    .prepare('SELECT * FROM packing_rule WHERE supersedes_rule_id = ?')
    .get(ruleId) as Record<string, never> | undefined

  return (override ??
    db.raw.prepare('SELECT * FROM packing_rule WHERE id = ?').get(ruleId)) as never
}
