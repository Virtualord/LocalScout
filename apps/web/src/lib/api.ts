import type {
  AuditCheck,
  AuditStatus,
  ContactEvent,
  Channel,
  Language,
  LeadStatus,
  StoredFinding,
} from '@localscout/core';

/**
 * The typed API client.
 *
 * Every response shape is declared here rather than inferred at the call site,
 * so a backend change that breaks a screen is a compile error rather than an
 * `undefined` at runtime. Requests go through the Vite proxy to the same origin,
 * which keeps the API's CORS rules meaningful.
 */

const BASE = '/api';

/** A failed API call, with the server's message when it sent one. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text === '' ? undefined : JSON.parse(text);
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed with ${response.status}.`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface LeadSummary {
  id: string;
  placeId: string;
  domainKey: string | null;
  name: string;
  category: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  phoneE164: string | null;
  phoneIsMobile: boolean | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  rating: number | null;
  reviewCount: number | null;
  status: LeadStatus;
  notes: string | null;
  createdAt: string;
  opportunityScore: number | null;
  auditStatus: AuditStatus | null;
  canWhatsApp: boolean;
  draftCount: number;
}

export interface AuditSummary {
  id: string;
  leadId: string;
  status: AuditStatus;
  error: string | null;
  startedAt: string;
  durationMs: number;
  metrics: {
    lcp_ms?: number;
    cls?: number;
    tbt_ms?: number;
    perf_score?: number;
    seo_score?: number;
    a11y_score?: number;
  };
  checks: AuditCheck[];
  findings: StoredFinding[];
  opportunityScore: number;
  reportPath: string | null;
  createdAt: string;
}

export interface DraftSummary {
  id: string;
  leadId: string;
  language: Language;
  whatsappText: string;
  emailSubject: string | null;
  emailBody: string | null;
  generatedBy: 'llm' | 'fallback';
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  grounded: boolean;
  validationErrors: string[];
  createdAt: string;
  approvedAt: string | null;
}

export interface ContactLogEntry {
  id: string;
  leadId: string;
  channel: Channel;
  event: ContactEvent;
  note: string | null;
  at: string;
}

export interface RunSummary {
  id: string;
  query: string;
  location: string;
  limit: number;
  language: Language;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string | null;
  finishedAt: string | null;
  serpapiCalls: number;
  leadsFound: number;
  leadsNew: number;
  auditsOk: number;
  auditsFailed: number;
  draftsLlm: number;
  draftsFallback: number;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
  createdAt: string;
}

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export interface Health {
  ok: boolean;
  checks: HealthCheck[];
  modes: { discovery: string; llm: string };
  keys: { serpApi: boolean; llm: boolean };
}

export interface Metrics {
  leads: { total: number; byStatus: Record<LeadStatus, number> };
  runs: {
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
  };
  audits: {
    total: number;
    byStatus: Record<AuditStatus, number>;
    averageDurationMs: number | null;
  };
  drafts: {
    total: number;
    fromModel: number;
    fromTemplate: number;
    grounded: number;
    groundedPercent: number;
    modelRatePercent: number;
    fallbackRatePercent: number;
    averageLatencyMs: number | null;
    tokensIn: number;
    tokensOut: number;
  };
  cost: {
    serpApiCalls: number;
    serpApiCallsPerLead: number | null;
    llmCostPerLead: number;
    note: string;
  };
  outreach: {
    totalEntries: number;
    milestones: {
      firstMessageSent: boolean;
      firstReply: boolean;
      firstMeeting: boolean;
      firstClient: boolean;
    };
  };
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                   */
/* -------------------------------------------------------------------------- */

export const api = {
  health: () => request<Health>('/health'),

  metrics: () => request<Metrics>('/metrics'),

  startRun: (input: { query: string; location: string; limit: number; language: Language }) =>
    request<{ runId: string }>('/runs', { method: 'POST', body: JSON.stringify(input) }),

  runs: (limit = 50) => request<{ runs: RunSummary[] }>(`/runs?limit=${limit}`),

  run: (id: string) => request<{ run: RunSummary }>(`/runs/${id}`),

  leads: (params: {
    status?: LeadStatus;
    minScore?: number;
    q?: string;
    sort?: 'score' | 'newest' | 'name';
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return request<{ leads: LeadSummary[]; total: number }>(`/leads?${query.toString()}`);
  },

  lead: (id: string) =>
    request<{
      lead: LeadSummary;
      audit: AuditSummary | null;
      drafts: Partial<Record<Language, DraftSummary>>;
      contactLog: ContactLogEntry[];
      counts: Record<LeadStatus, number>;
    }>(`/leads/${id}`),

  updateLead: (id: string, patch: { status?: LeadStatus; notes?: string }) =>
    request<{ lead: LeadSummary }>(`/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  addContactLog: (id: string, entry: { channel: Channel; event: ContactEvent; note?: string }) =>
    request<{ entry: ContactLogEntry; lead: LeadSummary }>(`/leads/${id}/contact-log`, {
      method: 'POST',
      body: JSON.stringify(entry),
    }),

  createDraft: (id: string, language: Language) =>
    request<{ draft: DraftSummary; lead: LeadSummary }>(`/leads/${id}/drafts`, {
      method: 'POST',
      body: JSON.stringify({ language }),
    }),

  reaudit: (id: string) =>
    request<{ audit: AuditSummary; lead: LeadSummary }>(`/leads/${id}/audit`, { method: 'POST' }),
};

/* -------------------------------------------------------------------------- */
/* Progress stream                                                             */
/* -------------------------------------------------------------------------- */

export type RunEventType =
  | 'run.started'
  | 'lead.discovered'
  | 'lead.skipped'
  | 'audit.started'
  | 'audit.finished'
  | 'draft.finished'
  | 'run.finished'
  | 'run.failed'
  | 'ping';

export interface RunEvent {
  type: RunEventType;
  runId: string;
  at: string;
  leadId?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * Follow a run's progress.
 *
 * Returns an unsubscribe function. The stream closes itself when the run
 * finishes, so the caller does not have to track that state.
 */
export function subscribeToRun(runId: string, onEvent: (event: RunEvent) => void): () => void {
  const source = new EventSource(`${BASE}/runs/${runId}/events`);

  const handle = (raw: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(raw.data) as RunEvent);
    } catch {
      // A malformed frame is not worth tearing the stream down for.
    }
  };

  const names: RunEventType[] = [
    'run.started',
    'lead.discovered',
    'lead.skipped',
    'audit.started',
    'audit.finished',
    'draft.finished',
    'run.finished',
    'run.failed',
    'ping',
  ];

  for (const name of names) {
    source.addEventListener(name, handle as EventListener);
  }

  return () => source.close();
}
