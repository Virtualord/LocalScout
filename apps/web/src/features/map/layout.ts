/**
 * Pixel map layout.
 *
 * Pure geometry with no rendering and no React, because this is the part that is
 * easy to get subtly wrong and hard to see: a lead that collides with another,
 * or lands on water, or moves when an unrelated lead is added.
 *
 * The algorithm:
 *
 * 1. Build a land mask: an ellipse with seeded noise along the edge, so the
 *    coastline is irregular rather than a circle.
 * 2. Project each lead's lat/lng into the padded bounding box, then snap to the
 *    nearest cell.
 * 3. If that cell is water, or already taken, spiral outward to the nearest free
 *    land cell.
 * 4. Process leads in sorted `place_id` order, so the same input always produces
 *    the same layout regardless of the order leads arrived from the API.
 *
 * Determinism is the whole point: the live map adds squares as a run discovers
 * them, and a square must not jump because a differently-ordered sibling
 * appeared.
 */

export interface MapLead {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  /** 0-100, or null when the lead has not been audited. */
  score: number | null;
  auditStatus?: 'ok' | 'stale' | 'unavailable' | undefined;
}

export interface MapGrid {
  cols: number;
  rows: number;
  /** Row-major. True means land. */
  land: boolean[];
}

export interface PlacedLead {
  id: string;
  name: string;
  score: number | null;
  auditStatus: 'ok' | 'stale' | 'unavailable' | undefined;
  col: number;
  row: number;
}

export interface LayoutResult {
  cols: number;
  rows: number;
  land: boolean[];
  leads: PlacedLead[];
}

/** Desktop and mobile cell counts. 64x28 is the reference's density. */
export const DESKTOP_GRID = { cols: 64, rows: 28 } as const;
export const MOBILE_GRID = { cols: 32, rows: 20 } as const;

/** How much of each edge is kept clear, so leads never sit on the border. */
const PADDING = 0.12;

/**
 * A small deterministic hash.
 *
 * `Math.random` is not usable here: the land mask must be identical across
 * renders or the map shimmers, and tests need to assert on exact cells.
 */
export function hash(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/**
 * The land mask.
 *
 * An ellipse whose radius varies per angle, so the coast has bays and
 * peninsulas. Cells outside it are water.
 */
export function buildLandMask(cols: number, rows: number, seed: number): boolean[] {
  const land: boolean[] = new Array(cols * rows).fill(false);

  const centreX = (cols - 1) / 2;
  const centreY = (rows - 1) / 2;
  const baseRadiusX = (cols / 2) * (1 - PADDING);
  const baseRadiusY = (rows / 2) * (1 - PADDING);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const dx = (col - centreX) / baseRadiusX;
      const dy = (row - centreY) / baseRadiusY;
      const distance = Math.hypot(dx, dy);

      // Angular noise: a smooth-ish perturbation of the radius per direction,
      // plus a per-cell jitter so the edge is not a clean curve.
      const angle = Math.atan2(dy, dx);
      const radiusNoise = 0.78 + hash(Math.round(angle * 12), seed, 7) * 0.22;
      const edgeNoise = (hash(col, row, seed) - 0.5) * 0.06;

      land[row * cols + col] = distance <= radiusNoise + edgeNoise;
    }
  }

  return land;
}

/** A latitude/longitude bounding box. */
export interface MapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** The bounding box of the leads, padded, with a fallback for too few points. */
function boundsFor(leads: MapLead[]): MapBounds {
  const located = leads.filter((lead) => lead.lat !== null && lead.lng !== null);

  if (located.length < 3) {
    // Fewer than three points has no meaningful spread, so anchor on whatever
    // exists and fall back to a small box around it.
    const lat = located[0]?.lat ?? 23.2599;
    const lng = located[0]?.lng ?? 77.4126;
    return { minLat: lat - 0.05, maxLat: lat + 0.05, minLng: lng - 0.05, maxLng: lng + 0.05 };
  }

  const lats = located.map((lead) => lead.lat as number);
  const lngs = located.map((lead) => lead.lng as number);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // A single column or row of leads would divide by zero; give it a floor.
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lngSpan = Math.max(maxLng - minLng, 0.01);

  return {
    minLat: minLat - latSpan * PADDING,
    maxLat: maxLat + latSpan * PADDING,
    minLng: minLng - lngSpan * PADDING,
    maxLng: maxLng + lngSpan * PADDING,
  };
}

