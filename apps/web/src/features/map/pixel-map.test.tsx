/**
 * @vitest-environment jsdom
 *
 * Pixel map component tests.
 *
 * The map's value depends on things a screenshot cannot check: that the squares
 * are real focusable buttons with useful names, that arrow keys move to the
 * nearest neighbour, and that reduced motion turns the effects off.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PixelMap } from './pixel-map.js';
import { nearestNeighbour, type MapLead, type PlacedLead } from './layout.js';

/**
 * One shared 2D context for the whole file.
 *
 * A fresh object per `getContext` call would make "the canvas was repainted" and
 * "the effect read a different object" indistinguishable, and the spotlight
 * tests exist to count repaints.
 */
const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
};

/** jsdom has no canvas; a no-op context keeps the renderer from throwing. */
function stubCanvas(): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => context as unknown as CanvasRenderingContext2D,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

/**
 * jsdom reports no hover capability, so the spotlight disables itself.
 *
 * This is the media query the hook consults to decide whether there is a pointer
 * to track at all; without it the light is never turned on and the repaint tests
 * would pass for the wrong reason.
 */
function enableHover(): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query.includes('hover'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
}

const leads: MapLead[] = [
  { id: 'a', name: 'Sharma Plumbing', lat: 23.24, lng: 77.41, score: 82, auditStatus: 'ok' },
  { id: 'b', name: 'Verma Electricals', lat: 23.26, lng: 77.42, score: 55, auditStatus: 'ok' },
  { id: 'c', name: 'Gupta Interiors', lat: 23.28, lng: 77.44, score: null },
];

