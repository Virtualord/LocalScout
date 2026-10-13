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
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50" />
      <DialogPrimitive.Content
        onCloseAutoFocus={onCloseAutoFocus}
        className={[
          'dialog-panel fixed left-1/2 top-1/2 z-50 w-[min(94vw,1000px)] -translate-x-1/2 -translate-y-1/2',
          size === 'lg' ? 'max-h-[88vh]' : 'max-h-[86vh]',
          'overflow-y-auto border border-ink bg-paper text-ink',
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
            'flex items-start justify-between gap-4',
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

        <div className={size === 'lg' ? '' : 'mt-6'}>{children}</div>

        {footer && <footer className="mt-6 flex flex-wrap gap-3">{footer}</footer>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
