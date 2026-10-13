import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  contactLog,
  type Channel,
  type ContactEvent,
  type ContactLogEntry,
  type NewContactLogEntry,
} from '../schema.js';

/**
 * The outreach book.
 *
 * Localscout never sends anything, so this table is the only record of what the
 * human did. The dashboard's "outreach book" milestones are derived from it,
 * which is why the milestone rule lives here next to the data rather than in a
 * component.
 */

export interface AddContactLogInput {
  leadId: string;
  channel: Channel;
  event: ContactEvent;
  note?: string | undefined;
  at?: Date | undefined;
}

export interface Milestones {
  firstMessageSent: boolean;
  firstReply: boolean;
  firstMeeting: boolean;
  firstClient: boolean;
}

/**
 * Which milestones a set of outreach events unlocks.
 *
 * Pure and table-driven so the rule is testable without a database.
 */
export function computeMilestones(events: readonly { event: ContactEvent }[]): Milestones {
  const has = (event: ContactEvent) => events.some((entry) => entry.event === event);
  return {
    firstMessageSent: has('sent'),
    firstReply: has('replied'),
    firstMeeting: has('meeting'),
    firstClient: has('won'),
  };
}

export class ContactLogRepository {
  constructor(private readonly handle: Db) {}

  private get db() {
    return this.handle.db;
  }

  async add(input: AddContactLogInput): Promise<ContactLogEntry> {
    const row: NewContactLogEntry = {
      id: randomUUID(),
      leadId: input.leadId,
      channel: input.channel,
      event: input.event,
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.at !== undefined ? { at: input.at } : {}),
    };
    this.db.insert(contactLog).values(row).run();

    const stored = this.db.select().from(contactLog).where(eq(contactLog.id, row.id)).get();
    if (!stored) throw new Error('Contact log entry was not stored.');
    return stored;
  }

  async listForLead(leadId: string): Promise<ContactLogEntry[]> {
    return this.db
      .select()
      .from(contactLog)
      .where(eq(contactLog.leadId, leadId))
      .orderBy(desc(contactLog.at), desc(sql`${contactLog}.rowid`))
      .all();
  }

  async recent(limit: number): Promise<ContactLogEntry[]> {
    return this.db
      .select()
      .from(contactLog)
      .orderBy(desc(contactLog.at), desc(sql`${contactLog}.rowid`))
      .limit(limit)
      .all();
  }

  async total(): Promise<number> {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(contactLog)
      .get();
    return row?.count ?? 0;
  }

  /**
   * Milestones the user has reached.
   *
   * `firstAudit` is deliberately absent: an audit is not an outreach event, so
   * the caller combines this with the audit count from the audits repository.
   */
  async milestones(): Promise<Milestones> {
    const rows = this.db.select({ event: contactLog.event }).from(contactLog).all();
    return computeMilestones(rows);
  }
}
