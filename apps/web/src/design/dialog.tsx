import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

/**
 * Modal.
 *
 * Built on Radix so focus trapping, Escape, scroll locking and the
 * `aria-modal` wiring are correct by construction rather than by hand.
 *
 * The motion is the reference's: the backdrop fades to a dark scrim and the
 * panel rises 8px while fading in. Both are disabled under reduced motion,
 * where the panel simply appears.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  footer,
  className = '',
  size = 'md',
  onCloseAutoFocus,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: 'md' | 'lg';
  /**
   * Where focus goes when the modal closes.
   *
   * Radix's default restores focus to the trigger. A modal opened from a plain
   * button has no trigger, so callers that open it from somewhere else need to
   * say where focus belongs. Call `event.preventDefault()` and focus the target.
   */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  /*
   * The panel is a column with a scrolling body and a fixed header and footer.
   *
   * It used to be one scrolling box, so on a phone the footer — which holds the
   * actions for dismissing a lead, "Skip this one" and "Close" — sat below the
   * fold and could only be reached by scrolling the whole modal past its own
   * content. A control you have to hunt for is a control most people never press.
   * The body scrolls; the two bars do not, so the controls stay where they were
   * put.
   */
  const bars = size === 'lg' ? 'px-7' : '';

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50" />
      <DialogPrimitive.Content
        onCloseAutoFocus={onCloseAutoFocus}
        className={[
          'dialog-panel fixed left-1/2 top-1/2 z-50 flex w-[min(94vw,1000px)] -translate-x-1/2 -translate-y-1/2 flex-col',
          size === 'lg' ? 'max-h-[88vh]' : 'max-h-[86vh]',
          'border border-ink bg-paper text-ink',
          size === 'lg' ? 'p-0' : 'p-7',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/*
          The large variant drops the outer padding so a lead card inside it can
          sit flush against the border. The header therefore supplies its own
          padding, or the title touches the top edge.
        */}
        <header
          className={[
            'flex shrink-0 items-start justify-between gap-4',
            size === 'lg' ? 'px-7 pb-5 pt-6' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="min-w-0">
            <DialogPrimitive.Title className="display text-3xl text-ink">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mono mt-1 text-[12px] text-ink/65">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>

          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label="Close"
              className="mono flex size-7 shrink-0 items-center justify-center border border-ink bg-paper text-[15px] leading-none text-ink transition-colors hover:bg-ink hover:text-paper"
            >
              ×
            </button>
          </DialogPrimitive.Close>
        </header>

        <div
          className={[
            'min-h-0 flex-1 overflow-y-auto',
            // The scrolling body must not swallow a scroll from the page behind.
            'overscroll-contain',
            size === 'lg' ? '' : 'mt-6',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </div>

        {/*
          The large variant has no outer padding, so the footer supplies its own —
          the same inset the header uses. Without it the last row of buttons sat
          flush against the panel's bottom border, and the hard shadows they carry
          were clipped along that edge.
        */}
        {footer && (
          <footer
            className={[
              /*
               * Two even columns on a phone, one wrapping row from `sm` up.
               * Left to wrap on its own, four buttons of different widths landed
               * as 2-1-1, which reads as a mistake even when every button is
               * perfectly reachable.
               */
              'grid shrink-0 grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center',
              size === 'lg' ? 'px-7 pb-6 pt-5' : 'mt-6',
              bars,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {footer}
          </footer>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
