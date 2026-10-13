import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * Inputs and the joined search field.
 *
 * The hero search is a single row: an icon on the left, white input face, then
 * the coral button with **no gap**. That join is the whole point of the
 * component, so `SearchField` owns the layout and the caller never has to
 * reproduce the pixel alignment.
 */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Shown to the left, inside the field. */
  icon?: ReactNode;
  /** Hide the label visually while keeping it for screen readers. */
  hideLabel?: boolean;
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, hideLabel = false, label, error, className = '', id, ...rest },
  ref,
) {
  const inputId = id ?? (label ? `input-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  return (
    <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      {label && (
        <label
          htmlFor={inputId}
          className={
            hideLabel
              ? 'sr-only'
              : 'mono text-[11px] font-bold uppercase tracking-wider text-ink/70'
          }
        >
          {label}
        </label>
      )}

      <div
        className={[
          'flex items-center gap-2 border bg-white px-3',
          // The error border is the only place a non-ink border appears.
          error ? 'border-red' : 'border-ink',
        ].join(' ')}
      >
        {icon && <span className="shrink-0 text-ink/60">{icon}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error !== undefined}
          aria-describedby={error && inputId ? `${inputId}-error` : undefined}
          className="w-full bg-transparent py-2.5 text-[15px] text-ink outline-none placeholder:text-ink/45"
          {...rest}
        />
      </div>

      {error && (
        <p id={inputId ? `${inputId}-error` : undefined} className="text-[13px] text-red">
          {error}
        </p>
      )}
    </div>
  );
});

/**
 * The hero search: input and button joined into one row.
 *
 * The button is a sibling rather than a child of the input so the value can be
 * submitted from a form without nesting an interactive element inside a label.
 */
export function SearchField({
  value,
  onChange,
  onSubmit,
  placeholder = 'Plumbers in Bhopal',
  error,
  buttonLabel = 'Find leads',
  busy = false,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  error?: string;
  buttonLabel?: string;
  busy?: boolean;
  id?: string;
}) {
  const inputId = id ?? 'search-input';

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="w-full max-w-[640px]"
    >
      <label htmlFor={inputId} className="sr-only">
        Business type and city
      </label>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex flex-1 items-stretch">
          <div
            className={[
              'flex flex-1 items-center gap-2 border border-r-0 bg-white px-4',
              error ? 'border-red' : 'border-ink',
            ].join(' ')}
          >
            <SearchIcon />
            <input
              id={inputId}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              aria-invalid={error !== undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              className="w-full bg-transparent py-4 text-[15px] text-ink outline-none placeholder:text-ink/45"
            />
          </div>

          {/* Joined: no gap, no rounding, the button completes the field. */}
          <button
            type="submit"
            className="btn btn-primary btn-lg whitespace-nowrap"
            disabled={busy}
          >
            {busy ? 'Searching' : buttonLabel}
          </button>
        </div>

        {error && (
          <p id={`${inputId}-error`} role="alert" className="text-[13px] text-paper">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * A search glyph drawn from the same pixel vocabulary as the rest of the
 * decorations, rather than pulling in an icon package for one shape.
 */
export function SearchIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <rect x="1.5" y="1.5" width="9" height="9" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="3" height="2" fill="currentColor" />
      <rect x="13" y="9" width="2" height="2" fill="currentColor" />
    </svg>
  );
}

/** A check glyph for the sent chip. */
export function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 6.5L4.5 10L11 2" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}
