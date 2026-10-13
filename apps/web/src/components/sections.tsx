import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { MiniStrip, PixelBars, PixelSkyline, PixelStairs } from '../design/decorations.js';

/**
 * The interior-page hero.
 *
 * A teal band with the four-colour strip, the pixel stairs at the top left and
 * the skyline at the right edge crossing the teal-to-paper boundary. Every
 * interior screen uses this, which is what makes them read as one family.
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
      {/* Stairs and bars, anchored under the header at the left edge. */}
      <div className="pointer-events-none absolute left-0 top-0 flex items-start">
        <div className="flex items-start">
          <PixelBars />
          <PixelStairs steps={6} cell={20} />
        </div>
      </div>

      {/* Skyline, overlapping the band boundary on the right. */}
      <div className="pointer-events-none absolute bottom-0 right-6 translate-y-1/2">
        <PixelSkyline columns={9} cell={20} />
      </div>

      <div className="container relative pb-14 pt-24 text-center">
        <div className="flex justify-center">
          <MiniStrip />
        </div>

        <h1 className="display display-section mx-auto mt-6 max-w-[18ch]">
          <span className="block text-paper">{titleA} </span>
          <span className={`block ${ACCENT_CLASS[accent]}`}>{titleB}</span>
        </h1>

        {subline && <p className="prose-measure mx-auto mt-4 text-paper/75">{subline}</p>}

        {children && <div className="mt-7">{children}</div>}
      </div>
    </section>
  );
}

/**
 * The eyebrow + two-tone heading used above a paper band.
 *
 * The right column holds a short intro paragraph aligned to the right half, per
 * the section-header grid.
 */
export function SectionHeader({
  eyebrow,
  titleA,
  titleB,
  intro,
}: {
  eyebrow: string;
  titleA: string;
  titleB: string;
  intro?: string;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2 md:items-end">
      <div>
        <p className="eyebrow text-ink/55">{eyebrow}</p>
        <h2 className="display display-section mt-3">
          <span className="text-ink">{titleA} </span>
          <span className="text-red">{titleB}</span>
        </h2>
      </div>
      {intro && (
        <p className="prose-measure text-[15px] leading-relaxed text-ink/70 md:justify-self-end">
          {intro}
        </p>
      )}
    </div>
  );
}

/** A paper band with the standard vertical rhythm. */
export function Band({
  children,
  tone = 'paper',
  id,
  className = '',
}: {
  children: ReactNode;
  tone?: 'paper' | 'paper-2' | 'teal' | 'dark';
  id?: string;
  className?: string;
}) {
  const tones = {
    paper: 'bg-paper-band',
    'paper-2': 'bg-paper-band-2',
    teal: 'bg-bg',
    dark: 'bg-band-dark',
  } as const;

  return (
    <section id={id} className={`${tones[tone]} border-t border-ink py-24 ${className}`}>
      <div className="container">{children}</div>
    </section>
  );
}

/** The page footer: wordmark plus four short link columns. */
/** One footer column: a heading and its links. */
interface FooterColumn {
  title: string;
  links: { label: string; to: string }[];
}

/**
 * The page footer.
 *
 * Only links to routes that exist. A footer is the easiest place to ship dead
 * destinations, and a link to a repository that was deliberately never created
 * is worse than no link at all.
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
        { label: 'Styleguide', to: '/styleguide' },
      ],
    },
  ];

  return (
    <footer className="border-t border-ink bg-paper py-16">
      <div className="container">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div>
            <p className="display text-2xl text-ink">Localscout</p>
            <p className="prose-measure mt-3 text-[14px] leading-relaxed text-ink/70">
              Local sites, audited. Pitches with proof. You send every message.
            </p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink/50">
                {column.title}
              </p>
              <ul className="mt-3 space-y-2">
                {column.links.map(({ label, to }) => (
                  <li key={label}>
                    <Link
                      to={to}
                      className="text-[14px] text-ink/75 underline decoration-ink/25 underline-offset-4 transition-colors hover:text-ink"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <p className="mono mt-12 border-t border-ink/15 pt-6 text-[11px] uppercase tracking-wider text-ink/50">
          Local-first · MIT licensed · No data leaves your machine
        </p>
      </div>
    </footer>
  );
}
