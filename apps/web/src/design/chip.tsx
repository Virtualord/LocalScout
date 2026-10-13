import type { ReactNode } from 'react';

/**
 * Chips.
 *
 * Small, mono, uppercase, sharp. They carry status and tier, so each variant is
 * a colour pair with a text label. Colour is never the only signal: a chip
 * always has words in it, which is what keeps the status list readable for
 * someone who cannot distinguish coral from pink.
 */

export type ChipVariant =
  | 'hot'
  | 'neutral'
  | 'finding'
  | 'status-sent'
  | 'status-replied'
  | 'status-won'
  | 'status-lost'
  | 'severity-high'
  | 'severity-medium'
  | 'severity-low';

export interface ChipProps {
  variant?: ChipVariant;
  children: ReactNode;
  className?: string;
}

const CLASSES: Record<ChipVariant, string> = {
  hot: 'bg-pink text-ink',
  neutral: 'bg-sage text-ink',
  finding: 'bg-paper text-ink border border-ink',
  'status-sent': 'bg-ink text-paper',
  'status-replied': 'bg-amber text-ink',
  'status-won': 'bg-coral text-ink',
  'status-lost': 'bg-paper-band-2 text-ink border border-ink',
  'severity-high': 'bg-coral text-ink',
  'severity-medium': 'bg-amber text-ink',
  'severity-low': 'bg-sage text-ink',
};

export function Chip({ variant = 'neutral', children, className = '' }: ChipProps) {
  return (
    <span
      className={[
        'mono inline-flex items-center gap-1 px-2 py-[3px] text-[11px] font-bold uppercase tracking-wider',
        CLASSES[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}

/**
 * A chip that marks a lead's tier.
 *
 * The tier is derived from the opportunity score, so the same lead always shows
 * the same chip. HOT is the only tier with a distinct colour, matching the
 * reference where the top card stands out and the rest do not compete with it.
 */
export function tierForScore(
  score: number | null | undefined,
): 'hot' | 'warm' | 'cold' | 'unknown' {
  if (score === null || score === undefined) return 'unknown';
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

/**
 * The tier label for a lead.
 *
 * Three distinct no-score states, because collapsing them would repeat the exact
 * lie this project is built to avoid:
 *
 * - no audit row at all: nobody has looked yet.
 * - an `unavailable` audit: somebody looked and could not reach the site.
 * - a score of null with no stated reason: treated as not audited, which is what
 *   an unaudited lead actually is.
 */
export function tierLabel(
  score: number | null | undefined,
  auditStatus: 'ok' | 'stale' | 'unavailable' | null | undefined,
): string {
  if (score !== null && score !== undefined) {
    const tier = tierForScore(score);
    return tier === 'hot' ? 'Hot' : tier === 'warm' ? 'Warm' : 'Cold';
  }
  return auditStatus === 'unavailable' ? 'Not checked' : 'Not audited';
}

export function TierChip({
  score,
  auditStatus,
}: {
  score: number | null | undefined;
  /** Distinguishes "never audited" from "the site could not be reached". */
  auditStatus?: 'ok' | 'stale' | 'unavailable' | null | undefined;
}) {
  const tier = tierForScore(score);
  const label = tierLabel(score, auditStatus);

  return <Chip variant={tier === 'hot' ? 'hot' : 'neutral'}>{label}</Chip>;
}
