import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  audits,
  type Audit,
  type AuditCheck,
  type AuditMetrics,
  type AuditStatus,
  type NewAudit,
  type StoredFinding,
} from '../schema.js';

/**
 * Audit persistence.
 *
 * A row exists for every audit attempt, including failures. That is deliberate:
 * "we could not reach this site" is a finding the user needs to see, and
 * recording it is what keeps a `SITE_UNREACHABLE` claim traceable later.
 */

/** Re-exported so callers import finding shape from one place. */
export type AuditFindingRecord = StoredFinding;

export interface CreateAuditInput {
  leadId: string;
  status: AuditStatus;
  error?: string | undefined;
  startedAt: Date;
  durationMs: number;
  metrics: AuditMetrics;
  checks: AuditCheck[];
  findings: AuditFindingRecord[];
  opportunityScore: number;
  reportPath?: string | undefined;
}

export class AuditRepository {
  constructor(private readonly handle: Db) {}

  private get db() {
    return this.handle.db;
  }

  async create(input: CreateAuditInput): Promise<Audit> {
    const row: NewAudit = {
      id: randomUUID(),
      leadId: input.leadId,
      status: input.status,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      metrics: input.metrics,
      checks: input.checks,
      findings: input.findings,
      opportunityScore: input.opportunityScore,
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.reportPath !== undefined ? { reportPath: input.reportPath } : {}),
    };
    this.db.insert(audits).values(row).run();
    return this.requireById(row.id);
  }

  async byId(id: string): Promise<Audit | undefined> {
    return this.db.select().from(audits).where(eq(audits.id, id)).get();
  }

  async requireById(id: string): Promise<Audit> {
    const found = await this.byId(id);
    if (!found) throw new Error(`Audit not found: ${id}`);
    return found;
  }

  /** The newest audit for a lead, which is the one the UI shows. */
  async latestForLead(leadId: string): Promise<Audit | undefined> {
    return this.db
      .select()
      .from(audits)
      .where(eq(audits.leadId, leadId))
      .orderBy(desc(audits.createdAt), desc(sql`${audits}.rowid`))
      .get();
  }

  async listForLead(leadId: string): Promise<Audit[]> {
    return this.db
      .select()
      .from(audits)
      .where(eq(audits.leadId, leadId))
      .orderBy(desc(audits.createdAt), desc(sql`${audits}.rowid`))
      .all();
  }

  async countByStatus(): Promise<Record<AuditStatus, number>> {
    const rows = this.db
      .select({ status: audits.status, count: sql<number>`count(*)` })
      .from(audits)
      .groupBy(audits.status)
      .all();

    const counts: Record<AuditStatus, number> = { ok: 0, stale: 0, unavailable: 0 };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  /** Average audit duration in ms, for the metrics endpoint. */
  async averageDurationMs(): Promise<number | null> {
    const row = this.db
      .select({ avg: sql<number>`avg(${audits.durationMs})` })
      .from(audits)
      .get();
    if (row?.avg === null || row?.avg === undefined) return null;
    return Math.round(row.avg);
  }

  async total(): Promise<number> {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(audits)
      .get();
    return row?.count ?? 0;
  }

  /** Highest opportunity score across all audits, for the map legend. */
  async highestScore(): Promise<number> {
    const row = this.db
      .select({ max: sql<number>`max(${audits.opportunityScore})` })
      .from(audits)
      .get();
    return row?.max ?? 0;
  }

  /** All audits for a run, used when a workflow step re-reads its own output. */
  async listForLeads(leadIds: string[]): Promise<Audit[]> {
    if (leadIds.length === 0) return [];
    const rows = this.db.select().from(audits).all();
    const wanted = new Set(leadIds);
    return rows.filter((row) => wanted.has(row.leadId));
  }
}
