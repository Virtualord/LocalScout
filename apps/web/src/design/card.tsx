import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

/**
 * Cards.
 *
 * Three card shapes, matching the reference's patterns:
 *
 * - **Lead card**: paper face, hard shadow whose colour encodes tier, and a
 *   score block divided off by a 1px rule on the right.
 * - **Dashed CTA card**: transparent, 1px dashed, for "run another search".
 * - **Comparison card**: paper face with a chip header and mono label/value
 *   rows separated by 20% ink rules.
 *
 * All three press into their shadow on hover, which is the reference's signature
 * interaction and is applied here rather than on every clickable element,
 * because a card that moves is an affordance that a row in a table does not.
 */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Shadow colour. HOT leads use the coral shadow, everything else the dark one. */
  tier?: 'hot' | 'normal';
  /** Disable the press-in hover, for a static card. */
  static?: boolean;
  children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tier = 'normal', static: isStatic = false, className = '', children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={[
        'bg-paper border border-ink',
        tier === 'hot' ? 'hard-shadow-coral' : 'hard-shadow',
        !isStatic ? 'press-in' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
});

/**
 * The dashed call-to-action card.
 *
 * Always the last item in a grid. It is visually lighter than a real lead so it
 * never reads as one, while keeping the same footprint so the grid stays even.
 */
export const DashedCtaCard = forwardRef<HTMLButtonElement, HTMLAttributes<HTMLButtonElement>>(
  function DashedCtaCard({ className = '', children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={[
          'w-full border border-dashed border-ink bg-transparent p-6 text-left',
          'display-card text-ink',
          'cursor-pointer transition-colors duration-[--dur-fast]',
          'hover:bg-paper',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...(rest as HTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  },
);

/**
 * The score block: the right-hand panel of a lead card.
 *
 * Mirrors the reference's "date block": a tiny mono label, a very large number,
 * and the denominator underneath. The number is the point, so it gets the
 * display face at the largest size in the card.
 */
export function ScoreBlock({ score }: { score: number | null | undefined }) {
  return (
    <div className="border-l border-ink pl-5 text-center">
      <div className="mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink/70">
        Score
      </div>
      <div className="display my-1 text-5xl leading-none text-ink">
        {score === null || score === undefined ? '—' : score}
      </div>
      <div className="mono text-[10px] uppercase tracking-wider text-ink/60">/100</div>
    </div>
  );
}

/**
 * A label/value row for comparison cards.
 *
 * Mono on both sides, the value bold, separated by a 20% ink rule.
 */
export function ComparisonRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink/20 py-2.5 last:border-b-0">
      <span className="mono text-[11px] uppercase tracking-wider text-ink/70">{label}</span>
      <span className="mono text-[13px] font-bold text-ink">{value}</span>
    </div>
  );
}

export function ComparisonCard({
  title,
  chip,
  rows,
}: {
  title: string;
  chip?: ReactNode;
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="display-card text-ink">{title}</h3>
        {chip}
      </div>
      <div>
        {rows.map((row) => (
          <ComparisonRow key={row.label} label={row.label} value={row.value} />
        ))}
      </div>
    </Card>
  );
}
