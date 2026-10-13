import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The pointer spotlight.
 *
 * The reference's signature effect: land cells within a radius of the pointer
 * brighten, and the light centre eases toward the pointer rather than snapping.
 * Two details make it feel alive rather than mechanical:
 *
 * - **Eased follow.** The light target lerps 0.25 per frame, so fast movement
 *   leaves a short trail. Snapping looks cheap.
 * - **Fade out.** On pointer leave the light does not vanish; it fades over
 *   300ms. An instant cut reads as a glitch.
 *
 * Disabled entirely on touch (there is no hover) and under `prefers-reduced-motion`
 * (where the state changes but instantly, with no easing and no trail).
 */

export interface SpotlightState {
  /** Where the light actually is, in CSS pixels. */
  x: number;
  y: number;
  /** 0 to 1. Fades on pointer leave. */
  strength: number;
  /** True when the spotlight is active at all. */
  active: boolean;
}

export interface UseSpotlightOptions {
  /** How fast the light catches up per frame. */
  lerp?: number;
  /** Fade duration on pointer leave, in ms. */
  fadeOutMs?: number;
  /** Disabled on touch devices and under reduced motion. */
  enabled?: boolean;
}

/** Is this a device where hover exists? */
export function isHoverCapable(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useSpotlight(options: UseSpotlightOptions = {}) {
  const { lerp = 0.25, fadeOutMs = 300, enabled: enabledOption } = options;

  const [state, setState] = useState<SpotlightState>({ x: 0, y: 0, strength: 0, active: false });

  // Animation state lives in refs: this runs every frame, and a re-render per
  // frame would make the map stutter.
  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const strengthRef = useRef(0);
  const frameRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);

  const enabled = enabledOption ?? (isHoverCapable() && !prefersReducedMotion());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  /**
   * The animation loop.
   *
   * Declared as a ref-held function rather than a `useCallback` that schedules
   * itself, because a self-scheduling callback refers to itself inside its own
   * initializer. A ref reads the same way and sidesteps that entirely.
   */
  const stepRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const loop = () => {
      const target = targetRef.current;
      const current = currentRef.current;
      const dx = target.x - current.x;
      const dy = target.y - current.y;

      // Eased follow, or a direct jump under reduced motion.
      const reduce = prefersReducedMotion();
      current.x = reduce ? target.x : current.x + dx * lerp;
      current.y = reduce ? target.y : current.y + dy * lerp;

      if (mountedRef.current) {
        setState({
          x: current.x,
          y: current.y,
          strength: strengthRef.current,
          active: strengthRef.current > 0,
        });
      }

      const stillMoving =
        Math.abs(target.x - current.x) > 0.5 || Math.abs(target.y - current.y) > 0.5;

      if (stillMoving && strengthRef.current > 0) {
        frameRef.current = requestAnimationFrame(loop);
      } else {
        frameRef.current = undefined;
      }
    };

    stepRef.current = loop;
  }, [lerp]);

  const start = useCallback(
    (x: number, y: number) => {
      if (!enabled) return;
      targetRef.current = { x, y };
      // First entry snaps rather than easing from a stale position.
      if (strengthRef.current === 0) currentRef.current = { x, y };
      strengthRef.current = 1;
      if (frameRef.current === undefined) frameRef.current = requestAnimationFrame(stepRef.current);
    },
    [enabled],
  );

  const stop = useCallback(() => {
    if (!enabled) return;
    // Fade rather than cut.
    const started = strengthRef.current;
    const startTime = Date.now();

    const fade = () => {
      const progress = Math.min(1, (Date.now() - startTime) / fadeOutMs);
      strengthRef.current = started * (1 - progress);

      if (mountedRef.current) {
        setState({
          x: currentRef.current.x,
          y: currentRef.current.y,
          strength: strengthRef.current,
          active: strengthRef.current > 0,
        });
      }

      if (progress < 1) {
        setTimeout(fade, 16);
      } else {
        strengthRef.current = 0;
      }
    };

    fade();
  }, [enabled, fadeOutMs]);

  return { state, start, stop, enabled };
}
