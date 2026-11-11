import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { NavLink, useLocation } from 'react-router';
import { useState, type ReactNode } from 'react';
import { LocationPin } from '../design/decorations.js';

/**
 * Header navigation.
 *
 * The header is sticky and petrol, 88px, with a gold survey rule along its top
 * edge and a 1px ink rule underneath. It holds a wordmark on the left, mono nav
 * in the middle, and the primary action far right.
 *
 * Dropdowns open on hover **and** on click. Hover alone would lock out keyboard
 * and touch users; click alone would feel slow for this audience.
 */

interface NavItem {
  label: string;
  to: string;
  /** Sub-pages, shown in the dropdown panel. */
  children?: { label: string; to: string; description: string }[];
}

const NAV: NavItem[] = [
  { label: 'Leads', to: '/leads' },
  {
    label: 'Product',
    to: '/',
    children: [
      { label: 'How it works', to: '/#how', description: 'Search, audit, send with proof' },
      { label: 'What it is', to: '/#what', description: 'Local-first and offline' },
      { label: 'Built with', to: '/#built', description: 'The stack underneath' },
    ],
  },
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Runs', to: '/runs' },
  { label: 'Settings', to: '/settings' },
];

export function Header({ onNewSearch }: { onNewSearch?: () => void }) {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-40 h-[var(--header-height)] border-b border-ink border-t-[3px] border-t-amber bg-bg">
      <div className="container flex h-full items-center justify-between gap-6">
        <NavLink
          to="/"
          className="display flex shrink-0 items-center gap-2.5 text-2xl text-paper transition-opacity hover:opacity-80"
        >
          Localscout
          <span className="mt-0.5 text-amber" aria-hidden="true">
            <LocationPin size={15} />
          </span>
        </NavLink>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) =>
            item.children ? (
              <NavDropdown key={item.label} item={item} currentPath={location.pathname} />
            ) : (
              <NavLink
                key={item.label}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'mono px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-paper/80',
                    'transition-colors hover:text-paper',
                    isActive ? 'nav-active text-paper' : '',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          {/* Mobile navigation lives in the same list, revealed on small screens. */}
          <nav aria-label="Main" className="md:hidden">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="mono border border-paper/50 px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-paper"
                >
                  Menu
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="nav-panel" align="end" sideOffset={8}>
                  {NAV.map((item) => (
                    <DropdownMenu.Item key={item.label} asChild>
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `nav-panel-item ${isActive ? 'bg-paper-band' : ''}`
                        }
                      >
                        {item.label}
                      </NavLink>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </nav>

          {/*
            The wrapper carries the responsive visibility, not the button:
            `.btn` sets `display: inline-flex` in the unlayered stylesheet, and
            unlayered rules beat Tailwind's layered `hidden` utility, so a
            `hidden` class on the button itself would never take effect.
          */}
          <span className="hidden sm:inline-flex">
            <button type="button" onClick={onNewSearch} className="btn btn-primary btn-sm">
              New search
            </button>
          </span>
        </div>
      </div>
    </header>
  );
}

/** A nav entry that opens a panel of sub-pages. */
function NavDropdown({ item, currentPath }: { item: NavItem; currentPath: string }) {
  const [open, setOpen] = useState(false);
  const containsActive = item.to === '/' && currentPath === '/';

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        asChild
        onPointerEnter={() => setOpen(true)}
        className={[
          'mono flex items-center gap-1 px-3 py-2 text-[12px] font-bold uppercase tracking-wider',
          'text-paper/80 transition-colors hover:text-paper',
          containsActive ? 'nav-active text-paper' : '',
        ].join(' ')}
      >
        <button type="button">
          {item.label}
          <span
            aria-hidden="true"
            className={`text-[9px] transition-transform duration-[--dur-fast] ${open ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content className="nav-panel" align="start" sideOffset={4}>
          {(item.children ?? []).map((child) => (
            <DropdownMenu.Item key={child.to} asChild>
              <NavLink to={child.to} className="nav-panel-item block">
                <span className="mono block text-[13px] font-bold text-ink">{child.label}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink/70">
                  {child.description}
                </span>
              </NavLink>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Tooltip.
 *
 * Used on the map, where the pointer needs to learn what a square is. Rendered
 * as a real tooltip on keyboard focus too, because hover-only tooltips are
 * invisible to keyboard users.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={200}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="mono z-50 border border-amber bg-ink px-2.5 py-1.5 text-[12px] text-paper"
        >
          {content}
          {/* No arrow: a plain block reads as a label on the map. */}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
