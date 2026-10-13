import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { runs, type Language, type NewRun, type Run, type RunStatus } from '../schema.js';

/**
 * Run persistence.
 *
 * A run row is the durable record of one search: what was asked, what came
 * back, how long it took, and what it cost. The counters are updated as the
 * workflow progresses rather than derived at the end, so `/api/metrics` stays
 * correct even if a run is interrupted.
 */

export interface CreateRunInput {
  query: string;
  location: string;
  limit: number;
  language: Language;
}

export interface RunCounters {
  serpapiCalls?: number;
  leadsFound?: number;
  leadsNew?: number;
  auditsOk?: number;
  auditsFailed?: number;
  draftsLlm?: number;
  draftsFallback?: number;
  tokensIn?: number;
  tokensOut?: number;
}

/** The counter columns, keyed the same way {@link RunCounters} is. */
type CounterKey = keyof RunCounters;

export class RunRepository {
  constructor(private readonly handle: Db) {}

  private get db() {
    return this.handle.db;
  }

  async create(input: CreateRunInput): Promise<Run> {
    const row: NewRun = {
      id: randomUUID(),
      query: input.query,
      location: input.location,
      limit: input.limit,
      language: input.language,
      status: 'queued',
      startedAt: new Date(),
    };
    this.db.insert(runs).values(row).run();
    return this.requireById(row.id);
  }

  async byId(id: string): Promise<Run | undefined> {
    return this.db.select().from(runs).where(eq(runs.id, id)).get();
  }

  async requireById(id: string): Promise<Run> {
    const found = await this.byId(id);
    if (!found) throw new Error(`Run not found: ${id}`);
    return found;
  }

  async setStatus(id: string, status: RunStatus, error?: string): Promise<void> {
    this.db
      .update(runs)
      .set({
        status,
        ...(error !== undefined ? { error } : {}),
        ...(status === 'completed' || status === 'failed' || status === 'cancelled'
          ? { finishedAt: new Date() }
          : {}),
      })
      .where(eq(runs.id, id))
      .run();
  }

  /**
   * Increment counters.
   *
   * Implemented as a read-modify-write inside a transaction rather than
   * `set(col: sql\`col + n\`)`, because drizzle types the `sql` expression as
   * `SQL<unknown>` and rejects it against an integer column. Localscout has a
   * single writer, so the lost-update risk this introduces does not apply, and
   * the transaction keeps the counter consistent if a step throws midway.
   */
  async addCounters(id: string, counters: RunCounters): Promise<void> {
    const entries = Object.entries(counters).filter(
      (entry): entry is [CounterKey, number] => entry[1] !== undefined,
    );
    if (entries.length === 0) return;

    this.db.transaction((tx) => {
      const current = tx.select().from(runs).where(eq(runs.id, id)).get();
      if (!current) throw new Error(`Run not found: ${id}`);

      const patch: Partial<typeof runs.$inferInsert> = {};
      for (const [key, delta] of entries) {
        patch[key] = current[key] + delta;
      }

      tx.update(runs).set(patch).where(eq(runs.id, id)).run();
    });
  }

  async list(limit = 50): Promise<Run[]> {
    return this.db
      .select()
      .from(runs)
      .orderBy(desc(runs.createdAt), desc(sql`${runs}.rowid`))
      .limit(limit)
      .all();
  }

  async all(): Promise<Run[]> {
    return this.db
      .select()
      .from(runs)
      .orderBy(desc(runs.createdAt), desc(sql`${runs}.rowid`))
      .all();
  }

  /** The run currently marked running or queued, so only one can be active. */
  async activeRun(): Promise<Run | undefined> {
    const rows = this.db
      .select()
      .from(runs)
      .where(sql`${runs.status} in ('queued', 'running')`)
      .orderBy(desc(runs.createdAt))
      .all();
    return rows[0];
  }

  async total(): Promise<number> {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(runs)
      .get();
    return row?.count ?? 0;
  }

  /**
   * Aggregate counters across every run.
   *
   * Feeds `/api/metrics`, which the write-up quotes for cost per lead.
   */
  async totals(): Promise<{
    runs: number;
    serpapiCalls: number;
    leadsFound: number;
    leadsNew: number;
    auditsOk: number;
    auditsFailed: number;
    draftsLlm: number;
    draftsFallback: number;
    tokensIn: number;
    tokensOut: number;
  }> {
    const row = this.db
      .select({
        runs: sql<number>`count(*)`,
        serpapiCalls: sql<number>`coalesce(sum(${runs.serpapiCalls}), 0)`,
        leadsFound: sql<number>`coalesce(sum(${runs.leadsFound}), 0)`,
        leadsNew: sql<number>`coalesce(sum(${runs.leadsNew}), 0)`,
        auditsOk: sql<number>`coalesce(sum(${runs.auditsOk}), 0)`,
        auditsFailed: sql<number>`coalesce(sum(${runs.auditsFailed}), 0)`,
        draftsLlm: sql<number>`coalesce(sum(${runs.draftsLlm}), 0)`,
        draftsFallback: sql<number>`coalesce(sum(${runs.draftsFallback}), 0)`,
        tokensIn: sql<number>`coalesce(sum(${runs.tokensIn}), 0)`,
        tokensOut: sql<number>`coalesce(sum(${runs.tokensOut}), 0)`,
      })
      .from(runs)
      .get();

    return {
      runs: row?.runs ?? 0,
      serpapiCalls: Number(row?.serpapiCalls ?? 0),
      leadsFound: Number(row?.leadsFound ?? 0),
      leadsNew: Number(row?.leadsNew ?? 0),
      auditsOk: Number(row?.auditsOk ?? 0),
      auditsFailed: Number(row?.auditsFailed ?? 0),
      draftsLlm: Number(row?.draftsLlm ?? 0),
      draftsFallback: Number(row?.draftsFallback ?? 0),
      tokensIn: Number(row?.tokensIn ?? 0),
      tokensOut: Number(row?.tokensOut ?? 0),
    };
  }
}
