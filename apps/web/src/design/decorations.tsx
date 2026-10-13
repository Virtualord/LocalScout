import { useEffect, useState } from 'react';

/**
 * Pixel decorations and the route loader.
 *
 * These are the small marks that carry the design's character: the four-colour
 * strip, the staircase, and the skyline. All are built from plain divs at fixed
 * pixel sizes, which is what keeps them sharp at any zoom and free of assets.
 *
 * Every one of them is deterministic given a seed, and deterministic geometry
 * is what makes them testable: `pixelStairs(5)` and `skyline(8, 3)` are the same
 * every time, so a snapshot means something.
 */

/** The four accent colours, in the reference's order. */
const STRIP_COLOURS = [
  'var(--color-red)',
  'var(--color-blue)',
  'var(--color-amber)',
  'var(--color-coral)',
] as const;

/**
 * The four-colour mini strip.
 *
 * Sits above interior-page headlines and doubles as the favicon, which is why
 * it is the one decoration that has to be exact.
 */
export function MiniStrip({ size = 16 }: { size?: number }) {
  return (
    <div className="flex" style={{ width: size * 4, height: size }} aria-hidden="true">
      {STRIP_COLOURS.map((colour, index) => (
        <div
          key={index}
          data-testid="strip-square"
          style={{ width: size, height: size, backgroundColor: colour }}
        />
      ))}
    </div>
  );
}

/**
 * Pixel stairs.
 *
 * A descending staircase: one cell right and one down per step. Drawn rather
 * than described so the geometry is a pure function of `steps` and `cell`.
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
      {cells.map((position) => (
        <div
          key={`${position.x}-${position.y}`}
          style={{
            position: 'absolute',
            left: position.x * cell,
            top: position.y * cell,
            width: cell,
            height: cell,
            backgroundColor: 'var(--color-paper)',
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
 * The vertical red bars behind the top of the staircase.
 *
 * Fixed heights in cell steps, so they read as an extension of the same grid
 * rather than as a separate decoration.
 */
export function PixelBars({ cell = 24 }: { cell?: number }) {
  return (
    <div className="pointer-events-none flex items-end gap-2" aria-hidden="true">
      {[1, 3, 2].map((heightSteps, index) => (
        <div
          key={index}
          style={{
            width: 8,
            height: heightSteps * cell * 0.5,
            backgroundColor: 'var(--color-red)',
          }}
        />
      ))}
    </div>
  );
}

/**
 * The pixel skyline.
 *
 * Columns of paired red/coral halves whose heights re-seed on a timer. In the
 * reference the arrangement visibly changed between frames, which is what makes
 * it feel alive without any scroll animation; here that is reproduced with a
 * stepped change every 1200ms, and frozen under reduced motion.
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
          <div style={{ height: height * cell * 0.5, backgroundColor: 'var(--color-red)' }} />
          <div style={{ height: height * cell * 0.5, backgroundColor: 'var(--color-coral)' }} />
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
 * The route loader.
 *
 * Four squares bobbing in a left-to-right wave. Minimum visible time is 200ms so
 * a fast response does not flash, which reads as a glitch rather than as speed.
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

  const animation = reduceMotion
    ? undefined
    : `loader-bob 1000ms ease-in-out ${visible ? 'infinite' : 'paused'}`;

  return (
    <div
      className="flex items-center justify-center gap-0 py-16"
      role="status"
      aria-label="Loading"
    >
      <div className="flex">
        {STRIP_COLOURS.map((colour, index) => (
          <div
            key={index}
            style={{
              width: size,
              height: size,
              backgroundColor: colour,
              animation,
              // 100ms stagger produces the left-to-right wave.
              animationDelay: reduceMotion ? undefined : `${index * 100}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
