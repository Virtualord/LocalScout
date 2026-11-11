import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CompassMark, LocationPin, MiniStrip, NeighbourhoodGrid } from '../design/decorations.js';

/**
 * The interior-page hero.
 *
 * A petrol band in an asymmetric two-column composition: the headline and its
 * action on the left, a tilted "field survey" plate on the right, and a ruler of
 * ticks where the band meets the paper. Every interior screen uses this, which
 * is what makes them read as one family.
 */

export interface InteriorHeroProps {
  /** First line, paper coloured. */
  titleA: string;
  /** Second line, accent coloured. */
  titleB: string;
  subline?: string;
  /** Accent colour for the second line, by band. */
  accent?: 'blue' | 'coral' | 'amber';
  children?: ReactNode;
}

const ACCENT_CLASS = {
  blue: 'text-blue',
  coral: 'text-coral',
  amber: 'text-amber',
} as const;

export function InteriorHero({
  titleA,
  titleB,
  subline,
  accent = 'blue',
  children,
}: InteriorHeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-ink bg-bg">
      {/* The surveyed neighbourhood, bleeding off the right edge. */}
      <div className="pointer-events-none absolute -right-10 top-10 hidden rotate-[-7deg] opacity-60 lg:block">
        <NeighbourhoodGrid cols={11} rows={6} cell={20} gap={4} seed={3} />
      </div>

      <CompassMark
        size={140}
        className="pointer-events-none absolute -left-8 bottom-8 hidden text-paper/15 lg:block"
      />

      <div className="container relative grid gap-12 pb-16 pt-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end lg:pb-24">
        <div>
          <MiniStrip size={14} />

          <h1 className="display display-section mt-7 max-w-[20ch]">
            <span className="block text-paper">{titleA} </span>
            <span className={`block ${ACCENT_CLASS[accent]}`}>{titleB}</span>
          </h1>

          {subline && (
            <p className="prose-measure mt-5 text-[16px] leading-relaxed text-paper/75">
              {subline}
            </p>
          )}

          {children && <div className="mt-8">{children}</div>}
        </div>

        {/* A tilted field note: the same plate language as the home hero. */}
        <div className="hidden lg:block">
          <div className="plate-settle ml-auto w-full max-w-[350px] rotate-[2deg] border border-ink bg-paper p-4 text-ink hard-shadow">
            <div className="flex items-center justify-between gap-3">
              <span className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-ink/70">
                Field survey
              </span>
              <LocationPin size={16} className="text-coral" />
            </div>

            <div className="relative mt-3 overflow-hidden border border-ink/20 bg-paper-band">
              <NeighbourhoodGrid cols={8} rows={5} cell={21} gap={3} seed={5} />
              <LocationPin size={22} className="absolute left-[48%] top-[34%] text-coral" />
            </div>

            <p className="mono mt-3 text-[10px] uppercase leading-relaxed tracking-[0.14em] text-ink/65">
              Local businesses · measured, not guessed
            </p>
          </div>
        </div>
      </div>

      <div className="rule-ticks" />
    </section>
  );
}

/**
 * The eyebrow + two-tone heading used above a paper band.
 *
 * The right column holds a short intro paragraph aligned to the right half. The
 * second line is coral rather than the old red: coral is the identity's voice,
 * and red is now reserved for danger.
 */
export function SectionHeader({
  eyebrow,
  titleA,
  titleB,
  intro,
  onDark = false,
}: {
  eyebrow: string;
  titleA: string;
  titleB: string;
  intro?: string;
  /** Flip the palette for a petrol band. */
  onDark?: boolean;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-[1.15fr_0.85fr] md:items-end">
      <div>
        <p className={`eyebrow ${onDark ? 'text-paper/60' : 'text-ink/65'}`}>{eyebrow}</p>
        <h2 className="display display-section mt-4">
          <span className={`block ${onDark ? 'text-paper' : 'text-ink'}`}>{titleA} </span>
          <span className={`block ${onDark ? 'text-amber' : 'text-coral-deep'}`}>{titleB}</span>
        </h2>
      </div>
      {intro && (
        <p
          className={`prose-measure text-[15px] leading-relaxed md:justify-self-end ${
            onDark ? 'text-paper/70' : 'text-ink/70'
          }`}
        >
          {intro}
        </p>
      )}
    </div>
  );
}

