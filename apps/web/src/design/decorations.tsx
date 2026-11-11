import { useEffect, useState } from 'react';

/**
 * Decorative motifs and the route loader — "Local Business Exploration".
 *
 * These are the small marks that carry the identity: a surveyed neighbourhood,
 * a location pin, a measure scale, and a plot stamp. All are built from plain
 * divs and inline SVG at fixed pixel sizes, which keeps them sharp at any zoom
 * and free of image assets.
 *
 * Every one of them is deterministic given a seed, and deterministic geometry is
 * what makes them testable: `pixelStairs(5)` and `skyline(8, 3)` are the same
 * every time, so a snapshot means something.
 */

/** The four survey pigments, in the order they appear on a plot stamp. */
const SURVEY_COLOURS = [
  'var(--color-amber)',
  'var(--color-coral)',
  'var(--color-blue)',
  'var(--color-sage)',
] as const;

/**
 * The survey mark.
 *
 * A 2x2 plot stamp: four cells of a map, one of each pigment, separated by the
 * surface behind them so the gaps read as survey lines. It sits above interior
 * page headlines and doubles as the favicon.
 */
export function MiniStrip({ size = 16 }: { size?: number }) {
  const gap = Math.max(1, Math.round(size * 0.14));
  return (
    <div
      className="grid"
      aria-hidden="true"
      style={{
        gridTemplateColumns: `repeat(2, ${size}px)`,
        gridAutoRows: `${size}px`,
        gap,
        width: size * 2 + gap,
        height: size * 2 + gap,
      }}
    >
      {SURVEY_COLOURS.map((colour, index) => (
        <div key={index} data-testid="strip-square" style={{ backgroundColor: colour }} />
      ))}
    </div>
  );
}

/**
 * Pixel stairs.
 *
 * A descending staircase of survey cells: one cell right and one down per step.
 * Drawn rather than described so the geometry is a pure function of `steps`
 * and `cell`. Alternating pigments make it read as a plotted route rather than
 * a solid wedge.
 */
