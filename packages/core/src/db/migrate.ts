import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/env.js';
import { openDb } from './client.js';

export interface MigrateOptions {
  /** Where the SQLite file lives. */
  url: string;
  /** Directory holding the generated `drizzle` folder. */
  migrationsFolder?: string;
}

/**
 * Locate the generated migrations.
 *
 * The compiled app lives in `dist/`, while the migrations are committed at the
 * package root, so the default walks up from this module until it finds a
 * `drizzle` folder that exists.
 */
export function findMigrationsFolder(startDir?: string): string {
  const start = startDir ?? dirname(fileURLToPath(import.meta.url));

  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, 'drizzle');
    if (existsSync(join(candidate, 'meta', '_journal.json'))) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    `Could not find the drizzle migrations folder starting from ${start}. Run "pnpm db:generate" first.`,
  );
}

/** Apply pending migrations. Safe to call on every boot. */
export function runMigrations(options: MigrateOptions): void {
  const migrationsFolder = options.migrationsFolder ?? findMigrationsFolder();
  const { db, close } = openDb({ url: options.url });

  try {
    migrate(db, { migrationsFolder });
  } finally {
    close();
  }
}

// Executed directly: `pnpm db:migrate`.
const isDirectRun = process.argv[1] !== undefined && process.argv[1].endsWith('migrate.ts');

if (isDirectRun) {
  const config = loadConfig();
  const url = join(config.app.dataDir, 'localscout.db');
  runMigrations({ url });
  // eslint-disable-next-line no-console
  console.log(`Migrations applied to ${url}`);
}
