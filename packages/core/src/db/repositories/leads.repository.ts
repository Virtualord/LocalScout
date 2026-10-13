import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, like, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  audits as auditsRef,
  CONTACTED_STATUSES,
  drafts as draftsRef,
  LEAD_STATUSES,
  leads,
  savedSearches,
  type Lead,
  type LeadStatus,
  type NewLead,
  type SavedSearch,
} from '../schema.js';

/**
 * Lead persistence and the dedupe rules.
 *
 * Two invariants live here and nowhere else:
 *
 * 1. **Never pitch the same business twice.** `place_id` is unique in the
 *    schema; a domain that has already been contacted is filtered in the query
 *    below, so a second search for the same city skips businesses the user has
 *    already written to.
 * 2. **Never invent contact details.** `contactEmail` is only ever set from a
 *    public `mailto:` found on the business's own site during the audit, and
 *    this repository never writes it from discovery data.
 */

export interface CreateLeadInput {
  placeId: string;
  name: string;
  category?: string | undefined;
  address?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  phone?: string | undefined;
  phoneE164?: string | undefined;
  phoneIsMobile?: boolean | undefined;
  websiteUrl?: string | undefined;
  domainKey?: string | undefined;
  rating?: number | undefined;
  reviewCount?: number | undefined;
  sourceRunId?: string | undefined;
}

export interface LeadFilters {
  status?: LeadStatus | undefined;
  /** Lower bound on the latest audit's opportunity score, 0-100. */
  minScore?: number | undefined;
  /** Free-text match over name, address, and category. */
  q?: string | undefined;
  sort?: 'score' | 'newest' | 'name' | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/** A lead joined with the numbers the list view needs, so N+1 reads are avoided. */
export interface LeadWithScore extends Lead {
  opportunityScore: number | null;
  auditStatus: string | null;
  auditId: string | null;
  draftCount: number;
  /** True when the business has a mobile number, so WhatsApp is available. */
  canWhatsApp: boolean;
  /**
   * SQLite's insertion order.
   *
   * Exists purely to break ties in the "newest" sort. A run discovers a dozen
   * leads inside the same millisecond, so `createdAt` alone cannot order them,
   * and a random tie-break means reloading the page reshuffles the list.
   */
  rowid: number;
}

export class LeadRepository {
  constructor(private readonly handle: Db) {}

  private get db() {
    return this.handle.db;
  }

  /** The latest audit per lead, keyed by lead id. */
  private latestAuditScores(): Map<string, { score: number; status: string; id: string }> {
    const rows = this.db
      .select({
        leadId: auditsRef.leadId,
        id: auditsRef.id,
        score: auditsRef.opportunityScore,
        status: auditsRef.status,
        createdAt: auditsRef.createdAt,
      })
      .from(auditsRef)
      .orderBy(asc(auditsRef.leadId), desc(auditsRef.createdAt), desc(sql`${auditsRef}.rowid`))
      .all();

    const latest = new Map<string, { score: number; status: string; id: string }>();
    for (const row of rows) {
      // Ordering by (leadId asc, createdAt desc) means the first row seen for a
      // lead is its newest audit; later rows are older history.
      if (!latest.has(row.leadId)) {
        latest.set(row.leadId, { score: row.score, status: row.status, id: row.id });
      }
    }
    return latest;
  }

  private draftCounts(): Map<string, number> {
    const rows = this.db
      .select({ leadId: draftsRef.leadId, count: sql<number>`count(*)` })
      .from(draftsRef)
      .groupBy(draftsRef.leadId)
      .all();
    return new Map(rows.map((row) => [row.leadId, row.count]));
  }

  async insert(input: CreateLeadInput): Promise<Lead> {
    const row: NewLead = {
      id: randomUUID(),
      placeId: input.placeId,
      name: input.name,
      status: 'discovered',
      ...optional({
        category: input.category,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        phone: input.phone,
        phoneE164: input.phoneE164,
        phoneIsMobile: input.phoneIsMobile,
        websiteUrl: input.websiteUrl,
        domainKey: input.domainKey,
        rating: input.rating,
        reviewCount: input.reviewCount,
        sourceRunId: input.sourceRunId,
      }),
    };
    this.db.insert(leads).values(row).run();
    return this.requireByPlaceId(input.placeId);
  }

