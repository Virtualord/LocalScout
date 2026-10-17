import { useEffect, useRef } from 'react';
import { hash, mixHex, spotlightFalloff, type LayoutResult } from './layout.js';

/**
 * The land renderer.
 *
 * A `<canvas>` rather than 1792 divs: the land layer is static once drawn, and
 * the spotlight repaints on every pointer move. Doing that with DOM nodes would
 * mean mutating 1792 elements per frame, which is how a "60fps map" quietly
 * becomes 20fps.
 *
 * Device-pixel-ratio aware, because a pixel map on a 2x display with a
 * one-pixel-ratio canvas looks like a blurry photograph, which defeats the
 * point of the whole style.
 */

const LAND = '#5b7873';
const LAND_PEAK = '#b9cbc6';

export interface LandCanvasProps {
  layout: LayoutResult;
  /** Current pointer position in CSS pixels, or null when the pointer is away. */
  spotlight: { x: number; y: number } | null;
  /** 0 to 1. Used to fade the spotlight out on pointer leave. */
  spotlightStrength: number;
  width: number;
  height: number;
  className?: string;
}

/** Fraction of the map width within which cells brighten. */
const SPOTLIGHT_FRACTION = 0.08;

export function LandCanvas({
  layout,
  spotlight,
  spotlightStrength,
  width,
  height,
  className = '',
}: LandCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /*
   * The light, read as two numbers rather than as the object it arrived in.
   *
   * These values used to be copied into refs by their own effect, and the draw
   * effect below depended only on the layout and the size — so the refs were
   * updated on every pointer move and the canvas was never repainted. The light
   * moved and the map stayed dark.
   *
   * Numbers in the dependency list instead: `spotlight` is a fresh object every
   * frame, so depending on the object would redraw even when nothing had moved.
   */
  const spotlightX = spotlight?.x ?? null;
  const spotlightY = spotlight?.y ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.floor(width * dpr);
    const pixelHeight = Math.floor(height * dpr);

    /*
     * Assigning `width` or `height` to a canvas clears it and reallocates its
     * backing store. That was harmless while this effect ran once per layout
     * change; now that it runs on every pointer move, assigning unconditionally
     * would allocate a full-screen bitmap per frame and reset the transform set
     * beside it. The size only has to be set when it has actually changed.
     */
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const cellWidth = width / layout.cols;
    const cellHeight = height / layout.rows;
    // The reference draws cells at roughly 78% of the pitch, leaving a gap.
    const drawWidth = cellWidth * 0.78;
    const drawHeight = cellHeight * 0.78;
    const offsetX = (cellWidth - drawWidth) / 2;
    const offsetY = (cellHeight - drawHeight) / 2;

    const radius = width * SPOTLIGHT_FRACTION;
    const strength = spotlightStrength;
    const light =
      spotlightX === null || spotlightY === null ? null : { x: spotlightX, y: spotlightY };

    context.clearRect(0, 0, width, height);

    for (let row = 0; row < layout.rows; row += 1) {
      for (let col = 0; col < layout.cols; col += 1) {
        if (!layout.land[row * layout.cols + col]) continue;

        const x = col * cellWidth + offsetX;
        const y = row * cellHeight + offsetY;

        // Seeded per-cell lightness jitter. This is what makes the land read as
        // terrain rather than as a flat fill.
        const jitter = hash(col, row, 11);
        let colour = mixHex(
          LAND,
          jitter > 0.5 ? '#ffffff' : '#000000',
          Math.abs(jitter - 0.5) * 0.12,
        );

        if (light && strength > 0) {
          const cellCentreX = col * cellWidth + cellWidth / 2;
          const cellCentreY = row * cellHeight + cellHeight / 2;
          const distance = Math.hypot(cellCentreX - light.x, cellCentreY - light.y);

          if (distance < radius) {
            // The same smoothstep the unit tests pin, rather than a second copy
            // of the arithmetic that could drift away from it.
            colour = mixHex(colour, LAND_PEAK, spotlightFalloff(distance, radius) * strength);
          }
        }

        context.fillStyle = colour;
        context.fillRect(x, y, drawWidth, drawHeight);
      }
    }
  }, [layout, width, height, spotlightX, spotlightY, spotlightStrength]);

  return (
    <canvas
      ref={canvasRef}
      // The canvas is decorative: the lead buttons carry the accessible names,
      // so this is hidden rather than exposed as an empty region.
      aria-hidden="true"
      style={{ width, height, display: 'block' }}
      className={className}
    />
  );
}