/**
 * Spiral outward from a cell until a free land cell is found.
 *
 * The search order is fixed (ring by ring, then by angle) so two runs produce
 * the same placement, rather than whichever direction the loop happened to
 * check first.
 */
function nearestFreeCell(
  land: boolean[],
  cols: number,
  rows: number,
  startCol: number,
  startRow: number,
  taken: Set<number>,
): { col: number; row: number } | undefined {
  const isFree = (col: number, row: number): boolean => {
    if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
    const index = row * cols + col;
    return land[index] === true && !taken.has(index);
  };

  if (isFree(startCol, startRow)) return { col: startCol, row: startRow };

  const maxRing = Math.max(cols, rows);
  for (let ring = 1; ring <= maxRing; ring += 1) {
    // Walk the ring in a fixed order: top edge left-to-right, right edge
    // downward, bottom edge right-to-left, left edge upward.
    const candidates: { col: number; row: number }[] = [];

    for (let col = startCol - ring; col <= startCol + ring; col += 1) {
      candidates.push({ col, row: startRow - ring });
      candidates.push({ col, row: startRow + ring });
    }
    for (let row = startRow - ring + 1; row <= startRow + ring - 1; row += 1) {
      candidates.push({ col: startCol + ring, row });
      candidates.push({ col: startCol - ring, row });
    }

    for (const candidate of candidates) {
      if (isFree(candidate.col, candidate.row)) return candidate;
    }
  }

  return undefined;
}

/**
 * The bounding box for a set of leads.
 *
 * Exposed so a live map can compute the box **once** and reuse it. Recomputing
 * per batch would move every existing square, because a late lead outside the
 * original spread would widen the box and shift the projection. That is the
 * whole reason this is separate from `layoutLeads`.
 */
export function computeBounds(leads: MapLead[]): MapBounds {
  return boundsFor(leads);
}

/**
 * Place every lead on the grid.
 *
 * Exported for the renderer and fully covered by tests; the invariants that
 * matter are that no two leads share a cell, every lead lands on land, and the
 * result is identical for identical input.
 *
 * Pass `bounds` to pin the projection box. Omitting it derives one from the
 * leads, which is correct for a static list and wrong for a live one.
 */
export function layoutLeads(
  leads: MapLead[],
  options: { cols: number; rows: number; seed: number; bounds?: MapBounds },
): LayoutResult {
  const { cols, rows, seed } = options;
  const land = buildLandMask(cols, rows, seed);
  const taken = new Set<number>();

  // Sorted by id so arrival order cannot change the layout.
  const ordered = [...leads].sort((a, b) => a.id.localeCompare(b.id));
  const bounds = options.bounds ?? boundsFor(ordered);

  const placed: PlacedLead[] = [];

  for (const lead of ordered) {
    let col: number;
    let row: number;

    if (lead.lat === null || lead.lng === null) {
      // No coordinates: centre of the map, which is where the "unknown" cluster
      // belongs rather than being scattered at a fake position.
      col = Math.floor(cols / 2);
      row = Math.floor(rows / 2);
    } else {
      const lngRatio = (lead.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng);
      const latRatio = (lead.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat);
      // Latitude grows northward; row 0 is the top of the map.
      col = Math.round(lngRatio * (cols - 1));
      row = Math.round((1 - latRatio) * (rows - 1));
    }

    const cell = nearestFreeCell(land, cols, rows, col, row, taken);

    // A full grid has no free cell; skip rather than overlapping an existing
    // lead, which would be worse than leaving one out.
    if (!cell) continue;

    taken.add(cell.row * cols + cell.col);
    placed.push({
      id: lead.id,
      name: lead.name,
      score: lead.score,
      auditStatus: lead.auditStatus,
      col: cell.col,
      row: cell.row,
    });
  }

  return { cols, rows, land, leads: placed };
}

