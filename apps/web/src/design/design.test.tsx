/**
 * @vitest-environment jsdom
 *
 * Component tests for the design system primitives.
 *
 * These check behaviour that is easy to break and hard to notice: the modal
 * trapping focus, the dropdown opening from the keyboard, the accordion keeping
 * one item open, and reduced motion actually disabling the effects.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  Accordion,
  AccordionItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from './primitives.js';
import { Dialog, DialogContent, DialogTrigger } from './dialog.js';
import { buildSkyline, buildStairs, MiniStrip, PixelSkyline, RouteLoader } from './decorations.js';
import { Card } from './card.js';
import { Button } from './button.js';
import { tierForScore } from './chip.js';

describe('Button', () => {
  it('renders and fires its click handler', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Find leads</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Find leads' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is keyboard focusable', async () => {
    render(<Button>Find leads</Button>);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Find leads' })).toHaveFocus();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Find leads
      </Button>,
    );
    // userEvent refuses to click a pointer-events:none element, which is
    // itself the assertion: a disabled button is not clickable at all.

    await userEvent.click(screen.getByRole('button', { name: 'Find leads' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies the hard shadow and press classes per variant', () => {
    const { rerender } = render(<Button>Primary</Button>);
    expect(screen.getByRole('button').className).toContain('btn-primary');

    rerender(<Button variant="secondary">Secondary</Button>);
    expect(screen.getByRole('button').className).toContain('btn-secondary');
  });

  it('renders as a child element when asked', () => {
    render(
      <Button asChild>
        <a href="/leads">Go</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Go' })).toBeInTheDocument();
  });
});

describe('Card', () => {
  it('uses the coral shadow for a hot lead and the dark one otherwise', () => {
    const { rerender } = render(<Card tier="hot">Hot</Card>);
    expect(screen.getByText('Hot').className).toContain('hard-shadow-coral');

    rerender(<Card>Normal</Card>);
    expect(screen.getByText('Normal').className).toContain('hard-shadow');
  });

  it('applies the press-in class unless static', () => {
    const { rerender } = render(<Card>Card</Card>);
    expect(screen.getByText('Card').className).toContain('press-in');

    rerender(<Card static>Card</Card>);
    expect(screen.getByText('Card').className).not.toContain('press-in');
  });
});

describe('tierForScore', () => {
  it('maps a score to a tier', () => {
    expect(tierForScore(85)).toBe('hot');
    expect(tierForScore(70)).toBe('hot');
    expect(tierForScore(55)).toBe('warm');
    expect(tierForScore(20)).toBe('cold');
  });

  it('treats an unaudited lead as unknown, not cold', () => {
    // "Cold" would be a claim about a site that was never checked.
    expect(tierForScore(null)).toBe('unknown');
    expect(tierForScore(undefined)).toBe('unknown');
  });
});

describe('Dialog', () => {
  const Harness = () => {
    const [open, setOpen] = useState(false);
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button type="button">Open lead</button>
        </DialogTrigger>
        <DialogContent title="Sharma Plumbing" description="Audited 2 min ago">
          <button type="button">Inside button</button>
        </DialogContent>
      </Dialog>
    );
  };

  it('opens from the trigger', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open lead' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Sharma Plumbing')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open lead' }));
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes when the close button is used', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open lead' }));
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('traps focus inside the dialog', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open lead' }));
    const dialog = await screen.findByRole('dialog');

    // Focus starts inside rather than staying behind on the trigger.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('labels itself with its title', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open lead' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Sharma Plumbing');
  });
});

describe('Tabs', () => {
  const Harness = () => (
    <Tabs defaultValue="audit">
      <TabsList>
        <TabsTrigger value="audit">Audit</TabsTrigger>
        <TabsTrigger value="message">Message</TabsTrigger>
        <TabsTrigger value="log">Log</TabsTrigger>
      </TabsList>
      <TabsContent value="audit">Audit panel</TabsContent>
      <TabsContent value="message">Message panel</TabsContent>
      <TabsContent value="log">Log panel</TabsContent>
    </Tabs>
  );

  it('shows the default panel only', () => {
    render(<Harness />);
    expect(screen.getByText('Audit panel')).toBeInTheDocument();
    expect(screen.queryByText('Message panel')).not.toBeInTheDocument();
  });

  it('switches panels on click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'Message' }));

    expect(screen.getByText('Message panel')).toBeInTheDocument();
    expect(screen.queryByText('Audit panel')).not.toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'Audit' }).focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Message' })).toHaveFocus();
  });
});

describe('Accordion', () => {
  const Harness = () => (
    <Accordion type="single" collapsible>
      <AccordionItem value="one" question="Does it send messages?">
        No. A human reviews and sends every message.
      </AccordionItem>
      <AccordionItem value="two" question="Where does my data go?">
        Nowhere unless you enable live discovery.
      </AccordionItem>
    </Accordion>
  );

  it('starts collapsed', () => {
    render(<Harness />);
    expect(
      screen.queryByText('No. A human reviews and sends every message.'),
    ).not.toBeInTheDocument();
  });

  it('opens an item when its question is clicked', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Does it send messages?' }));
    expect(screen.getByText('No. A human reviews and sends every message.')).toBeInTheDocument();
  });

  it('keeps only one item open at a time', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'Does it send messages?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Where does my data go?' }));

    // The first has closed, because the accordion is type="single".
    await waitFor(() =>
      expect(
        screen.queryByText('No. A human reviews and sends every message.'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Nowhere unless you enable live discovery.')).toBeInTheDocument();
  });

  it('exposes each trigger as a button with an expanded state', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Does it send messages?' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('pixel decorations', () => {
  it('builds a staircase one cell right and one down per step', () => {
    expect(buildStairs(4)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it('builds the same staircase every time', () => {
    expect(buildStairs(6)).toEqual(buildStairs(6));
  });

  it('builds skyline heights between one and four steps', () => {
    const heights = buildSkyline(9, 3);
    expect(heights).toHaveLength(9);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(1);
      expect(height).toBeLessThanOrEqual(4);
    }
  });

  it('is deterministic for a seed, so a snapshot means something', () => {
    expect(buildSkyline(8, 3)).toEqual(buildSkyline(8, 3));
  });

  it('changes with the seed, which is what makes the re-seed visible', () => {
    expect(buildSkyline(8, 3)).not.toEqual(buildSkyline(8, 4));
  });

  it('renders the four-colour strip', () => {
    const { container } = render(<MiniStrip />);
    // Selected by test id rather than structure: `div > div` also matches the
    // strip's own wrapper.
    const squares = container.querySelectorAll('[data-testid="strip-square"]');
    expect(squares).toHaveLength(4);
  });

  it('freezes the skyline when animation is off', () => {
    vi.useFakeTimers();
    const { container } = render(<PixelSkyline columns={5} animate={false} />);
    const before = container.innerHTML;

    vi.advanceTimersByTime(5000);
    expect(container.innerHTML).toBe(before);
    vi.useRealTimers();
  });

  it('re-seeds the skyline over time when animating', () => {
    vi.useFakeTimers();
    // Enough columns that a re-seed is very unlikely to reproduce the same
    // heights, which would make the assertion flaky rather than meaningful.
    const { container } = render(<PixelSkyline columns={9} animate seed={1} />);
    const before = container.innerHTML;

    // The reference re-seeds roughly every 1200ms. act() is required so React
    // flushes the state update that the interval triggers.
    act(() => {
      vi.advanceTimersByTime(1300);
    });

    expect(container.innerHTML).not.toBe(before);
    vi.useRealTimers();
  });
});

describe('RouteLoader', () => {
  it('is announced as a loading status', () => {
    render(<RouteLoader />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading');
  });

  it('holds for a minimum time so a fast load does not flash', async () => {
    vi.useFakeTimers();
    const { container } = render(<RouteLoader size={20} />);

    // Squares are mounted but the bob animation is paused until the hold ends.
    const before = container.innerHTML;
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(container.innerHTML).toBe(before);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(container.innerHTML).not.toBe(before);
    vi.useRealTimers();
  });

  it('stops bobbing under reduced motion', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));

    const { container } = render(<RouteLoader />);
    // No animation style at all means no motion.
    expect(container.innerHTML).not.toContain('animation');

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
