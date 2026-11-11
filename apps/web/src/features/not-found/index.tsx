import { Link } from 'react-router';
import { CompassMark, LocationPin, MiniStrip } from '../../design/decorations.js';

/** 404. Says what happened and offers the one action that helps. */
export function NotFound() {
  return (
    <div className="relative overflow-hidden bg-bg">
      <CompassMark
        size={220}
        className="pointer-events-none absolute -right-10 top-1/2 hidden -translate-y-1/2 text-paper/10 md:block"
      />

      <div className="container relative flex min-h-[62vh] flex-col items-start justify-center gap-5 py-20 text-left">
        <MiniStrip size={14} />
        <p className="eyebrow text-paper/60">404 · off the map</p>
        <h1 className="display display-section">
          <span className="block text-paper">No such </span>
          <span className="block text-coral">page</span>
        </h1>
        <p className="prose-measure text-[15px] leading-relaxed text-paper/75">
          That address does not match anything in Localscout. It may have moved, or never existed.
        </p>
        <Link to="/" className="btn btn-primary btn-md mt-2">
          Back to the start
        </Link>
        <p className="mono mt-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-paper/65">
          <LocationPin size={12} className="text-amber" />
          Survey sheet · not found
        </p>
      </div>
      <div className="rule-ticks" />
    </div>
  );
}
