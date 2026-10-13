/**
 * @vitest-environment jsdom
 *
 * Layout and spotlight tests.
 *
 * These pin the invariants the renderer relies on: no overlapping squares, every
 * square on land, and identical output for identical input. A layout that drifts
 * would make the live map jump squares as a run discovers leads, which is worse
 * than the effect being absent.
 */
import { describe, expect, it } from 'vitest';
import {
  buildLandMask,
  computeBounds,
  DESKTOP_GRID,
  hash,
  layoutLeads,
  leadCellColor,
  leadCellLabel,
  mixHex,
  MOBILE_GRID,
  spotlightFalloff,
  type MapLead,
} from './layout.js';

const lead = (
  id: string,
  lat: number | null,
  lng: number | null,
  score: number | null = 70,
): MapLead => ({
  id,
  name: `Business ${id}`,
  lat,
  lng,
  score,
  auditStatus: score === null ? undefined : 'ok',
});

/** A spread of real-ish coordinates around Bhopal. */
const cluster: MapLead[] = Array.from({ length: 24 }, (_, index) =>
  lead(
    `lead_${index}`,
    23.22 + (index % 6) * 0.008,
    77.4 + Math.floor(index / 6) * 0.009,
    40 + index,
  ),
);

describe('buildLandMask', () => {
  it('produces one boolean per cell', () => {
    const land = buildLandMask(16, 8, 1);
    expect(land).toHaveLength(16 * 8);
  });

  it('leaves the corners as water', () => {
    const land = buildLandMask(20, 10, 1);
    expect(land[0]).toBe(false);
    expect(land[19]).toBe(false);
  });

  it('fills the centre with land', () => {
    const land = buildLandMask(20, 10, 1);
    const centre = 5 * 20 + 10;
    expect(land[centre]).toBe(true);
  });

  it('is deterministic for a seed', () => {
    expect(buildLandMask(20, 10, 7)).toEqual(buildLandMask(20, 10, 7));
  });

  it('differs between seeds, so the coastline is not a fixed shape', () => {
    expect(buildLandMask(20, 10, 1)).not.toEqual(buildLandMask(20, 10, 2));
  });

  it('is about half land, not a thin ring or a solid block', () => {
    const land = buildLandMask(40, 20, 3);
    const ratio = land.filter(Boolean).length / land.length;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.75);
  });
});