export function PixelStairs({
  steps = 6,
  cell = 24,
  className = '',
}: {
  steps?: number;
  cell?: number;
  className?: string;
}) {
  const cells = buildStairs(steps);

  return (
    <div
      aria-hidden="true"
      className={['pointer-events-none select-none', className].filter(Boolean).join(' ')}
      style={{ width: steps * cell, height: steps * cell, position: 'relative' }}
    >
      {cells.map((position, index) => (
        <div
          key={`${position.x}-${position.y}`}
          style={{
            position: 'absolute',
            left: position.x * cell,
            top: position.y * cell,
            width: cell,
            height: cell,
            backgroundColor: index % 2 === 0 ? 'var(--color-amber)' : 'var(--color-paper)',
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  );
}

/** The staircase geometry: one cell right, one down, per step. */
export function buildStairs(steps: number): { x: number; y: number }[] {
  return Array.from({ length: steps }, (_, index) => ({ x: index, y: index }));
}

/**
 * The measure scale: three vertical bars of different heights, like the columns
 * of a Lighthouse report before the numbers are drawn. Fixed heights in cell
 * steps, so it reads as part of the same grid rather than an unrelated doodle.
 */
export function PixelBars({ cell = 24 }: { cell?: number }) {
  return (
    <div className="pointer-events-none flex items-end gap-2" aria-hidden="true">
      {[1, 3, 2].map((heightSteps, index) => (
        <div
          key={index}
          style={{
            width: index === 1 ? 8 : 6,
            height: heightSteps * cell * 0.5,
            backgroundColor: SURVEY_COLOURS[index],
          }}
        />
      ))}
    </div>
  );
}

/**
 * The city-block skyline.
 *
 * Columns of paired gold/coral halves whose heights re-seed on a timer. The
 * reference arrangement changed between frames, which is what makes it feel
 * alive without any scroll animation; here that is reproduced with a stepped
 * change every 1200ms, and frozen under reduced motion.
 */
export function PixelSkyline({
  columns = 9,
  cell = 24,
  /** Seed for deterministic rendering. Also used by tests. */
  seed = 1,
  /** Set false to freeze the heights, which reduced-motion does. */
  animate = true,
  className = '',
}: {
  columns?: number;
  cell?: number;
  seed?: number;
  animate?: boolean;
  className?: string;
}) {
  const [currentSeed, setCurrentSeed] = useState(seed);

  useEffect(() => {
    if (!animate) return;
    const timer = setInterval(() => setCurrentSeed((value) => value + 1), 1200);
    return () => clearInterval(timer);
  }, [animate]);

  const heights = buildSkyline(columns, currentSeed);

  return (
    <div
      aria-hidden="true"
      className={['pointer-events-none select-none flex items-end', className]
        .filter(Boolean)
        .join(' ')}
    >
      {heights.map((height, index) => (
        <div key={index} className="flex flex-col-reverse" style={{ width: cell }}>
          <div style={{ height: height * cell * 0.5, backgroundColor: 'var(--color-coral)' }} />
          <div style={{ height: height * cell * 0.5, backgroundColor: 'var(--color-amber)' }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Skyline heights: 1 to 4 cell-steps per column.
 *
 * A small deterministic hash rather than `Math.random`, so the same seed always
 * draws the same skyline and a test can assert on it.
 */
export function buildSkyline(columns: number, seed: number): number[] {
  return Array.from({ length: columns }, (_, index) => 1 + (hash(index + seed * 31) % 4));
}

/** A small integer hash. Deterministic and dependency-free. */
function hash(value: number): number {
  let result = value;
  result = result ^ 61 ^ (result >>> 16);
  result = result + (result << 3);
  result = result ^ (result >>> 4);
  result = Math.imul(result, 0x27d4eb2d);
  result = result ^ (result >>> 15);
  return Math.abs(result);
}

/**
 * A surveyed neighbourhood.
 *
 * An abstract street grid: outlined lots with a handful filled in, the way a
 * print cartographer colours a handful of blocks on a town plan. Roads are the
 * gaps, and every third row and column is left as a through street so the grid
 * reads as a place rather than as a spreadsheet.
 *
 * Seeded, so the same block is coloured on every render.
 */
export function NeighbourhoodGrid({
  cols = 8,
  rows = 5,
  cell = 22,
  gap = 3,
  seed = 1,
  className = '',
}: {
  cols?: number;
  rows?: number;
  cell?: number;
  gap?: number;
  seed?: number;
  className?: string;
}) {
  const lots = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const value = blockNoise(col, row, seed);
      const isRoad = col === 0 || row === 0 || col % 3 === 0 || row % 4 === 0;
      lots.push({
        key: `${col}-${row}`,
        isRoad,
        fill: isRoad ? 'transparent' : blockColour(value),
      });
    }
  }

  return (
    <div
      aria-hidden="true"
      className={['pointer-events-none select-none', className].filter(Boolean).join(' ')}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
        gridAutoRows: `${cell}px`,
        gap,
      }}
    >
      {lots.map((lot) => (
        <div
          key={lot.key}
          style={{
            backgroundColor: lot.fill,
            border: lot.isRoad
              ? 'none'
              : '1px solid color-mix(in srgb, var(--color-ink) 24%, transparent)',
          }}
        />
      ))}
    </div>
  );
}

/** Deterministic per-lot noise, kept out of the render so it is testable. */
function blockNoise(col: number, row: number, seed: number): number {
  return hash(col * 17 + row * 131 + seed * 7) % 1000;
}

/** Which lots are coloured, and in which pigment. */
function blockColour(noise: number): string {
  if (noise < 600) return 'color-mix(in srgb, var(--color-ink) 6%, transparent)';
  if (noise < 750) return 'var(--color-amber)';
  if (noise < 850) return 'var(--color-coral)';
  if (noise < 920) return 'var(--color-blue)';
  return 'color-mix(in srgb, var(--color-ink) 55%, transparent)';
}

/**
 * The location pin.
 *
 * An original mark: a square survey head over a tapering stem, drawn in the
 * same pixel vocabulary as the map squares. Used as the bullet on section
 * labels and on the hero plate.
 */
export function LocationPin({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={['shrink-0', className].filter(Boolean).join(' ')}
    >
      {/* Head: a filled square with a paper-coloured survey hole. */}
      <rect x="4" y="2" width="16" height="16" fill="currentColor" />
      <rect x="10" y="8" width="4" height="4" fill="var(--color-paper)" />
      {/* Stem: two cells, narrowing. */}
      <rect x="9" y="18" width="6" height="2" fill="currentColor" />
      <rect x="10" y="20" width="4" height="2" fill="currentColor" />
      <rect x="11" y="22" width="2" height="2" fill="currentColor" />
    </svg>
  );
}

/**
 * The compass mark.
 *
 * A crosshair and a diagonal: the orientation mark on a field map. Used behind
 * hero headings and as a quiet corner decoration.
 */
export function CompassMark({ size = 64, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={['shrink-0', className].filter(Boolean).join(' ')}
    >
      <rect x="31" y="4" width="2" height="56" fill="currentColor" />
      <rect x="4" y="31" width="56" height="2" fill="currentColor" />
      <rect
        x="22"
        y="22"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect x="30" y="18" width="4" height="4" fill="currentColor" />
      <rect x="30" y="42" width="4" height="4" fill="currentColor" />
      <rect x="18" y="30" width="4" height="4" fill="currentColor" />
      <rect x="42" y="30" width="4" height="4" fill="currentColor" />
    </svg>
  );
}

/**
 * The route loader.
 *
 * Four survey cells bobbing in a left-to-right wave. Minimum visible time is
 * 200ms so a fast response does not flash, which reads as a glitch rather than
 * as speed.
 *
 * Under reduced motion the squares are shown static: the user still knows the
 * page is loading, without the motion.
 */
export function RouteLoader({ size = 40 }: { size?: number }) {
  const [visible, setVisible] = useState(false);
  // Read during the first render, not in an effect, so the very first painted
  // frame already honours the user's motion preference.
  const [reduceMotion, setReduceMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    // The listener is registered in an effect; the initial value is read during
    // the first render so the loader does not animate for one frame under
    // reduced motion before the media query is consulted.
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduceMotion(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Held for a minimum so a cached response does not flash the loader.
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="flex items-center justify-center gap-0 py-16"
      role="status"
      aria-label="Loading"
    >
      <div className="flex" style={{ gap: 6 }}>
        {SURVEY_COLOURS.map((colour, index) => (
          <div
            key={index}
            style={{
              width: size,
              height: size,
              backgroundColor: colour,
              /*
               * Longhand properties rather than the `animation` shorthand.
               * Setting a shorthand alongside `animationDelay` makes React
               * warn on rerender, because the shorthand resets the delay and
               * the two properties fight.
               */
              ...(reduceMotion
                ? {}
                : {
                    animationName: 'loader-bob',
                    animationDuration: '1000ms',
                    animationTimingFunction: 'ease-in-out',
                    animationIterationCount: visible ? 'infinite' : 'paused',
                    // 100ms stagger produces the left-to-right wave.
                    animationDelay: `${index * 100}ms`,
                  }),
            }}
          />
        ))}
      </div>
    </div>
  );
}
