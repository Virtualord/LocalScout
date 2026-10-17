import { Link } from 'react-router';
import { Card, DashedCtaLink, ScoreBlock } from '../../design/card.js';
import { Chip, TierChip, tierForScore } from '../../design/chip.js';
import { CheckIcon } from '../../design/input.js';
import type { LeadSummary } from '../../lib/api.js';

/**
 * The lead card.
 *
 * Mirrors the reference's event card: a name, chips, a category and address line
 * with a small mark, and one plain sentence stating the biggest measured
 * problem. The right block is the score, divided off by a rule.
 *
 * The hard shadow's colour encodes the tier, which is the reference's trick and
 * the reason a hot lead reads instantly in a grid.
 */

export interface LeadCardProps {
  lead: LeadSummary;
  /** Opens the modal instead of navigating. */
  onOpen?: (id: string) => void;
}

/**
 * Every card in the list is this tall.
 *
 * A card's natural height depends on what it happens to know: an address long
 * enough to wrap costs an extra line, and a lead with nothing to report has no
 * finding line at all. Grid rows are independent, so those differences did not
 * average out — they made rows of 166px, 148px and 164px in the same grid, and a
 * card with less to say looked like a card that mattered less.
 *
 * A floor rather than a fixed height, on purpose: the lines above the finding are
 * each pinned to one line (the address truncates, the title truncates, the chips
 * are one row), so every card's content is the same shape and this floor is
 * exactly that shape. Anything genuinely taller — a fourth chip forcing a second
 * row, say — still grows rather than clipping its own content.
 */
const CARD_MIN_HEIGHT = 'min-h-[152px]';

/** The single sentence a lead card shows about its worst problem. */
export function topFindingLine(lead: LeadSummary): string | undefined {
  if (lead.status === 'discovered') return 'Not audited yet';
  if (lead.opportunityScore === null) return 'Audit did not complete';

  if (lead.websiteUrl === null) return 'No website of its own';

  // The facts are stored per lead; the summary does not carry the findings, so
  // the card states what it can verify from the summary alone.
  if (lead.contactEmail === null && lead.phoneE164) {
    return 'No published email on the site';
  }
  return undefined;
}

export function LeadCard({ lead, onOpen }: LeadCardProps) {
  const tier = tierForScore(lead.opportunityScore);
  const finding = topFindingLine(lead);

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <TierChip score={lead.opportunityScore} auditStatus={lead.auditStatus} />
          <StatusChip status={lead.status} />
          {lead.canWhatsApp && <Chip variant="neutral">WhatsApp</Chip>}
        </div>

        <h3 className="display-card mt-3 truncate text-ink">{lead.name}</h3>

        {/*
          One line, always. This line wrapping to two is what made some cards
          taller than others, and the full address is in the modal — which is
          where someone goes to read it, rather than squinting at a card.
        */}
        <p className="mono mt-1.5 flex items-center gap-2 text-[12px] text-ink/65">
          <span className="inline-block size-2 shrink-0 bg-ink/40" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {lead.category ?? 'Business'}
            {lead.address ? ` · ${lead.address}` : ''}
          </span>
        </p>

        {finding && <p className="mt-2 text-[13px] leading-snug text-ink/80">{finding}</p>}
      </div>

      <ScoreBlock score={lead.opportunityScore} />
    </>
  );

  const className = ['flex items-start justify-between gap-5 p-5', CARD_MIN_HEIGHT].join(' ');

  if (onOpen) {
    return (
      <Card tier={tier === 'hot' ? 'hot' : 'normal'} className={className} static>
        <button
          type="button"
          onClick={() => onOpen(lead.id)}
          className="flex w-full flex-1 items-start justify-between gap-5 text-left"
        >
          {body}
        </button>
      </Card>
    );
  }

  return (
    <Link to={`/leads?lead=${lead.id}`} className="block">
      <Card tier={tier === 'hot' ? 'hot' : 'normal'} className={className}>
        {body}
      </Card>
    </Link>
  );
}

/**
 * Status chip.
 *
 * The label carries the meaning; the colour only reinforces it, so the status is
 * readable without distinguishing one colour from another.
 */
export function StatusChip({ status }: { status: LeadSummary['status'] }) {
  const variant = {
    sent: 'status-sent',
    replied: 'status-replied',
    won: 'status-won',
    lost: 'status-lost',
  } as const;

  if (status === 'sent') {
    return (
      <Chip variant="status-sent">
        <CheckIcon />
        Sent
      </Chip>
    );
  }

  if (status in variant) {
    return <Chip variant={variant[status as keyof typeof variant]}>{status}</Chip>;
  }

  if (status === 'skipped') return <Chip variant="severity-low">Skipped</Chip>;
  if (status === 'drafted') return <Chip variant="finding">Draft ready</Chip>;
  if (status === 'audited') return <Chip variant="severity-medium">Audited</Chip>;
  if (status === 'approved') return <Chip variant="finding">Reviewed</Chip>;

  return <Chip variant="neutral">New</Chip>;
}

/**
 * The dashed "run another search" card, always last in a grid.
 *
 * The same height as a lead card, for the same reason: it sits in the last row of
 * the same grid, and a card 60px shorter than the one above it reads as a
 * mistake rather than as a lighter kind of card.
 */
export function NewSearchCard() {
  return (
    <DashedCtaLink href="/" className={`${CARD_MIN_HEIGHT} flex flex-col justify-center`}>
      <span className="display-card block">Run another search.</span>
      <span className="mt-2 block text-[14px] text-ink/70">
        Try a different business type or city.
      </span>
    </DashedCtaLink>
  );
}
