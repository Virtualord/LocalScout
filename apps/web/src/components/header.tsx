import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { NavLink, useLocation } from 'react-router';
import { useState, type ReactNode } from 'react';

/**
 * Header navigation.
 *
 * The header is sticky, teal, 88px, with a 1px ink rule underneath. It holds a
 * wordmark on the left, mono nav in the middle, and the primary action far
 * right, which is the arrangement from the reference.
 *
 * Dropdowns open on hover **and** on click. Hover alone would lock out keyboard
 * and touch users; click alone would feel slow for the reference's audience.
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
    <header className="sticky top-0 z-40 h-[var(--header-height)] border-b border-ink bg-bg">
      <div className="container flex h-full items-center justify-between gap-6">
        <NavLink
          to="/"
          className="display shrink-0 text-2xl text-paper transition-opacity hover:opacity-80"
        >
          Localscout
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
                    'mono px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-paper/85',
                    'transition-colors hover:text-paper',
                    isActive ? 'nav-active' : '',
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
                  className="mono border border-ink px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-paper"
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
                          `nav-panel-item ${isActive ? 'bg-paper/15' : ''}`
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

          <button
            type="button"
            onClick={onNewSearch}
            className="btn btn-primary btn-sm hidden sm:inline-flex"
          >
            New search
          </button>
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
          'text-paper/85 transition-colors hover:text-paper',
          containsActive ? 'nav-active' : '',
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
                <span className="mono block text-[13px] font-bold text-paper">{child.label}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-paper/55">
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
          className="mono z-50 bg-ink px-2.5 py-1.5 text-[12px] text-paper"
        >
          {content}
          {/* No arrow: the reference tooltip is a plain block. */}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
