import { useEffect, useRef } from 'react';
import { hash, mixHex, type LayoutResult } from './layout.js';

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
const LAND_DIM = '#45655e';
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
  /** Latest spotlight values, read inside the draw effect. */
  const latest = useRef(spotlight);
  const latestStrength = useRef(spotlightStrength);

  // Synced in an effect rather than assigned during render: the spotlight moves
  // every frame, and writing a ref during render is what the React Compiler
  // rules exist to prevent.
  useEffect(() => {
    latest.current = spotlight;
    latestStrength.current = spotlightStrength;
  }, [spotlight, spotlightStrength]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cellWidth = width / layout.cols;
    const cellHeight = height / layout.rows;
    // The reference draws cells at roughly 78% of the pitch, leaving a gap.
    const drawWidth = cellWidth * 0.78;
    const drawHeight = cellHeight * 0.78;
    const offsetX = (cellWidth - drawWidth) / 2;
    const offsetY = (cellHeight - drawHeight) / 2;

    const radius = width * SPOTLIGHT_FRACTION;
    const activeSpotlight = latest.current;
    const strength = latestStrength.current;

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

        if (activeSpotlight && strength > 0) {
          const cellCentreX = col * cellWidth + cellWidth / 2;
          const cellCentreY = row * cellHeight + cellHeight / 2;
          const distance = Math.hypot(
            cellCentreX - activeSpotlight.x,
            cellCentreY - activeSpotlight.y,
          );

          if (distance < radius) {
            // Smoothstep, matching the pure function the tests pin.
            const t = 1 - distance / radius;
            const falloff = t * t * (3 - 2 * t) * strength;
            colour = mixHex(colour, LAND_PEAK, falloff);
          }
        }

        context.fillStyle = colour;
        context.fillRect(x, y, drawWidth, drawHeight);
      }
    }
  }, [layout, width, height]);

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

export { LAND, LAND_DIM, LAND_PEAK };
