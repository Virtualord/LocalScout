import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit reads this to generate migrations.
 *
 * Migrations are committed, so they are reproducible for everyone. Regenerate
 * after editing `src/db/schema.ts` with `pnpm db:generate`.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? './data/localscout.db',
  },
  verbose: true,
  strict: true,
});
