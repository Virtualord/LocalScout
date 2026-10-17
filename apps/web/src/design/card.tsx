import { forwardRef, type AnchorHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';

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
/** The dashed card's appearance, shared by the button and the link form. */
const DASHED_CTA_CLASSES = [
  'w-full border border-dashed border-ink bg-transparent p-6 text-left',
  'display-card text-ink',
  'transition-colors duration-[--dur-fast]',
  'hover:bg-paper',
].join(' ');

export const DashedCtaCard = forwardRef<HTMLButtonElement, HTMLAttributes<HTMLButtonElement>>(
  function DashedCtaCard({ className = '', children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={[DASHED_CTA_CLASSES, 'cursor-pointer', className].filter(Boolean).join(' ')}
        {...(rest as HTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  },
);

/**
 * The dashed card as a link.
 *
 * The same shape, but it goes somewhere. A "run another search" card that is a
 * button with no handler is a dead control, which is the one thing a card in a
 * grid must not be.
 */
export const DashedCtaLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
  function DashedCtaLink({ className = '', children, ...rest }, ref) {
    return (
      <a ref={ref} className={[DASHED_CTA_CLASSES, className].filter(Boolean).join(' ')} {...rest}>
        {children}
      </a>
    );
  },
);

/**
 * The score block: the right-hand panel of a lead card.
 *
 * Mirrors the reference's "date block": a tiny mono label, a very large number,
 * and the denominator underneath. The number is the point, so it gets the
 * display face at the largest size in the card.
 *
 * An absent score says so in words. A full-size em dash over "/100" reads as a
 * rendering glitch rather than as a measurement that was never taken, which is
 * the opposite of what this project is for.
 */
export function ScoreBlock({ score }: { score: number | null | undefined }) {
  const missing = score === null || score === undefined;

  return (
    <div className="border-l border-ink pl-5 text-center">
      <div className="mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink/70">
        Score
      </div>
      {missing ? (
        <div className="my-2 flex h-12 items-center justify-center">
          {/*
            "Not measured", not "Not audited": the tier chip already states the
            lead's state, and two blocks reading identically look like a bug.
            This one answers the narrower question, which is whether a number
            exists.
          */}
          <span className="mono max-w-[7ch] text-[10px] uppercase leading-tight tracking-wider text-ink/45">
            Not measured
          </span>
        </div>
      ) : (
        <>
          <div className="display my-1 text-5xl leading-none text-ink">{score}</div>
          <div className="mono text-[10px] uppercase tracking-wider text-ink/60">/100</div>
        </>
      )}
    </div>
  );
}

/**
 * A label/value row for comparison cards.
 *
 * A description list, because a label and its value are a pair: markup that
 * says so gives a screen reader a pause between them, and it puts a line break
 * in copied text instead of the two running together as `DiscoveryFixtures`.
 *
 * Mono on both sides, the value bold, separated by a 20% ink rule. The rule runs
 * the full width of the card, so the text brings its own inset — the cards these
 * rows live in have no padding of their own, and text with no inset sits with its
 * face against the border.
 *
 * Side by side once there is room for both, and stacked below that. A value such
 * as "Fixtures — the bundled listings, no key needed" is wider than a phone, and
 * when the two are forced onto one line the label ends up touching the value's
 * first word.
 */
export function ComparisonRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <dl className="grid gap-x-4 border-b border-ink/20 px-4 py-2.5 last:border-b-0 sm:grid-cols-[auto_1fr] sm:items-baseline sm:px-5">
      <dt className="mono min-w-0 text-[11px] uppercase tracking-wider text-ink/70">{label}</dt>
      <dd className="mono min-w-0 break-words text-[13px] font-bold text-ink sm:text-right">
        {value}
      </dd>
    </dl>
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
    <Card className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-ink/20 px-5 py-4">
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