  async insertMany(inputs: CreateLeadInput[]): Promise<Lead[]> {
    if (inputs.length === 0) return [];
    const rows: NewLead[] = inputs.map((input) => ({
      id: randomUUID(),
      placeId: input.placeId,
      name: input.name,
      status: 'discovered' as const,
      ...optional({
        category: input.category,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        phone: input.phone,
        phoneE164: input.phoneE164,
        phoneIsMobile: input.phoneIsMobile,
        websiteUrl: input.websiteUrl,
        domainKey: input.domainKey,
        rating: input.rating,
        reviewCount: input.reviewCount,
        sourceRunId: input.sourceRunId,
      }),
    }));
    this.db.insert(leads).values(rows).run();
    // Re-read through the query path so optional columns come back in the same
    // shape as `byId`, rather than being whatever `insert` happened to echo.
    const ids = rows.map((row) => row.id);
    const stored = this.db.select().from(leads).where(inArray(leads.id, ids)).all();
    return stored;
  }

  async byId(id: string): Promise<Lead | undefined> {
    return this.db.select().from(leads).where(eq(leads.id, id)).get();
  }

  async requireById(id: string): Promise<Lead> {
    const found = await this.byId(id);
    if (!found) throw new Error(`Lead not found: ${id}`);
    return found;
  }

  async byPlaceId(placeId: string): Promise<Lead | undefined> {
    return this.db.select().from(leads).where(eq(leads.placeId, placeId)).get();
  }

  private requireByPlaceId(placeId: string): Lead {
    const found = this.db.select().from(leads).where(eq(leads.placeId, placeId)).get();
    if (!found) throw new Error(`Lead not found by place_id: ${placeId}`);
    return found;
  }

  async byDomainKey(domainKey: string): Promise<Lead[]> {
    return this.db.select().from(leads).where(eq(leads.domainKey, domainKey)).all();
  }

  /** Every place id already stored. Used to skip known listings in one query. */
  async knownPlaceIds(placeIds: string[]): Promise<Set<string>> {
    if (placeIds.length === 0) return new Set();
    const rows = this.db
      .select({ placeId: leads.placeId })
      .from(leads)
      .where(inArray(leads.placeId, placeIds))
      .all();
    return new Set(rows.map((row) => row.placeId));
  }

  /**
   * Domains that must not be pitched again.
   *
   * A domain counts as contacted once any lead on it reached a contacted
   * status, which is how "never pitch twice" survives a business being listed
   * twice under different place ids.
   */
  async contactedDomainKeys(): Promise<Set<string>> {
    const rows = this.db
      .select({ domainKey: leads.domainKey })
      .from(leads)
      .where(
        and(sql`${leads.domainKey} IS NOT NULL`, inArray(leads.status, [...CONTACTED_STATUSES])),
      )
      .all();
    return new Set(rows.map((row) => row.domainKey).filter((key): key is string => key !== null));
  }

  async list(filters: LeadFilters = {}): Promise<LeadWithScore[]> {
    const conditions = [];

    if (filters.status) {
      conditions.push(eq(leads.status, filters.status));
    }
    if (filters.q && filters.q.trim() !== '') {
      const needle = `%${filters.q.trim()}%`;
      const match = or(
        like(leads.name, needle),
        like(leads.address, needle),
        like(leads.category, needle),
      );
      if (match) conditions.push(match);
    }

    const rows = this.db
      .select()
      .from(leads)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .all();

    let enriched = this.enrich(rows);

    // minScore filters on the latest audit, which is a join, so it applies here.
    if (filters.minScore !== undefined) {
      const min = filters.minScore;
      enriched = enriched.filter(
        (lead) => lead.opportunityScore !== null && lead.opportunityScore >= min,
      );
    }

    enriched = sortLeads(enriched, filters.sort ?? 'score');

    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return enriched.slice(offset, offset + limit);
  }

  /**
   * Attach the derived fields to raw lead rows.
   *
   * The list endpoint and the single-lead endpoint must agree: a lead that
   * shows a score in the grid but a blank in its own modal is exactly the kind
   * of inconsistency that makes a person distrust the whole number.
   */
  private enrich(rows: Lead[]): LeadWithScore[] {
    const scores = this.latestAuditScores();
    const draftCounts = this.draftCounts();
    const rowids = this.rowIds();

    return rows.map((row) => {
      const audit = scores.get(row.id);
      return {
        ...row,
        opportunityScore: audit?.score ?? null,
        auditStatus: audit?.status ?? null,
        auditId: audit?.id ?? null,
        draftCount: draftCounts.get(row.id) ?? 0,
        canWhatsApp: row.phoneIsMobile === true,
        rowid: rowids.get(row.id) ?? 0,
      };
    });
  }

