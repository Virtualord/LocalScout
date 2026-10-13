import { Link } from 'react-router';

/** 404. Says what happened and offers the one action that helps. */
export function NotFound() {
  return (
    <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <p className="eyebrow text-ink/60">404</p>
      <h1 className="display text-section">
        <span className="text-ink">No such </span>
        <span className="text-red">page</span>
      </h1>
      <p className="prose-measure text-[15px] text-ink/70">
        That address does not match anything in Localscout.
      </p>
      <Link to="/" className="btn btn-primary btn-md">
        Back to the start
      </Link>
    </div>
  );
}
