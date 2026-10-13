import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LandCanvas } from './land-canvas.js';
import {
  computeBounds,
  DESKTOP_GRID,
  layoutLeads,
  leadCellColor,
  leadCellLabel,
  MOBILE_GRID,
  nearestNeighbour,
  type MapBounds,
  type MapLead,
} from './layout.js';
import { useSpotlight } from './use-spotlight.js';

/** Arrow keys mapped to the navigation directions. */
const ARROW_DIRECTIONS: Record<string, 'up' | 'down' | 'left' | 'right' | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * The pixel map.
 *
 * A canvas for the land layer and absolutely-positioned `<button>`s for the
 * leads. That split is the whole design: the canvas gives 60fps spotlight and
 * seeded terrain, the buttons give real focus, real keyboard navigation and a
 * real accessible name. Rendering leads into the canvas would be faster and
 * would make the map unusable with a keyboard, which is not a trade worth
 * making.
 *
 * No per-cell React state: the land is drawn once, and only the lead squares
 * re-render when the data changes.
 */

export interface PixelMapProps {
  leads: MapLead[];
  /** Opens the lead modal. */
  onSelect?: (id: string) => void;
  /** Seconds a lead took to be audited, used to trigger the recolour flash. */
  recentlyAuditedIds?: ReadonlySet<string>;
  /** Seconds a lead was just discovered, used to trigger the drop-in. */
  recentlyDiscoveredIds?: ReadonlySet<string>;
  className?: string;
  seed?: number;
}

export function PixelMap({
  leads,
  onSelect,
  recentlyAuditedIds,
  recentlyDiscoveredIds,
  className = '',
  seed = 1,
}: PixelMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** Scoped focus lookup, so the arrow handler never reaches outside the map. */
  const leadListRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 320 });

  const isMobile = size.width < 640;
  // Memoized because it is an object: a new identity every render would
  // invalidate the layout memo below and redo the layout on every pointer move.
  const grid = useMemo(() => (isMobile ? MOBILE_GRID : DESKTOP_GRID), [isMobile]);

  /**
   * The projection box, pinned once.
   *
   * Recomputing per batch would shift every existing square as a live run
   * discovers leads, so it is captured on the first render that has leads and
   * reused after that. Held in state rather than a ref, because writing a ref
   * during render is what the compiler rules exist to prevent.
   */
  const [bounds] = useState<MapBounds | undefined>(() =>
    leads.length > 0 ? computeBounds(leads) : undefined,
  );

  const layout = useMemo(
    () =>
      layoutLeads(leads, {
        ...grid,
        seed,
        ...(bounds ? { bounds } : {}),
      }),
    [leads, grid, seed, bounds],
  );

  // Measure the container so the canvas matches its box at any width.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = () => {
      const width = element.clientWidth;
      if (width > 0) setSize({ width, height: Math.round(width * 0.5) });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { state: spotlight, start, stop } = useSpotlight();

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      start(event.clientX - rect.left, event.clientY - rect.top);
    },
    [start],
  );

  const cellWidth = size.width / grid.cols;
  const cellHeight = size.height / grid.rows;

  return (
    <div
      ref={containerRef}
      className={`relative select-none overflow-hidden ${className}`}
      style={{ width: '100%', height: size.height }}
      onPointerMove={handlePointerMove}
      onPointerLeave={stop}
    >
      <LandCanvas
        layout={layout}
        spotlight={spotlight.active ? { x: spotlight.x, y: spotlight.y } : null}
        spotlightStrength={spotlight.strength}
        width={size.width}
        height={size.height}
      />

      {/* Lead squares. Real buttons: focus, keyboard, and an accessible name. */}
      <div className="absolute inset-0" ref={leadListRef}>
        {layout.leads.map((lead) => (
          <LeadSquare
            key={lead.id}
            lead={lead}
            cellWidth={cellWidth}
            cellHeight={cellHeight}
            onSelect={onSelect}
            allLeads={layout.leads}
            dropIn={recentlyDiscoveredIds?.has(lead.id) ?? false}
            recolor={recentlyAuditedIds?.has(lead.id) ?? false}
            listRef={leadListRef}
          />
        ))}
      </div>
    </div>
  );
}

interface LeadSquareProps {
  lead: ReturnType<typeof layoutLeads>['leads'][number];
  cellWidth: number;
  cellHeight: number;
  onSelect: ((id: string) => void) | undefined;
  allLeads: ReturnType<typeof layoutLeads>['leads'];
  dropIn: boolean;
  recolor: boolean;
  /** Scope for the focus lookup, so navigation never leaves this map. */
  listRef: React.RefObject<HTMLDivElement | null>;
}

function LeadSquare({
  lead,
  cellWidth,
  cellHeight,
  onSelect,
  allLeads,
  dropIn,
  recolor,
  listRef,
}: LeadSquareProps) {
  /**
   * Arrow-key navigation.
   *
   * The rule lives in `nearestNeighbour`, which is pure and unit-tested; this
   * only wires the key press to it and moves focus.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const direction = ARROW_DIRECTIONS[event.key];
    if (!direction) return;

    event.preventDefault();

    const target = nearestNeighbour(lead, allLeads, direction);
    if (!target) return;

    const index = allLeads.findIndex((entry) => entry.id === target.id);
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-map-lead]');
    buttons?.item(index)?.focus();
  };

  return (
    <button
      type="button"
      data-map-lead={lead.id}
      aria-label={leadCellLabel(lead)}
      title={`${lead.name}${lead.score === null ? '' : ` — ${lead.score}`}`}
      onClick={() => onSelect?.(lead.id)}
      onKeyDown={handleKeyDown}
      className={[
        'absolute border border-ink transition-transform duration-[--dur-fast]',
        'focus-visible:z-10',
        // A dashed outline marks a site that could not be checked, which is a
        // different fact from "checked and scored badly".
        lead.auditStatus === 'unavailable' ? 'border-dashed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: lead.col * cellWidth + cellWidth * 0.11,
        top: lead.row * cellHeight + cellHeight * 0.11,
        width: cellWidth * 0.78,
        height: cellHeight * 0.78,
        backgroundColor: leadCellColor(lead),
        // Longhand properties rather than the `animation` shorthand: the
        // reduced-motion rule sets `animation: none`, and React warns when a
        // rerender changes a shorthand that a longhand elsewhere also touches.
        ...(dropIn
          ? {
              animationName: 'lead-drop-in',
              animationDuration: '220ms',
              animationTimingFunction: 'var(--ease-out)',
            }
          : {}),
        ...(recolor
          ? {
              animationName: 'audit-recolor',
              animationDuration: '240ms',
              animationTimingFunction: 'steps(2)',
            }
          : {}),
      }}
      onMouseEnter={(event) => {
        // 2px paper outline on hover, from the motion table.
        event.currentTarget.style.boxShadow = '0 0 0 2px var(--color-paper)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.boxShadow = '';
      }}
    />
  );
}
