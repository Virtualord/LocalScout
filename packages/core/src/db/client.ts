import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema.js';

export type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export interface DbOptions {
  /** Absolute or relative path. Use `:memory:` for a throwaway database. */
  url: string;
}

export interface Db {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  close(): void;
}

/**
 * Open the database and apply the pragmas this app depends on.
 *
 * - `foreign_keys` must be on per connection; SQLite defaults it off, so the
 *   `onDelete: 'cascade'` rules in the schema would otherwise never fire.
 * - `journal_mode = WAL` lets the API read while a run writes, which is what
 *   makes the SSE progress view usable during a long run.
 * - `busy_timeout` stops a concurrent write from failing instantly.
 */
export function openDb(options: DbOptions): Db {
  const { url } = options;

  if (url !== ':memory:') {
    mkdirSync(dirname(url), { recursive: true });
  }

  const sqlite = new Database(url);

  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  if (url !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    close: () => {
      if (sqlite.open) sqlite.close();
    },
  };
}

/** True when the connection can answer a trivial query. Used by `/api/health`. */
export function pingDb(sqlite: Database.Database): boolean {
  try {
    sqlite.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

export { schema };
