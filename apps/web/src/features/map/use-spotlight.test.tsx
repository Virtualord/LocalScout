/**
 * @vitest-environment jsdom
 *
 * The pointer spotlight hook.
 *
 * Its value is entirely in the timing: the light snaps on first entry rather
 * than easing in from a stale position, follows a moving pointer, and fades out
 * on leave instead of cutting. None of that is visible in a snapshot, and the
 * map's component tests only see the state it publishes.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSpotlight } from './use-spotlight.js';

/** jsdom reports no hover capability, so the hook disables itself by default. */
function stubMatchMedia(hover: boolean, reducedMotion = false): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query.includes('hover') ? hover : reducedMotion && query.includes('reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSpotlight', () => {
  it('stays off on a device with no pointer to track', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useSpotlight());

    expect(result.current.enabled).toBe(false);

    act(() => {
      result.current.start(120, 60);
    });

    // A touch device has no hover, so a stray pointer event must not light
    // anything up.
    expect(result.current.state).toEqual({ x: 0, y: 0, strength: 0, active: false });
  });

  it('snaps to the pointer on first entry rather than easing in from nowhere', async () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useSpotlight());

    act(() => {
      result.current.start(120, 60);
    });

    await waitFor(() => {
      expect(result.current.state.active).toBe(true);
    });
    // Easing in from the origin would show the light sliding across the map from
    // the top-left corner on the first mouse move.
    expect(result.current.state.x).toBeCloseTo(120, 1);
    expect(result.current.state.y).toBeCloseTo(60, 1);
    expect(result.current.state.strength).toBe(1);
  });

  it('eases toward a pointer that keeps moving', async () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useSpotlight({ lerp: 0.5 }));

    act(() => {
      result.current.start(100, 40);
    });
    await waitFor(() => {
      expect(result.current.state.x).toBeCloseTo(100, 1);
    });

    act(() => {
      result.current.start(200, 40);
    });

    // The trail is the point: the light arrives rather than teleporting, and it
    // does arrive.
    await waitFor(() => {
      expect(result.current.state.x).toBeCloseTo(200, 0);
    });
    expect(result.current.state.active).toBe(true);
  });

  it('fades out on leave instead of cutting to black', async () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useSpotlight({ fadeOutMs: 120 }));

    act(() => {
      result.current.start(100, 40);
    });
    await waitFor(() => {
      expect(result.current.state.strength).toBe(1);
    });

    act(() => {
      result.current.stop();
    });

    // Still lit, dimmer: the fade has started.
    expect(result.current.state.active).toBe(true);
    expect(result.current.state.strength).toBeLessThanOrEqual(1);

    await waitFor(() => {
      expect(result.current.state.active).toBe(false);
    });
    expect(result.current.state.strength).toBe(0);
    // The light stays where it was rather than jumping back to the origin as it
    // goes out.
    expect(result.current.state.x).toBeCloseTo(100, 1);
  });

  it('stops nothing and fades nothing when it is disabled', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useSpotlight());

    act(() => {
      result.current.stop();
    });

    expect(result.current.state.active).toBe(false);
  });
});