describe('PixelMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubCanvas();
  });

  it('renders one button per lead', () => {
    render(<PixelMap leads={leads} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('gives every square an accessible name with the name and score', () => {
    render(<PixelMap leads={leads} />);

    expect(
      screen.getByRole('button', { name: 'Sharma Plumbing, opportunity 82' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Verma Electricals, opportunity 55' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Gupta Interiors, not audited' }),
    ).toBeInTheDocument();
  });

  it('is keyboard reachable', async () => {
    render(<PixelMap leads={leads} />);
    await userEvent.tab();
    expect(screen.getAllByRole('button')[0]).toHaveFocus();
  });

  it('calls onSelect when a square is clicked', async () => {
    const onSelect = vi.fn();
    render(<PixelMap leads={leads} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole('button', { name: /Sharma Plumbing/ }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('opens a lead on Enter', async () => {
    const onSelect = vi.fn();
    render(<PixelMap leads={leads} onSelect={onSelect} />);

    screen.getByRole('button', { name: /Sharma Plumbing/ }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('moves focus to a neighbour with the arrow keys', () => {
    // fireEvent rather than userEvent: the handler is a keydown listener and
    // userEvent's keyboard model does not follow a programmatic .focus() call.
    render(<PixelMap leads={leads} />);
    const buttons = screen.getAllByRole('button');
    buttons[0]?.focus();

    fireEvent.keyDown(buttons[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).not.toBe(buttons[0]);
  });

  it('does nothing on an arrow key when there is no neighbour', () => {
    render(
      <PixelMap
        leads={[{ id: 'solo', name: 'Solo', lat: 23.25, lng: 77.41, score: 50, auditStatus: 'ok' }]}
      />,
    );
    const button = screen.getByRole('button');
    button.focus();

    fireEvent.keyDown(button, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(button);
  });

  it('keeps focus inside the map when navigating', () => {
    render(<PixelMap leads={leads} />);
    const buttons = screen.getAllByRole('button');
    buttons[0]?.focus();

    fireEvent.keyDown(buttons[0]!, { key: 'ArrowRight' });
    // Scoped lookup: a second map on the page must not steal the focus.
    expect(screen.getAllByRole('button').some((button) => button === document.activeElement)).toBe(
      true,
    );
  });

  it('renders nothing interactive for an empty lead list', () => {
    render(<PixelMap leads={[]} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('does not crash with a null coordinate', () => {
    expect(() =>
      render(
        <PixelMap
          leads={[
            { id: 'x', name: 'No Coords', lat: null, lng: null, score: 50, auditStatus: 'ok' },
          ]}
        />,
      ),
    ).not.toThrow();
  });

  it('marks an unavailable audit with a dashed outline', () => {
    render(
      <PixelMap
        leads={[
          {
            id: 'x',
            name: 'Unreachable',
            lat: 23.25,
            lng: 77.41,
            score: null,
            auditStatus: 'unavailable',
          },
        ]}
      />,
    );
    expect(screen.getByRole('button').className).toContain('border-dashed');
  });

  it('applies the drop-in animation only to a newly discovered lead', () => {
    const { rerender } = render(<PixelMap leads={leads} recentlyDiscoveredIds={new Set(['a'])} />);

    const squares = screen.getAllByRole('button');
    expect(squares[0]?.getAttribute('style')).toContain('animation-name: lead-drop-in');

    rerender(<PixelMap leads={leads} recentlyDiscoveredIds={new Set()} />);
    for (const square of screen.getAllByRole('button')) {
      expect(square.getAttribute('style') ?? '').not.toContain('animation-name: lead-drop-in');
    }
  });

  it('applies the recolour flash only to a freshly audited lead', () => {
    render(<PixelMap leads={leads} recentlyAuditedIds={new Set(['b'])} />);
    const squares = screen.getAllByRole('button');
    expect(squares[1]?.getAttribute('style')).toContain('animation-name: audit-recolor');
  });

  it('marks the canvas as decorative, since the buttons carry the names', () => {
    const { container } = render(<PixelMap leads={leads} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
  });

  /*
   * The projection box.
   *
   * Recomputing it whenever the lead list changed moved every square already on
   * the map, which is what a live search looks like: squares sliding around as
   * new businesses arrive. The box is pinned to the first batch instead.
   */
  describe('the projection box', () => {
    const near: MapLead[] = [
      { id: 'a', name: 'Alpha', lat: 23.24, lng: 77.41, score: 70, auditStatus: 'ok' },
      { id: 'b', name: 'Bravo', lat: 23.26, lng: 77.43, score: 60, auditStatus: 'ok' },
    ];
    // Far outside the first batch's box, so any recomputation would widen it.
    const far: MapLead = {
      id: 'c',
      name: 'Charlie',
      lat: 28.61,
      lng: 77.21,
      score: 50,
      auditStatus: 'ok',
    };

    const cornerOf = (name: string): string => {
      const square = screen.getByRole('button', { name });
      return `${square.style.left}|${square.style.top}|${square.style.width}`;
    };

    it('pins the box to the first batch, so squares already placed do not move', () => {
      // Mounted empty first, which is the order the screen uses: the map exists
      // before the first search has answered.
      const { rerender } = render(<PixelMap leads={[]} />);
      rerender(<PixelMap leads={near} />);

      const before = {
        alpha: cornerOf('Alpha, opportunity 70'),
        bravo: cornerOf('Bravo, opportunity 60'),
      };

      rerender(<PixelMap leads={[...near, far]} />);

      expect(cornerOf('Alpha, opportunity 70')).toBe(before.alpha);
      expect(cornerOf('Bravo, opportunity 60')).toBe(before.bravo);
      // The new lead is placed rather than dropped: outside the pinned box is a
      // position near the edge, not a missing square.
      expect(screen.getByRole('button', { name: 'Charlie, opportunity 50' })).toBeInTheDocument();
    });
  });

  /*
   * The spotlight.
   *
   * The light is driven by pointer state that changes every frame, and the draw
   * used to depend only on the layout and the size, so the canvas was painted
   * once and never again: the spotlight existed in state and nowhere on screen.
   */
  describe('the spotlight', () => {
    const pointerMove = (container: HTMLElement, x: number, y: number): void => {
      const map = container.firstElementChild;
      if (!map) throw new Error('expected the map container');
      fireEvent.pointerMove(map, { clientX: x, clientY: y });
    };

    it('repaints the land when the pointer moves across it', async () => {
      enableHover();
      const { container } = render(<PixelMap leads={leads} />);
      const before = context.clearRect.mock.calls.length;

      pointerMove(container, 120, 60);

      await waitFor(() => {
        expect(context.clearRect.mock.calls.length).toBeGreaterThan(before);
      });
    });

    it('does not reallocate the canvas backing store to do it', async () => {
      enableHover();
      const { container } = render(<PixelMap leads={leads} />);
      const canvas = container.querySelector('canvas');
      if (!canvas) throw new Error('expected a canvas');

      // Assigning `width` clears the canvas and allocates a new bitmap, which is
      // the whole reason the draw guards it. Counting writes proves the guard.
      let writes = 0;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
      Object.defineProperty(canvas, 'width', {
        configurable: true,
        get: () => (descriptor?.get?.call(canvas) as number | undefined) ?? 0,
        set: (value: number) => {
          writes += 1;
          descriptor?.set?.call(canvas, value);
        },
      });

      const before = context.clearRect.mock.calls.length;
      pointerMove(container, 120, 60);
      pointerMove(container, 240, 90);

      await waitFor(() => {
        expect(context.clearRect.mock.calls.length).toBeGreaterThan(before);
      });
      expect(writes).toBe(0);
    });

    it('leaves the canvas alone when the pointer is not over it', () => {
      const { container } = render(<PixelMap leads={leads} />);
      const before = context.clearRect.mock.calls.length;

      pointerMove(container, 120, 60);

      // No hover capability in jsdom by default, so the hook stays off and there
      // is nothing to repaint for.
      expect(context.clearRect.mock.calls.length).toBe(before);
    });
  });
});

describe('nearestNeighbour', () => {
  const square = (id: string, col: number, row: number): PlacedLead => ({
    id,
    name: id,
    score: 50,
    auditStatus: 'ok',
    col,
    row,
  });

  const grid = [
    square('centre', 5, 5),
    square('right', 8, 5),
    square('up', 5, 2),
    square('down', 5, 9),
    square('left', 1, 5),
  ];

  it('finds the lead to the right', () => {
    expect(nearestNeighbour(grid[0]!, grid, 'right')?.id).toBe('right');
  });

  it('finds the lead to the left', () => {
    expect(nearestNeighbour(grid[0]!, grid, 'left')?.id).toBe('left');
  });

  it('finds the lead above and below', () => {
    expect(nearestNeighbour(grid[0]!, grid, 'up')?.id).toBe('up');
    expect(nearestNeighbour(grid[0]!, grid, 'down')?.id).toBe('down');
  });

  it('returns undefined when nothing lies that way', () => {
    // Nothing is to the left of 'centre': 'left' is at col 1.
    expect(
      nearestNeighbour(grid[0]!, [grid[0]!, grid[1]!, grid[2]!, grid[3]!], 'left'),
    ).toBeUndefined();
    const corner = square('corner', 0, 0);
    expect(nearestNeighbour(corner, [corner], 'up')).toBeUndefined();
  });

  it('never returns the lead it started from', () => {
    const only = square('solo', 3, 3);
    expect(nearestNeighbour(only, [only], 'left')).toBeUndefined();
  });

  it('picks the closest when several lie that way', () => {
    const from = square('from', 10, 10);
    const near = square('near', 14, 10);
    const far = square('far', 30, 10);
    expect(nearestNeighbour(from, [from, near, far], 'right')?.id).toBe('near');
  });

  it('is stable regardless of the order leads are given', () => {
    const from = grid[0]!;
    const forward = nearestNeighbour(from, grid, 'right')?.id;
    const backward = nearestNeighbour(from, [...grid].reverse(), 'right')?.id;
    expect(backward).toBe(forward);
  });

  it('ignores a lead directly behind the direction', () => {
    const from = square('from', 5, 5);
    const behind = square('behind', 4, 5);
    expect(nearestNeighbour(from, [from, behind], 'right')).toBeUndefined();
  });
});
