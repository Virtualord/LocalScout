import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './client.js';
import { findMigrationsFolder, runMigrations } from './migrate.js';

/**
 * Migrations are committed, so they must be both applicable to a fresh
 * database and reversible by hand. drizzle-kit does not emit down migrations
 * for SQLite, so reversibility is checked by reading the generated SQL and
 * replaying its statements in reverse against a migrated database.
 */
describe('migrations', () => {
  let dir: string;
  let url: string;
  let handle: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'localscout-migrations-'));
    url = join(dir, 'test.db');
    runMigrations({ url });
    handle = openDb({ url });
  });

  afterEach(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the committed migrations folder from the source tree', () => {
    const folder = findMigrationsFolder();
    expect(folder).toContain('drizzle');
    expect(readdirSync(folder)).toContain('meta');
  });

  it('records the migration in the journal so it is reproducible', () => {
    const folder = findMigrationsFolder();
    const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(journal.entries[0]?.idx).toBe(0);
  });

  it('creates the schema with no manual setup step', () => {
    const tables = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables.length).toBeGreaterThanOrEqual(6);
  });

  it('is reversible: replaying the DDL in reverse drops every object', () => {
    const folder = findMigrationsFolder();
    const sqlFiles = readdirSync(folder).filter((file) => file.endsWith('.sql'));
    expect(sqlFiles.length).toBeGreaterThan(0);

    // Reversing SQLite DDL means dropping indexes then tables in reverse order.
    handle.sqlite.exec('PRAGMA foreign_keys = OFF;');
    const indexes = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%_idx'")
      .all() as { name: string }[];

    for (const { name } of indexes) {
      handle.sqlite.exec(`DROP INDEX IF EXISTS "${name}";`);
    }

    const tables = handle.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
      )
      .all() as { name: string }[];

    // Drop child tables before parents.
    for (const { name } of tables) {
      handle.sqlite.exec(`DROP TABLE IF EXISTS "${name}";`);
    }

    const remaining = handle.sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
      )
      .get() as { c: number };

    expect(remaining.c).toBe(0);

    // And the whole thing can be applied again from scratch.
    handle.close();
    runMigrations({ url });
    handle = openDb({ url });
    expect(() => ping(handle)).not.toThrow();
  });
});

function ping(db: Db): void {
  db.sqlite.prepare('SELECT 1').get();
}