/** A paper band with the standard vertical rhythm and an optional tick edge. */
export function Band({
  children,
  tone = 'paper',
  id,
  edge = 'ticks',
  className = '',
}: {
  children: ReactNode;
  tone?: 'paper' | 'paper-2' | 'teal' | 'dark';
  id?: string;
  /** The ruler transition at the top edge. */
  edge?: 'ticks' | 'none';
  className?: string;
}) {
  const tones = {
    paper: 'bg-paper-band text-ink',
    'paper-2': 'bg-paper-band-2 text-ink',
    teal: 'bg-bg text-paper',
    dark: 'bg-band-dark text-paper',
  } as const;

  return (
    <section id={id} className={`${tones[tone]} border-t border-ink ${className}`}>
      {edge === 'ticks' && <div className="rule-ticks" />}
      <div className="container py-20 md:py-24">{children}</div>
    </section>
  );
}

/** One step in the workflow, used by the home page's "how it works" band. */
export function WorkflowStep({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="group relative border-t-2 border-ink pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="mono text-[11px] font-bold tracking-[0.2em] text-coral-deep">
          {String(index).padStart(2, '0')}
        </span>
        <LocationPin size={14} className="text-ink/25 transition-colors group-hover:text-coral" />
      </div>
      <h3 className="display mt-2 text-xl text-ink">{title}</h3>
      <p className="mt-2 text-[14px] leading-relaxed text-ink/70">{children}</p>
    </li>
  );
}

/** The page footer: wordmark, a plot mark, and short link columns. */
interface FooterColumn {
  title: string;
  links: { label: string; to: string }[];
}

/**
 * The page footer.
 *
 * Dark, so it closes the page the way the header opens it, with a gold tick rule
 * between the two. Only links to routes and anchors that exist: a footer is the
 * easiest place to ship dead destinations.
 */
export function Footer() {
  const columns: FooterColumn[] = [
    {
      title: 'Product',
      links: [
        { label: 'Search', to: '/' },
        { label: 'Leads', to: '/leads' },
        { label: 'Dashboard', to: '/dashboard' },
        { label: 'Runs', to: '/runs' },
      ],
    },
    {
      title: 'How it works',
      links: [
        { label: 'The four steps', to: '/#how' },
        { label: 'What the score means', to: '/#score' },
        { label: 'Questions', to: '/#faq' },
      ],
    },
    {
      title: 'Configuration',
      links: [
        { label: 'Settings', to: '/settings' },
        { label: 'Health and keys', to: '/settings#health' },
      ],
    },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-ink bg-band-dark text-paper">
      <div className="rule-ticks text-paper/40" />

      <div className="pointer-events-none absolute -right-8 -top-6 opacity-20">
        <NeighbourhoodGrid cols={8} rows={5} cell={24} gap={4} seed={11} />
      </div>

      <div className="container relative py-16">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div>
            <p className="display flex items-center gap-3 text-2xl text-paper">
              Localscout
              <LocationPin size={16} className="text-amber" />
            </p>
            <p className="prose-measure mt-3 text-[14px] leading-relaxed text-paper/70">
              Local sites, audited. Pitches with proof. You send every message.
            </p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber/80">
                {column.title}
              </p>
              <ul className="mt-3 space-y-2">
                {column.links.map(({ label, to }) => (
                  <li key={label}>
                    <Link
                      to={to}
                      className="text-[14px] text-paper/75 underline decoration-paper/20 underline-offset-4 transition-colors hover:text-paper hover:decoration-amber"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <p className="mono mt-12 border-t border-paper/15 pt-6 text-[11px] uppercase tracking-[0.14em] text-paper/65">
          Local-first · MIT licensed · No data leaves your machine
        </p>
      </div>
    </footer>
  );
}