/**
 * The spotlight falloff.
 *
 * Returns 0 at and beyond `radius`, 1 at the centre, and a smoothstep in
 * between. Exported separately so the easing can be tested as the pure function
 * it is, rather than by measuring pixels.
 */
export function spotlightFalloff(distance: number, radius: number): number {
  if (radius <= 0) return 0;
  if (distance >= radius) return 0;

  const t = 1 - distance / radius;
  // Smoothstep: 3t^2 - 2t^3. Smoother than linear at both ends, which matters
  // because the spotlight is the thing the eye tracks.
  return t * t * (3 - 2 * t);
}

/** Mix two hex colours. Used for the land-to-peak blend. */
export function mixHex(from: string, to: string, amount: number): string {
  const clamp = Math.max(0, Math.min(1, amount));
  const parse = (hex: string): [number, number, number] => {
    const clean = hex.replace('#', '');
    return [
      Number.parseInt(clean.slice(0, 2), 16),
      Number.parseInt(clean.slice(2, 4), 16),
      Number.parseInt(clean.slice(4, 6), 16),
    ];
  };

  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);

  const mix = (a: number, b: number): number => Math.round(a + (b - a) * clamp);

  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The colour for a lead square.
 *
 * By score, with the unaudited and audit-unavailable states kept visually
 * distinct from a genuine low score.
 */
export function leadCellColor(lead: PlacedLead): string {
  if (lead.auditStatus === 'unavailable') return 'var(--color-land-dim)';
  if (lead.score === null) return 'var(--color-land)';
  if (lead.score >= 70) return 'var(--color-amber)';
  if (lead.score >= 40) return 'var(--color-coral)';
  return 'var(--color-pink)';
}

/** The accessible label for a lead square. */
export function leadCellLabel(lead: PlacedLead): string {
  if (lead.score === null) {
    // Same distinction as the tier chip: an unreachable site is not an
    // unaudited one, and a screen reader user deserves the same information a
    // sighted user gets from the dashed outline.
    return lead.auditStatus === 'unavailable'
      ? `${lead.name}, site could not be reached`
      : `${lead.name}, not audited`;
  }
  return `${lead.name}, opportunity ${lead.score}`;
}

/**
 * The nearest lead in a direction.
 *
 * Arrow-key navigation moves to the nearest lead in the pressed direction, not
 * to the next one in DOM order: a keyboard user looking at a grid of squares
 * expects the square to the right, not the next square in the list.
 *
 * Pure and exported so the rule can be tested without a DOM, which is where a
 * focus bug is hardest to diagnose.
 */
export function nearestNeighbour(
  from: { id: string; col: number; row: number },
  leads: PlacedLead[],
  direction: 'up' | 'down' | 'left' | 'right',
): PlacedLead | undefined {
  const delta: Record<'up' | 'down' | 'left' | 'right', [number, number]> = {
    right: [1, 0],
    left: [-1, 0],
    down: [0, 1],
    up: [0, -1],
  };

  const [dc, dr] = delta[direction];

  let best: { lead: PlacedLead; distance: number } | undefined;

  for (const candidate of leads) {
    if (candidate.id === from.id) continue;

    const dCol = candidate.col - from.col;
    const dRow = candidate.row - from.row;

    // Only leads lying in the pressed direction count. A lead diagonally
    // down-right is reachable with two presses, which is how every grid
    // navigator behaves.
    if (dc !== 0 && Math.sign(dCol) !== dc) continue;
    if (dr !== 0 && Math.sign(dRow) !== dr) continue;

    const distance = Math.hypot(dCol, dRow);
    if (!best || distance < best.distance) best = { lead: candidate, distance };
  }

  return best?.lead;
}