  /** Insertion order, keyed by lead id. Used only to break sort ties. */
  private rowIds(): Map<string, number> {
    const rows = this.db
      .select({ id: leads.id, rowid: sql<number>`rowid` })
      .from(leads)
      .all();
    return new Map(rows.map((row) => [row.id, row.rowid]));
  }

  /**
   * One lead, with the same derived fields the list endpoint returns.
   *
   * Distinct from `byId`, which returns the raw stored row for internal callers
   * that need the columns exactly.
   */
  async summaryById(id: string): Promise<LeadWithScore | undefined> {
    const row = this.db.select().from(leads).where(eq(leads.id, id)).get();
    if (row === undefined) return undefined;
    const enriched = this.enrich([row]);
    return enriched[0];
  }

  async countByStatus(): Promise<Record<LeadStatus, number>> {
    const rows = this.db
      .select({ status: leads.status, count: sql<number>`count(*)` })
      .from(leads)
      .groupBy(leads.status)
      .all();

    const counts = Object.fromEntries(LEAD_STATUSES.map((status) => [status, 0])) as Record<
      LeadStatus,
      number
    >;

    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  /** Total number of leads, used by the dashboard tiles. */
  async total(): Promise<number> {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(leads)
      .get();
    return row?.count ?? 0;
  }

  /**
   * Saved searches that carry a schedule.
   *
   * Rows with a null `cron` are manual searches and are not returned, because
   * the scheduler has nothing to register for them.
   */
  async scheduled(): Promise<SavedSearch[]> {
    return this.db
      .select()
      .from(savedSearches)
      .where(sql`${savedSearches.cron} IS NOT NULL`)
      .all();
  }

  async setStatus(id: string, status: LeadStatus, skipReason?: string): Promise<Lead> {
    this.db
      .update(leads)
      .set({
        status,
        ...(status === 'skipped' && skipReason !== undefined ? { skipReason } : {}),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, id))
      .run();
    return this.requireById(id);
  }

  async setNotes(id: string, notes: string): Promise<Lead> {
    this.db.update(leads).set({ notes, updatedAt: new Date() }).where(eq(leads.id, id)).run();
    return this.requireById(id);
  }

  /**
   * Store an email discovered during the audit.
   *
   * Only ever called with a `mailto:` read from the business's own site. The
   * signature takes the lead id rather than a listing so there is no path that
   * could write an address from somewhere else.
   */
  async setContactEmail(id: string, email: string): Promise<void> {
    this.db
      .update(leads)
      .set({ contactEmail: email, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .run();
  }

  async setWebsite(
    id: string,
    websiteUrl: string | undefined,
    domainKey: string | undefined,
  ): Promise<void> {
    this.db
      .update(leads)
      .set({
        websiteUrl: websiteUrl ?? null,
        domainKey: domainKey ?? null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, id))
      .run();
  }

  /** Leads created inside a time window, for the metrics endpoint. */
  async createdBetween(from: Date, to: Date): Promise<Lead[]> {
    return this.db
      .select()
      .from(leads)
      .where(and(gte(leads.createdAt, from), lte(leads.createdAt, to)))
      .all();
  }

  async all(): Promise<Lead[]> {
    return this.db.select().from(leads).all();
  }

  /** Highest-scoring leads, for the home "hot leads" band. */
  async topByScore(limit: number): Promise<LeadWithScore[]> {
    const all = await this.list({ sort: 'score' });
    return all.slice(0, limit);
  }
}

function sortLeads(rows: LeadWithScore[], sort: NonNullable<LeadFilters['sort']>): LeadWithScore[] {
  const sorted = [...rows];

  // One comparator, not a sequence of sorts: a second sort() call would
  // discard the primary ordering.
  sorted.sort((a, b) => {
    switch (sort) {
      case 'score': {
        const delta = (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1);
        if (delta !== 0) return delta;
        break;
      }
      case 'newest': {
        const delta = b.createdAt.getTime() - a.createdAt.getTime();
        if (delta !== 0) return delta;
        // Same millisecond, which is the normal case for one run's worth of
        // leads. Insertion order is what "newest" actually means here; falling
        // through to the id tie-break would reshuffle the list on every reload.
        return b.rowid - a.rowid;
      }
      case 'name': {
        const delta = a.name.localeCompare(b.name);
        if (delta !== 0) return delta;
        break;
      }
    }
    // The id tie-break keeps pagination stable when scores or names collide.
    return a.id.localeCompare(b.id);
  });

  return sorted;
}

/** Drop undefined keys so drizzle writes NULL rather than the string "undefined". */
function optional<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
