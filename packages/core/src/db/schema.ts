import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * The Localscout schema.
 *
 * Two rules shape the columns:
 *
 * 1. **Only measured things are stored.** `audits.metrics` and
 *    `audits.checks` hold values a tool actually produced. There is no column
 *    for a number nobody measured, because the drafting layer allowlists
 *    numbers from these fields and anything else is rejected as invented.
 * 2. **Timestamps are integers in milliseconds** (`timestamp_ms`), which keeps
 *    ordering and range comparison honest in SQL and serialises cleanly to JSON.
 *
 * Identifiers are text rather than autoincrement integers so an id can be
 * created before insert (the workflow needs it to bind a log context) and so an
 * SSE consumer can be handed one without a database round trip.
 */

/** Where a lead is in the human-in-the-loop funnel. */
export const LEAD_STATUSES = [
  'discovered',
  'audited',
  'drafted',
  'approved',
  'sent',
  'replied',
  'won',
  'lost',
  'skipped',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Statuses that mean this business has been contacted.
 *
 * A contacted domain is never re-pitched, which is why this set exists as data
 * rather than as a hard-coded comparison in the dedupe query.
 */
export const CONTACTED_STATUSES: readonly LeadStatus[] = [
  'approved',
  'sent',
  'replied',
  'won',
  'lost',
];

export const AUDIT_STATUSES = ['ok', 'stale', 'unavailable'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const LANGUAGES = ['en', 'hinglish', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DRAFT_ORIGINS = ['llm', 'fallback'] as const;
export type DraftOrigin = (typeof DRAFT_ORIGINS)[number];

export const CHANNELS = ['whatsapp', 'email', 'call', 'visit'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CONTACT_EVENTS = ['sent', 'replied', 'meeting', 'won', 'lost', 'note'] as const;
export type ContactEvent = (typeof CONTACT_EVENTS)[number];

export const RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Statuses a run cannot leave.
 *
 * A run is finished once, and the verdict is not rewritten afterwards: a
 * cancelled run must not be flipped to `completed` by a pipeline that was still
 * in flight when the cancel landed, and a run reaped as failed at startup must
 * not be overwritten either.
 */
export const RUN_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

/** True when a run has stopped, whichever way it stopped. */
export function isRunFinished(status: RunStatus): boolean {
  return (RUN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Milliseconds since the epoch, as an integer.
 *
 * `unixepoch()` alone truncates to whole seconds, which makes "the newest audit
 * for this lead" ambiguous whenever two audits land in the same second, which a
 * fast re-audit or a fixture run does routinely. `unixepoch('subsec')` keeps the
 * fraction; the cast truncates it to whole milliseconds so the column stays an
 * INTEGER.
 */
const nowMs = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

const createdAt = integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs);

const updatedAt = integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs);

/**
 * One search over one city for one business type.
 *
 * The counters exist so `/api/metrics` and the write-up can quote real numbers
 * without re-deriving them from rows.
 */
export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    query: text('query').notNull(),
    location: text('location').notNull(),
    limit: integer('limit').notNull(),
    language: text('language').$type<Language>().notNull(),
    status: text('status').$type<RunStatus>().notNull().default('queued'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    serpapiCalls: integer('serpapi_calls').notNull().default(0),
    leadsFound: integer('leads_found').notNull().default(0),
    leadsNew: integer('leads_new').notNull().default(0),
    auditsOk: integer('audits_ok').notNull().default(0),
    auditsFailed: integer('audits_failed').notNull().default(0),
    draftsLlm: integer('drafts_llm').notNull().default(0),
    draftsFallback: integer('drafts_fallback').notNull().default(0),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    error: text('error'),
    createdAt,
  },
  (table) => [
    index('runs_status_idx').on(table.status),
    index('runs_created_at_idx').on(table.createdAt),
  ],
);

/**
 * A business found by discovery.
 *
 * `place_id` is unique because it is Google Maps' own identifier for a listing.
 * `domain_key` is a separate indexed column because two listings can point at
 * the same site, and pitching one business twice is the failure mode this
 * schema is built to prevent.
 */
export const leads = sqliteTable(
  'leads',
  {
    id: text('id').primaryKey(),
    placeId: text('place_id').notNull(),
    /** Lowercase host, `www.` stripped, social/directory hosts already nulled. */
    domainKey: text('domain_key'),
    name: text('name').notNull(),
    category: text('category'),
    address: text('address'),
    lat: real('lat'),
    lng: real('lng'),
    phone: text('phone'),
    phoneE164: text('phone_e164'),
    /** True when the number is a mobile, so WhatsApp can be offered. */
    phoneIsMobile: integer('phone_is_mobile', { mode: 'boolean' }),
    websiteUrl: text('website_url'),
    /** Only ever a public `mailto:` found on the business's own site. */
    contactEmail: text('contact_email'),
    rating: real('rating'),
    reviewCount: integer('review_count'),
    sourceRunId: text('source_run_id').references(() => runs.id, { onDelete: 'set null' }),
    status: text('status').$type<LeadStatus>().notNull().default('discovered'),
    skipReason: text('skip_reason'),
    notes: text('notes'),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('leads_place_id_idx').on(table.placeId),
    index('leads_domain_key_idx').on(table.domainKey),
    index('leads_status_idx').on(table.status),
    index('leads_run_idx').on(table.sourceRunId),
  ],
);

/** Measured lab metrics. Absent fields mean "not measured", never zero. */
export interface AuditMetrics {
  lcp_ms?: number;
  cls?: number;
  tbt_ms?: number;
  perf_score?: number;
  seo_score?: number;
  a11y_score?: number;
}

/** Deterministic HTTP and HTML checks, each with its own evidence. */
export interface AuditCheck {
  id: string;
  passed: boolean;
  /** The measured value, when there is one. */
  value?: string | number | boolean;
  /** What would count as passing. */
  threshold?: string;
  detail?: string;
}

/**
 * The persisted shape of one finding.
 *
 * Declared here rather than in the audit layer because it is a storage
 * contract: the catalog that produces these lives in `audit/`, but this is what
 * a stored row must satisfy, and the drafting layer reads `evidence` from it to
 * build the number allowlist.
 */
export interface StoredFinding {
  /** Catalog id, for example `SLOW_LCP`. */
  id: string;
  severity: 'high' | 'medium' | 'low';
  /** Plain-English description shown to the user. */
  label: string;
  /** The measured value and the threshold it was compared against. */
  evidence: Record<string, string | number | boolean>;
  /** Contribution to the opportunity score. */
  weight: number;
}

export const audits = sqliteTable(
  'audits',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    status: text('status').$type<AuditStatus>().notNull(),
    error: text('error'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    metrics: text('metrics', { mode: 'json' }).$type<AuditMetrics>().notNull(),
    checks: text('checks', { mode: 'json' }).$type<AuditCheck[]>().notNull(),
    findings: text('findings', { mode: 'json' }).$type<StoredFinding[]>().notNull(),
    opportunityScore: integer('opportunity_score').notNull(),
    /** Raw Lighthouse JSON on disk, for a human to read. */
    reportPath: text('report_path'),
    createdAt,
  },
  (table) => [
    index('audits_lead_idx').on(table.leadId),
    // The newest audit for a lead, which is what the UI shows.
    index('audits_lead_created_idx').on(table.leadId, table.createdAt),
  ],
);

/**
 * A drafted message. `grounded` records whether the grounding validator passed,
 * and `validation_errors` says why it did not, so a fallback is auditable
 * rather than silent.
 */
export const drafts = sqliteTable(
  'drafts',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    auditId: text('audit_id').references(() => audits.id, { onDelete: 'set null' }),
    language: text('language').$type<Language>().notNull(),
    whatsappText: text('whatsapp_text').notNull(),
    emailSubject: text('email_subject'),
    emailBody: text('email_body'),
    generatedBy: text('generated_by').$type<DraftOrigin>().notNull(),
    model: text('model'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    grounded: integer('grounded', { mode: 'boolean' }).notNull().default(false),
    validationErrors: text('validation_errors', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt,
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('drafts_lead_idx').on(table.leadId),
    index('drafts_lead_language_idx').on(table.leadId, table.language),
  ],
);

/**
 * What the human actually did.
 *
 * Localscout never sends a message, so this table is the only record of an
 * outcome, and the dashboard milestones are derived from it.
 */
export const contactLog = sqliteTable(
  'contact_log',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    channel: text('channel').$type<Channel>().notNull(),
    event: text('event').$type<ContactEvent>().notNull(),
    note: text('note'),
    at: integer('at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('contact_log_lead_idx').on(table.leadId),
    index('contact_log_at_idx').on(table.at),
  ],
);

/** Repeat searches. Optional; scheduling is off by default. */
export const savedSearches = sqliteTable(
  'saved_searches',
  {
    id: text('id').primaryKey(),
    query: text('query').notNull(),
    location: text('location').notNull(),
    limit: integer('limit').notNull().default(20),
    language: text('language').$type<Language>().notNull().default('en'),
    /** Standard five-field cron, or null for a manual search. */
    cron: text('cron'),
    createdAt,
  },
  (table) => [index('saved_searches_cron_idx').on(table.cron)],
);

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Audit = typeof audits.$inferSelect;
export type NewAudit = typeof audits.$inferInsert;
export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;
export type ContactLogEntry = typeof contactLog.$inferSelect;
export type NewContactLogEntry = typeof contactLog.$inferInsert;
export type SavedSearch = typeof savedSearches.$inferSelect;
export type NewSavedSearch = typeof savedSearches.$inferInsert;
