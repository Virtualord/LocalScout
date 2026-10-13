import type { LeadStatus, Language, StoredFinding } from '@localscout/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../design/button.js';
import { Card, ComparisonRow, ScoreBlock } from '../../design/card.js';
import { Chip, TierChip, type ChipVariant } from '../../design/chip.js';
import { Dialog, DialogContent } from '../../design/dialog.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../design/primitives.js';
import {
  api,
  type AuditSummary,
  type ContactLogEntry,
  type DraftSummary,
  type LeadSummary,
} from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { StatusChip } from './lead-card.js';

/**
 * The lead modal.
 *
 * Where the human actually reviews the work: the measurements, the draft, and
 * the buttons that mark what they did by hand.
 *
 * Two rules are load-bearing here:
 *
 * 1. **Copy, never send.** Every action produces text on the clipboard and
 *    nothing else. There is no send path in this file, and there is none in the
 *    codebase, because the person who wrote the message should be the person who
 *    sent it.
 * 2. **The measurements are shown even when they are unflattering.** A missing
 *    audit says so rather than hiding, because "we could not check" and "it is
 *    fine" are different facts.
 */

export interface LeadModalProps {
  leadId: string | null;
  onClose: () => void;
  /** Called when the modal closes so the list can clear its deep link. */
  onOpenChange: (open: boolean) => void;
}

interface LeadDetail {
  lead: LeadSummary;
  audit: AuditSummary | null;
  drafts: Partial<Record<Language, DraftSummary>>;
  contactLog: ContactLogEntry[];
}

