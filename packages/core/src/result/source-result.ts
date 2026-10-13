/**
 * The result type every external call in Localscout returns.
 *
 * The point is honesty about partial knowledge. Discovery, audit and drafting
 * all talk to things that can fail, be slow, or be temporarily impossible to
 * reach. None of those outcomes is an exception; each one is a value that
 * records what was learned and what was not.
 *
 * - `ok`          the call succeeded and the payload is current.
 * - `stale`       partial data. Something worked and something else did not
 *                 (for example: the HTML checks passed but Lighthouse failed).
 *                 The payload is usable, and `error` says what is missing.
 * - `unavailable` nothing usable came back. `payload` is undefined and
 *                 `error` explains what to do about it.
 *
 * A caller must never have to guess which case it is in, and must never be
 * handed a value that looks measured but was invented.
 */

/** Outcome of a single external interaction. */
export type SourceStatus = 'ok' | 'stale' | 'unavailable';

/** Where the payload came from, for metrics and debugging. */
export type SourceKind = 'discovery' | 'audit' | 'draft' | 'db' | 'http' | 'llm' | 'system';

export interface SourceError {
  /** Stable, greppable identifier, for example `ssrf_blocked` or `chrome_missing`. */
  code: string;
  /** Message written for a human. Says what went wrong and how to fix it. */
  message: string;
  /** How long the call took before giving up, when it took any time at all. */
  durationMs?: number;
  /** Extra context for logs. Never contains secrets. */
  detail?: Record<string, unknown>;
}

export interface SourceMeta {
  /** Wall-clock duration of the underlying call. */
  durationMs: number;
  /** ISO timestamp of when the call finished. */
  at: string;
  /** True when the payload came from a recorded fixture rather than a live call. */
  fromCache?: boolean;
  /** Present when `status` is `stale`: what specifically did not work. */
  degradedBy?: string[];
}

/** What a caller actually receives. `payload` exists only when there is data. */
export type SourceResult<T> =
  | {
      status: 'ok';
      kind: SourceKind;
      value: T;
      meta: SourceMeta;
      error?: undefined;
    }
  | {
      status: 'stale';
      kind: SourceKind;
      /** Partial but real. Never synthesised. */
      value: T;
      meta: SourceMeta;
      error: SourceError;
    }
  | {
      status: 'unavailable';
      kind: SourceKind;
      value?: undefined;
      meta: SourceMeta;
      error: SourceError;
    };

export interface SourceResultInput<T> {
  kind: SourceKind;
  status: SourceStatus;
  value?: T | undefined;
  error?: SourceError | undefined;
  durationMs: number;
  fromCache?: boolean;
  degradedBy?: string[];
}

const nowIso = (): string => new Date().toISOString();

/**
 * Build a `SourceResult`.
 *
 * The `value`/`error` pairing is enforced rather than trusted: an `ok` result
 * without a value, or an `unavailable` result with one, is a programming error
 * and throws here instead of surfacing later as a confusing null.
 */
export function sourceResult<T>(input: SourceResultInput<T>): SourceResult<T> {
  const meta: SourceMeta = {
    durationMs: input.durationMs,
    at: nowIso(),
    ...(input.fromCache === undefined ? {} : { fromCache: input.fromCache }),
    ...(input.degradedBy && input.degradedBy.length > 0 ? { degradedBy: input.degradedBy } : {}),
  };

  const hasValue = input.value !== undefined;
  const hasError = input.error !== undefined;

  // An `ok` result must not carry an error: that combination hides a failure.
  if (input.status === 'ok' && hasValue && !hasError) {
    return { status: 'ok', kind: input.kind, value: input.value, meta };
  }

  if (input.status === 'stale' && hasValue && hasError) {
    return { status: 'stale', kind: input.kind, value: input.value, meta, error: input.error };
  }

  // An `unavailable` result must not carry a value: presenting partial data as
  // "nothing came back" is the exact confusion this type exists to prevent.
  if (input.status === 'unavailable' && hasError && !hasValue) {
    return { status: 'unavailable', kind: input.kind, meta, error: input.error };
  }

  throw new Error(
    `Invalid SourceResult for kind "${input.kind}": status "${input.status}" requires ` +
      (input.status === 'unavailable' ? 'an error and no value' : 'a value') +
      (input.status === 'stale' ? ' plus an error describing what degraded' : '') +
      (input.status === 'ok' ? ' and no error' : '') +
      `. Received value: ${hasValue ? 'present' : 'missing'}, error: ${hasError ? 'present' : 'missing'}.`,
  );
}

/** Convenience for a fully successful call. */
export function ok<T>(
  kind: SourceKind,
  value: T,
  durationMs: number,
  fromCache?: boolean,
): SourceResult<T> {
  return sourceResult({
    kind,
    status: 'ok',
    value,
    durationMs,
    ...(fromCache === undefined ? {} : { fromCache }),
  });
}

/** Convenience for partial data that is real but incomplete. */
export function stale<T>(
  kind: SourceKind,
  value: T,
  error: SourceError,
  durationMs: number,
  degradedBy?: string[],
): SourceResult<T> {
  return sourceResult({
    kind,
    status: 'stale',
    value,
    error,
    durationMs,
    ...(degradedBy ? { degradedBy } : {}),
  });
}

/** Convenience for a call that produced nothing usable. */
export function unavailable(
  kind: SourceKind,
  error: SourceError,
  durationMs: number,
): SourceResult<never> {
  return sourceResult<never>({ kind, status: 'unavailable', error, durationMs });
}

/** True when there is a payload, whether the call fully succeeded or not. */
export function hasValue<T>(
  result: SourceResult<T>,
): result is Extract<SourceResult<T>, { value: T }> {
  return result.value !== undefined;
}

/** True only for a fully successful call. */
export function isOk<T>(
  result: SourceResult<T>,
): result is Extract<SourceResult<T>, { status: 'ok' }> {
  return result.status === 'ok';
}

/** True when the call returned real but partial data. */
export function isStale<T>(
  result: SourceResult<T>,
): result is Extract<SourceResult<T>, { status: 'stale' }> {
  return result.status === 'stale';
}

/** The payload, or `undefined` when the call produced nothing usable. */
export function valueOr<T>(result: SourceResult<T>, fallback: T): T {
  return result.value !== undefined ? result.value : fallback;
}

/**
 * Map the payload, keeping status and metadata intact.
 *
 * A failed call stays failed: there is no value to map, and mapping one into
 * existence would be exactly the invention this type exists to prevent.
 */
export function mapValue<T, U>(result: SourceResult<T>, fn: (value: T) => U): SourceResult<U> {
  if (result.value === undefined) {
    return sourceResult<U>({
      kind: result.kind,
      status: 'unavailable',
      error: result.error ?? {
        code: 'unknown',
        message: 'Result had no value to map.',
      },
      durationMs: result.meta.durationMs,
    });
  }
  return sourceResult<U>({
    kind: result.kind,
    status: result.status,
    value: fn(result.value),
    error: result.error,
    durationMs: result.meta.durationMs,
    ...(result.meta.fromCache === undefined ? {} : { fromCache: result.meta.fromCache }),
    ...(result.meta.degradedBy ? { degradedBy: result.meta.degradedBy } : {}),
  });
}

/** A human-readable one-liner for logs and the run error column. */
export function describe(result: SourceResult<unknown>): string {
  switch (result.status) {
    case 'ok':
      return 'ok';
    case 'stale':
      return `stale: ${result.error.code}`;
    case 'unavailable':
      return `unavailable: ${result.error.code}`;
  }
}
