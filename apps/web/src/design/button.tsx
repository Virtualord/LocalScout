import { Slot } from '@radix-ui/react-slot';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * Buttons.
 *
 * Three rules the whole design depends on:
 *
 * - **Sharp corners.** `--radius: 0` everywhere; a rounded button breaks the
 *   language instantly.
 * - **The hard shadow is always paired with a colour.** An uncoloured shadow
 *   reads as a rendering bug.
 * - **Press, not hover-lift.** Hover translates 2px and shrinks the shadow;
 *   active translates 4px and collapses it to zero. That is the interaction
 *   from the reference, and it is a physical metaphor: the button is being
 *   pressed into the page.
 *
 * The state colours live in `global.css` rather than in Tailwind utilities,
 * because the shadow colour differs per variant, and composing
 * `shadow-[2px_2px_0_...]` per variant in the component is exactly how the
 * wrong colour silently ships.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render as the single child element instead of a `<button>`. */
  asChild?: boolean;
  children?: ReactNode;
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', asChild = false, className = '', children, ...rest },
  ref,
) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      ref={ref}
      className={['btn', `btn-${variant}`, SIZES[size], className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </Component>
  );
});
