import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { drafts, type Draft, type DraftOrigin, type Language, type NewDraft } from '../schema.js';

/**
 * Draft persistence.
 *
 * `grounded` and `validationErrors` are stored on every row rather than only on
 * failures, so a human can tell "the model produced this and it checked out"
 * from "we fell back to a template because the model drifted".
 */

export interface CreateDraftInput {
  leadId: string;
  auditId?: string | undefined;
  language: Language;
  whatsappText: string;
  emailSubject?: string | undefined;
  emailBody?: string | undefined;
  generatedBy: DraftOrigin;
  model?: string | undefined;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  grounded: boolean;
  validationErrors: string[];
}

export interface GroundingStats {
  total: number;
  grounded: number;
  fallback: number;
  llm: number;
}

export class DraftRepository {
  constructor(private readonly handle: Db) {}

  private get db() {
    return this.handle.db;
  }

  async create(input: CreateDraftInput): Promise<Draft> {
    const row: NewDraft = {
      id: randomUUID(),
      leadId: input.leadId,
      language: input.language,
      whatsappText: input.whatsappText,
      generatedBy: input.generatedBy,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      latencyMs: input.latencyMs,
      grounded: input.grounded,
      validationErrors: input.validationErrors,
      ...(input.auditId !== undefined ? { auditId: input.auditId } : {}),
      ...(input.emailSubject !== undefined ? { emailSubject: input.emailSubject } : {}),
      ...(input.emailBody !== undefined ? { emailBody: input.emailBody } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
    };
    this.db.insert(drafts).values(row).run();
    return this.requireById(row.id);
  }

  async byId(id: string): Promise<Draft | undefined> {
    return this.db.select().from(drafts).where(eq(drafts.id, id)).get();
  }

  async requireById(id: string): Promise<Draft> {
    const found = await this.byId(id);
    if (!found) throw new Error(`Draft not found: ${id}`);
    return found;
  }

  /** The most recent draft for a lead in a given language. */
  async latestForLead(leadId: string, language: Language): Promise<Draft | undefined> {
    return this.db
      .select()
      .from(drafts)
      .where(and(eq(drafts.leadId, leadId), eq(drafts.language, language)))
      .orderBy(desc(drafts.createdAt), desc(sql`${drafts}.rowid`))
      .get();
  }

  /** The newest draft per language for a lead, which is what the modal shows. */
  async latestByLanguageForLead(leadId: string): Promise<Partial<Record<Language, Draft>>> {
    const rows = this.db
      .select()
      .from(drafts)
      .where(eq(drafts.leadId, leadId))
      .orderBy(desc(drafts.createdAt), desc(sql`${drafts}.rowid`))
      .all();

    const latest = new Map<Language, Draft>();
    for (const row of rows) {
      if (!latest.has(row.language)) latest.set(row.language, row);
    }
    return Object.fromEntries(latest) as Partial<Record<Language, Draft>>;
  }

  async listForLead(leadId: string): Promise<Draft[]> {
    return this.db
      .select()
      .from(drafts)
      .where(eq(drafts.leadId, leadId))
      .orderBy(desc(drafts.createdAt), desc(sql`${drafts}.rowid`))
      .all();
  }

  /** Mark a draft as reviewed by the human. Not an approval to send. */
  async markApproved(id: string): Promise<Draft> {
    this.db.update(drafts).set({ approvedAt: new Date() }).where(eq(drafts.id, id)).run();
    return this.requireById(id);
  }

  /**
   * How many drafts came from the model, how many grounded, how many fell back.
   *
   * Feeds the metrics endpoint and the write-up's grounding numbers.
   */
  async groundingStats(): Promise<GroundingStats> {
    const row = this.db
      .select({
        total: count(),
        grounded: sql<number>`coalesce(sum(case when ${drafts.grounded} = 1 then 1 else 0 end), 0)`,
        fallback: sql<number>`coalesce(sum(case when ${drafts.generatedBy} = 'fallback' then 1 else 0 end), 0)`,
        llm: sql<number>`coalesce(sum(case when ${drafts.generatedBy} = 'llm' then 1 else 0 end), 0)`,
      })
      .from(drafts)
      .get();

    return {
      total: row?.total ?? 0,
      grounded: Number(row?.grounded ?? 0),
      fallback: Number(row?.fallback ?? 0),
      llm: Number(row?.llm ?? 0),
    };
  }

  async averageLatencyMs(): Promise<number | null> {
    const row = this.db
      .select({ avg: sql<number | null>`avg(${drafts.latencyMs})` })
      .from(drafts)
      .get();
    if (row?.avg === null || row?.avg === undefined) return null;
    return Math.round(row.avg);
  }

  async tokenTotals(): Promise<{ tokensIn: number; tokensOut: number }> {
    const row = this.db
      .select({
        tokensIn: sql<number>`coalesce(sum(${drafts.tokensIn}), 0)`,
        tokensOut: sql<number>`coalesce(sum(${drafts.tokensOut}), 0)`,
      })
      .from(drafts)
      .get();
    return { tokensIn: Number(row?.tokensIn ?? 0), tokensOut: Number(row?.tokensOut ?? 0) };
  }

  async total(): Promise<number> {
    const row = this.db.select({ count: count() }).from(drafts).get();
    return row?.count ?? 0;
  }
}