export function LeadModal({ leadId, onClose, onOpenChange }: LeadModalProps) {
  return (
    <Dialog
      open={leadId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {leadId !== null && <LeadModalBody leadId={leadId} onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

/**
 * Put focus back on the map square that opened the modal.
 *
 * The squares are plain buttons, not Radix triggers, so Radix has no trigger to
 * restore focus to and a keyboard user would land on `<body>` after closing.
 * When the lead was opened from the list instead there is no such square, and
 * this returns false so the caller falls through to the default behaviour.
 */
function refocusMapSquare(leadId: string, event: Event): void {
  const square = document.querySelector<HTMLElement>(`[data-map-lead="${CSS.escape(leadId)}"]`);
  if (square === null) return;
  event.preventDefault();
  square.focus();
}

function LeadModalBody({
  leadId,
  onOpenChange,
}: {
  leadId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: queryKeys.lead(leadId),
    queryFn: () => api.lead(leadId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['leads'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.lead(leadId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.metrics });
  };

  const setStatus = useMutation({
    mutationFn: (status: LeadStatus) => api.updateLead(leadId, { status }),
    onSuccess: invalidate,
  });

  const logContact = useMutation({
    mutationFn: (event: ContactLogEntry['event']) =>
      api.addContactLog(leadId, { channel: 'whatsapp', event }),
    onSuccess: invalidate,
  });

  const reaudit = useMutation({
    mutationFn: () => api.reaudit(leadId),
    onSuccess: invalidate,
  });

  const createDraft = useMutation({
    mutationFn: () => api.createDraft(leadId, 'en'),
    onSuccess: invalidate,
  });

  if (detail.isPending) {
    return (
      <DialogContent title="Loading lead" description="Fetching the audit and drafts.">
        <p className="mt-6 text-[14px] text-ink/70">Loading the audit and drafts for this lead…</p>
      </DialogContent>
    );
  }

  if (detail.isError) {
    return (
      <DialogContent title="Could not load the lead" description="The API did not answer.">
        <p className="mt-6 text-[14px] text-ink/80">{detail.error.message}</p>
      </DialogContent>
    );
  }

  const data = detail.data as LeadDetail;

  return (
    <DialogContent
      onCloseAutoFocus={(event) => refocusMapSquare(leadId, event)}
      title={data.lead.name}
      description={
        [data.lead.category, data.lead.address].filter(Boolean).join(' · ') ||
        'No category or address recorded'
      }
      size="lg"
      footer={
        <>
          <Button variant="primary" onClick={() => setStatus.mutate('approved')}>
            Mark reviewed
          </Button>
          <Button variant="secondary" onClick={() => logContact.mutate('sent')}>
            I sent a message
          </Button>
          <Button variant="ghost" onClick={() => setStatus.mutate('skipped')}>
            Skip this one
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </>
      }
    >
      {/*
       * Not a LeadCard: the title above already carries the name and the
       * address, so repeating them wastes the top third of the modal. What
       * belongs here is the contact facts, because that is what the person
       * about to write a message actually needs to look up.
       */}
      <div className="border-b border-ink/15 bg-paper-band px-7 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <TierChip score={data.lead.opportunityScore} auditStatus={data.lead.auditStatus} />
          <StatusChip status={data.lead.status} />
          {data.lead.canWhatsApp && <Chip variant="neutral">WhatsApp</Chip>}
          <div className="ml-auto">
            <ScoreBlock score={data.lead.opportunityScore} />
          </div>
        </div>

        <dl className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <Fact label="Website">
            {data.lead.websiteUrl !== null ? (
              <a
                href={data.lead.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink"
              >
                {data.lead.websiteUrl.replace(/^https?:\/\//, '')}
              </a>
            ) : (
              <em className="text-ink/50">no website</em>
            )}
          </Fact>
          <Fact label="Phone">
            {data.lead.phoneE164 ?? <em className="text-ink/50">none recorded</em>}
          </Fact>
          <Fact label="Email">
            {data.lead.contactEmail ?? <em className="text-ink/50">none published</em>}
          </Fact>
          <Fact label="Rating">
            {data.lead.rating !== null && data.lead.reviewCount !== null ? (
              `${data.lead.rating.toFixed(1)} from ${data.lead.reviewCount} reviews`
            ) : (
              <em className="text-ink/50">not recorded</em>
            )}
          </Fact>
        </dl>
      </div>

      <div className="px-7 pb-7">
        <Tabs defaultValue="evidence">
          <TabsList>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="contact">Contact log</TabsTrigger>
          </TabsList>

          <TabsContent value="evidence">
            <EvidenceTab
              audit={data.audit}
              lead={data.lead}
              onReaudit={() => reaudit.mutate()}
              reauditing={reaudit.isPending}
            />
          </TabsContent>

          <TabsContent value="draft">
            <DraftTab
              drafts={data.drafts}
              onCreate={() => createDraft.mutate()}
              creating={createDraft.isPending}
            />
          </TabsContent>

          <TabsContent value="contact">
            <ContactTab entries={data.contactLog} />
          </TabsContent>
        </Tabs>
      </div>
    </DialogContent>
  );
}

/** One labelled fact. A missing value is styled, not blank. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="mono w-20 shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/50">
        {label}
      </dt>
      <dd className="mono min-w-0 flex-1 truncate text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                   */
/* -------------------------------------------------------------------------- */

function EvidenceTab({
  audit,
  lead,
  onReaudit,
  reauditing,
}: {
  audit: AuditSummary | null;
  lead: LeadSummary;
  onReaudit: () => void;
  reauditing: boolean;
}) {
  // No audit at all is a distinct state from an audit that could not run, and
  // the copy says which.
  if (audit === null) {
    return (
      <div className="py-4">
        <p className="text-[15px] text-ink/80">This lead has not been audited yet.</p>
        <p className="mt-2 text-[14px] text-ink/65">
          An audit fetches {lead.websiteUrl ?? 'the site'} and measures it. It never writes to the
          site.
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={onReaudit} busy={reauditing}>
            Run the audit now
          </Button>
        </div>
      </div>
    );
  }

  if (audit.status === 'unavailable') {
    return (
      <div className="py-4">
        <p className="display text-xl text-red">The audit could not run.</p>
        <p className="mt-2 text-[15px] text-ink/80">{audit.error ?? 'No reason was recorded.'}</p>
        <p className="mt-3 text-[14px] text-ink/65">
          A failed audit is a missing measurement, not a clean bill of health. Nothing below should
          be read as &ldquo;the site is fine&rdquo;.
        </p>
        <div className="mt-5">
          <Button variant="secondary" onClick={onReaudit} busy={reauditing}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7 pt-2">
      <section aria-labelledby="findings-heading">
        <div className="flex items-baseline justify-between gap-4">
          <h3 id="findings-heading" className="display text-2xl text-ink">
            What was measured
          </h3>
          <span className="mono text-[11px] uppercase tracking-wider text-ink/50">
            {metricAvailability(audit)}
          </span>
        </div>

        {audit.status === 'stale' && (
          <p className="mt-3 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[14px] leading-relaxed text-ink/85">
            The page structure was checked, but the timing metrics are missing because Chrome was
            not available on the machine that ran this. The checks below are real; the numbers are
            not recorded.
          </p>
        )}

        {audit.status === 'ok' && audit.metrics.lcp_ms === undefined && (
          <p className="mt-3 border-l-4 border-ink/25 bg-paper-band px-4 py-3 text-[14px] leading-relaxed text-ink/80">
            There was no site to measure. The audit ran against the directory listing and found
            nothing to fetch, so every timing metric below is absent rather than zero.
          </p>
        )}

        {audit.findings.length === 0 ? (
          <p className="mt-4 text-[15px] text-ink/80">
            Nothing measurable was flagged. That is a fact about this run, not a promise about the
            site.
          </p>
        ) : (
          <ul className="mt-5 space-y-4">
            {audit.findings.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="metrics-heading">
        <h3 id="metrics-heading" className="display text-2xl text-ink">
          Raw numbers
        </h3>
        <Card className="mt-4 p-0">
          {metricRows(audit).map((row) => (
            <ComparisonRow key={row.label} label={row.label} value={row.value} />
          ))}
        </Card>
        <p className="mono mt-3 text-[11px] uppercase tracking-wider text-ink/50">
          Audited in {(audit.durationMs / 1000).toFixed(1)}s
          {audit.reportPath ? ` · report at ${audit.reportPath}` : ''}
        </p>
      </section>
    </div>
  );
}

/** One finding, with its evidence rendered rather than JSON-dumped. */
function FindingRow({ finding }: { finding: StoredFinding }) {
  // Severity uses the severity chip family rather than the status family: a
  // high-severity finding is not a "lost" lead, and borrowing the colour would
  // say so.
  const severityClass: ChipVariant = (
    {
      high: 'severity-high',
      medium: 'severity-medium',
      low: 'severity-low',
    } satisfies Record<StoredFinding['severity'], ChipVariant>
  )[finding.severity];

  return (
    <li className="border-l-4 border-ink/20 pl-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip variant={severityClass}>{finding.severity}</Chip>
        <span className="text-[15px] font-medium text-ink">{finding.label}</span>
      </div>
      <p className="mono mt-1.5 text-[12px] text-ink/65">{evidenceSentence(finding.evidence)}</p>
    </li>
  );
}

/**
 * Evidence as a sentence.
 *
 * The evidence record is the raw measured value and the threshold it was
 * compared against. Rendering it as a sentence means the screen never shows a
 * bare object, and the number always travels with the threshold it failed.
 */
export function evidenceSentence(evidence: Record<string, string | number | boolean>): string {
  const parts = Object.entries(evidence)
    .filter(([, value]) => value !== '' && value !== undefined && value !== null)
    .map(([key, value]) => {
      const label = key.replace(/_/g, ' ').toLowerCase();
      return `${label}: ${typeof value === 'number' ? formatNumber(value) : String(value)}`;
    });
  return parts.join(' · ') || 'no recorded values';
}

/** Numbers in the evidence are measurements, not counts, so keep them readable. */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * What the metrics corner actually says.
 *
 * `audit.status === 'ok'` does not mean there are metrics: an audit against a
 * business with no website completes successfully and measures nothing. Calling
 * that "live metrics" would put a positive label on an empty panel, which is the
 * exact confusion this project exists to avoid.
 */
export function metricAvailability(audit: AuditSummary): string {
  const hasMetrics = audit.metrics.lcp_ms !== undefined;
  if (!hasMetrics) return 'No site to measure';
  return audit.status === 'stale' ? 'Metrics unavailable' : 'Live metrics';
}

/**
 * The metric rows, with absent metrics shown as absent.
 *
 * A dashboard that renders a missing metric as `0` is lying, and the whole
 * point of this project is not lying about measurements.
 */
function metricRows(audit: AuditSummary): { label: string; value: string }[] {
  const metrics = audit.metrics;
  const rows: { label: string; value: string }[] = [
    {
      label: 'Largest contentful paint',
      value: present(metrics.lcp_ms, (v) => `${Math.round(v)} ms`),
    },
    { label: 'Cumulative layout shift', value: present(metrics.cls, (v) => v.toFixed(3)) },
    { label: 'Total blocking time', value: present(metrics.tbt_ms, (v) => `${Math.round(v)} ms`) },
    { label: 'Performance', value: present(metrics.perf_score, (v) => String(Math.round(v))) },
    { label: 'Accessibility', value: present(metrics.a11y_score, (v) => String(Math.round(v))) },
    { label: 'SEO', value: present(metrics.seo_score, (v) => String(Math.round(v))) },
  ];
  return rows;
}

function present(value: number | undefined, format: (value: number) => string): string {
  return value === undefined ? 'not measured' : format(value);
}

/* -------------------------------------------------------------------------- */
/* Draft                                                                       */
/* -------------------------------------------------------------------------- */

function DraftTab({
  drafts,
  onCreate,
  creating,
}: {
  drafts: Partial<Record<Language, DraftSummary>>;
  onCreate: () => void;
  creating: boolean;
}) {
  const [language, setLanguage] = useState<Language>('en');
  const draft = drafts[language];

  if (draft === undefined) {
    return (
      <div className="py-4">
        <p className="text-[15px] text-ink/80">No {languageLabel(language)} draft yet.</p>
        <p className="mt-2 text-[14px] text-ink/65">
          A draft is written only from this lead&rsquo;s own recorded findings. If it has no
          measurements, it gets no claims.
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={onCreate} busy={creating}>
            Write the draft
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Chip variant={draft.grounded ? 'status-won' : 'status-lost'}>
          {draft.grounded
            ? 'Every claim traces to a measurement'
            : `${draft.validationErrors.length} unsupported claim${draft.validationErrors.length === 1 ? '' : 's'}`}
        </Chip>
        <Chip variant="neutral">
          {draft.generatedBy === 'llm' ? (draft.model ?? 'model') : 'template fallback'}
        </Chip>
        <Chip variant="neutral">{(draft.latencyMs / 1000).toFixed(1)}s</Chip>
        <Chip variant="neutral">
          {draft.tokensIn} in / {draft.tokensOut} out
        </Chip>
      </div>

      <div className="flex gap-2" role="group" aria-label="Draft language">
        {(['en', 'hinglish', 'hi'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setLanguage(option)}
            aria-pressed={language === option}
            className={[
              'mono border px-3 py-1.5 text-[11px] uppercase tracking-wider transition-colors',
              language === option
                ? 'border-ink bg-ink text-paper'
                : 'border-ink/30 bg-paper text-ink/70 hover:border-ink',
            ].join(' ')}
          >
            {languageLabel(option)}
          </button>
        ))}
      </div>

      {/* Copy, never send. This is the whole thesis. */}
      <div className="space-y-4">
        <CopyBlock label="WhatsApp message" text={draft.whatsappText} />
        {draft.emailSubject !== null && draft.emailBody !== null && (
          <CopyBlock label="Email" text={`Subject: ${draft.emailSubject}\n\n${draft.emailBody}`} />
        )}
      </div>

      <p className="border-l-4 border-coral bg-coral/10 px-4 py-3 text-[14px] leading-relaxed text-ink/85">
        Read it, edit it in your own words, then send it yourself from WhatsApp or your mail client.
        This app has no send path and never will.
      </p>

      {draft.validationErrors.length > 0 && (
        <div>
          <p className="display text-lg text-red">
            {draft.generatedBy === 'fallback'
              ? 'Why the model output was rejected'
              : 'Claims that did not survive validation'}
          </p>
          <p className="mt-1 text-[14px] text-ink/70">
            {draft.generatedBy === 'fallback'
              ? 'The model wrote a draft, the validator caught the problems below, and the template replaced it. The template can only repeat what the audit measured, which is why it still passes.'
              : 'These claims are still in the draft above. Read them before sending anything.'}
          </p>
          <ul className="mono mt-3 list-disc space-y-1 pl-5 text-[12px] text-ink/70">
            {draft.validationErrors.map((error, index) => (
              // The same message can appear twice: two invented numbers produce
              // two near-identical complaints. Position disambiguates them.
              <li key={`${index}-${error}`}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A block of generated text with a copy button. */
function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);

  // Copy is the only side effect here. There is no send, no webhook, no queue.
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the text is on screen to select by hand.
      setCopied(false);
    }
  };

  return (
    <div className="border border-ink">
      <div className="flex items-center justify-between border-b border-ink/20 bg-paper-band px-4 py-2">
        <span className="mono text-[11px] font-bold uppercase tracking-[0.14em] text-ink/60">
          {label}
        </span>
        <Button variant="secondary" className="btn-sm" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="mono overflow-x-auto whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed text-ink">
        {text}
      </pre>
    </div>
  );
}

function languageLabel(language: Language): string {
  return { en: 'English', hinglish: 'Hinglish', hi: 'हिन्दी' }[language];
}

/* -------------------------------------------------------------------------- */
/* Contact log                                                                 */
/* -------------------------------------------------------------------------- */

function ContactTab({ entries }: { entries: ContactLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="py-4 text-[15px] text-ink/80">
        Nothing logged yet. Marking that you sent a message records it here, which is how the same
        business is never pitched twice.
      </p>
    );
  }

  return (
    <ol className="relative mt-2 space-y-6 pl-10">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span aria-hidden="true" className="absolute -left-[38px] top-1 size-3 bg-blue" />
          <p className="mono text-[11px] uppercase tracking-wider text-ink/50">
            {entry.channel} · {entry.event} · {new Date(entry.at).toLocaleString()}
          </p>
          {entry.note && <p className="mt-1 text-[14px] text-ink/80">{entry.note}</p>}
        </li>
      ))}
    </ol>
  );
}