describe('hash', () => {
  it('is deterministic', () => {
    expect(hash(3, 7, 1)).toBe(hash(3, 7, 1));
  });

  it('stays within 0 to 1', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = hash(i, i * 2, i % 5);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('varies with the seed', () => {
    expect(hash(1, 1, 1)).not.toBe(hash(1, 1, 2));
  });
});

describe('layoutLeads', () => {
  const grid = { cols: 64, rows: 28, seed: 1 };

  it('places every lead', () => {
    const result = layoutLeads(cluster, grid);
    expect(result.leads).toHaveLength(cluster.length);
  });

  it('never puts two leads in the same cell', () => {
    const result = layoutLeads(cluster, grid);
    const cells = result.leads.map((entry) => `${entry.col},${entry.row}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('puts every lead on land', () => {
    const result = layoutLeads(cluster, grid);
    for (const entry of result.leads) {
      expect(result.land[entry.row * result.cols + entry.col], entry.name).toBe(true);
    }
  });

  it('keeps every lead inside the grid', () => {
    const result = layoutLeads(cluster, grid);
    for (const entry of result.leads) {
      expect(entry.col).toBeGreaterThanOrEqual(0);
      expect(entry.col).toBeLessThan(grid.cols);
      expect(entry.row).toBeGreaterThanOrEqual(0);
      expect(entry.row).toBeLessThan(grid.rows);
    }
  });

  it('is deterministic for the same input', () => {
    expect(layoutLeads(cluster, grid)).toEqual(layoutLeads(cluster, grid));
  });

  it('does not move existing leads when a new one arrives, given a pinned box', () => {
    // The live-map invariant. A run discovers leads one at a time, so the map
    // pins the bounds on the first batch; without that, a late lead outside the
    // original spread would widen the box and shift every existing square.
    const bounds = computeBounds(cluster);

    const first = layoutLeads(cluster, { ...grid, bounds });
    const withExtra = layoutLeads([...cluster, lead('lead_zzz', 23.3, 77.5, 90)], {
      ...grid,
      bounds,
    });

    const positions = new Map(
      withExtra.leads.map((entry) => [entry.id, `${entry.col},${entry.row}`]),
    );
    for (const entry of first.leads) {
      expect(positions.get(entry.id), entry.id).toBe(`${entry.col},${entry.row}`);
    }
  });

  it('documents why an unpinned box does shift leads', () => {
    // Without pinned bounds the projection box grows with the data, which is
    // correct for a static list and visibly wrong for a live one. This test
    // pins the behaviour so the distinction is deliberate rather than a latent
    // surprise.
    const before = layoutLeads(cluster, grid);
    const after = layoutLeads([...cluster, lead('lead_zzz', 23.3, 77.5, 90)], grid);

    const positions = new Map(after.leads.map((entry) => [entry.id, `${entry.col},${entry.row}`]));
    const moved = before.leads.filter(
      (entry) => positions.get(entry.id) !== `${entry.col},${entry.row}`,
    );
    expect(moved.length).toBeGreaterThan(0);
  });

  it('is independent of input order', () => {
    const forwards = layoutLeads(cluster, grid);
    const backwards = layoutLeads([...cluster].reverse(), grid);
    expect(backwards.leads).toEqual(forwards.leads);
  });

  it('keeps the score and name on the placed lead', () => {
    const result = layoutLeads([lead('x', 23.25, 77.41, 82)], grid);
    expect(result.leads[0]).toMatchObject({ id: 'x', name: 'Business x', score: 82 });
  });

  describe('edge cases', () => {
    it('handles an empty list', () => {
      const result = layoutLeads([], grid);
      expect(result.leads).toEqual([]);
      expect(result.land).toHaveLength(grid.cols * grid.rows);
    });

    it('places a single lead', () => {
      const result = layoutLeads([lead('solo', 23.25, 77.41, 50)], grid);
      expect(result.leads).toHaveLength(1);
    });

    it('places two leads without colliding', () => {
      const result = layoutLeads([lead('a', 23.25, 77.41), lead('b', 23.26, 77.42)], grid);
      expect(result.leads).toHaveLength(2);
      expect(
        result.leads[0]?.col === result.leads[1]?.col &&
          result.leads[0]?.row === result.leads[1]?.row,
      ).toBe(false);
    });

    it('falls back to a fixed box for fewer than three located leads', () => {
      const result = layoutLeads([lead('a', 23.25, 77.41)], grid);
      expect(result.leads).toHaveLength(1);
      expect(result.leads[0]?.row).toBeGreaterThanOrEqual(0);
    });

    it('places a lead with no coordinates at the centre rather than skipping it', () => {
      const result = layoutLeads([lead('noCoords', null, null)], grid);
      expect(result.leads).toHaveLength(1);
      expect(result.leads[0]?.col).toBe(Math.floor(grid.cols / 2));
    });

    it('survives a grid with far more leads than land cells', () => {
      const dense = Array.from({ length: 40 }, (_, index) =>
        lead(`d_${index}`, 23.24 + (index % 5) * 0.001, 77.41 + (index % 7) * 0.001),
      );
      const result = layoutLeads(dense, { cols: 12, rows: 10, seed: 2 });

      // Some may be dropped rather than overlapped; never two in one cell.
      const cells = result.leads.map((entry) => `${entry.col},${entry.row}`);
      expect(new Set(cells).size).toBe(cells.length);
    });

    it('handles a 1x1 grid', () => {
      const result = layoutLeads([lead('a', 23, 77)], { cols: 1, rows: 1, seed: 1 });
      expect(result.leads.length).toBeLessThanOrEqual(1);
    });

    it('handles leads at identical coordinates', () => {
      const same = Array.from({ length: 6 }, (_, index) => lead(`s_${index}`, 23.25, 77.41));
      const result = layoutLeads(same, grid);

      expect(result.leads).toHaveLength(6);
      const cells = result.leads.map((entry) => `${entry.col},${entry.row}`);
      expect(new Set(cells).size).toBe(6);
    });
  });

  it('works at the mobile grid size', () => {
    const result = layoutLeads(cluster, { ...MOBILE_GRID, seed: 1 });
    expect(result.leads).toHaveLength(cluster.length);
    const cells = result.leads.map((entry) => `${entry.col},${entry.row}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('uses the documented default grids', () => {
    expect(DESKTOP_GRID.cols).toBe(64);
    expect(DESKTOP_GRID.rows).toBe(28);
    expect(MOBILE_GRID.cols).toBe(32);
    expect(MOBILE_GRID.rows).toBe(20);
  });
});

describe('spotlightFalloff', () => {
  const radius = 150;

  it('peaks at the centre', () => {
    expect(spotlightFalloff(0, radius)).toBe(1);
  });

  it('is zero at and beyond the radius', () => {
    expect(spotlightFalloff(radius, radius)).toBe(0);
    expect(spotlightFalloff(radius * 2, radius)).toBe(0);
  });

  it('decreases monotonically outward', () => {
    const samples = [0, 25, 50, 75, 100, 125, 149].map((distance) =>
      spotlightFalloff(distance, radius),
    );
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeLessThan(samples[i - 1] ?? 1);
    }
  });

  it('stays between zero and one everywhere', () => {
    for (let distance = 0; distance <= radius * 2; distance += 7) {
      const value = spotlightFalloff(distance, radius);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('returns zero for a zero radius rather than dividing by zero', () => {
    expect(spotlightFalloff(10, 0)).toBe(0);
  });

  it('is smooth at the centre, so the spotlight does not have a hard core', () => {
    // Smoothstep has zero derivative at both ends; check the near-centre steps
    // shrink rather than jumping.
    const a = spotlightFalloff(1, radius);
    const b = spotlightFalloff(2, radius);
    expect(b - a).toBeLessThan(0.01);
  });
});

describe('mixHex', () => {
  it('returns the first colour at zero', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
  });

  it('returns the second colour at one', () => {
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('interpolates in the middle', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('clamps out-of-range amounts', () => {
    expect(mixHex('#000000', '#ffffff', 5)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', -5)).toBe('#000000');
  });
});

describe('leadCellColor', () => {
  const placed = (score: number | null, auditStatus?: 'ok' | 'unavailable') => ({
    id: 'x',
    name: 'X',
    score,
    auditStatus,
    col: 0,
    row: 0,
  });

  it('uses amber for a hot lead', () => {
    expect(leadCellColor(placed(85))).toBe('var(--color-amber)');
  });

  it('uses coral in the middle band', () => {
    expect(leadCellColor(placed(55))).toBe('var(--color-coral)');
  });

  it('uses pink for a cold lead', () => {
    expect(leadCellColor(placed(20))).toBe('var(--color-pink)');
  });

  it('uses the land colour for an unaudited lead', () => {
    expect(leadCellColor(placed(null))).toBe('var(--color-land)');
  });

  it('uses the dim colour when the audit was unavailable', () => {
    // Distinct from a cold score: "could not check" is not "checked and bad".
    expect(leadCellColor(placed(null, 'unavailable'))).toBe('var(--color-land-dim)');
  });
});

describe('leadCellLabel', () => {
  it('includes the name and score', () => {
    expect(
      leadCellLabel({
        id: 'x',
        name: 'Sharma Plumbing',
        score: 82,
        auditStatus: 'ok',
        col: 0,
        row: 0,
      }),
    ).toBe('Sharma Plumbing, opportunity 82');
  });

  it('says so when the lead is unaudited', () => {
    expect(
      leadCellLabel({
        id: 'x',
        name: 'Sharma Plumbing',
        score: null,
        auditStatus: undefined,
        col: 0,
        row: 0,
      }),
    ).toBe('Sharma Plumbing, not audited');
  });
});
