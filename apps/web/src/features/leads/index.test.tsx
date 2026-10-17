/**
 * @vitest-environment jsdom
 *
 * The leads screen.
 *
 * The screen puts the map, the list, the filters and the empty state on one
 * page, and the fact worth pinning is that the view toggle changes only the
 * view: the same leads — and the same "run another search" card — are there
 * either way.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../../lib/api.js';
import { api, type LeadSummary } from '../../lib/api.js';
import { LeadsScreen } from './index.js';

vi.mock('../../lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: { ...actual.api, leads: vi.fn() } };
});

/** jsdom has no canvas; the map renders one. */
function stubCanvas(): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () =>
      ({
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
      }) as unknown as CanvasRenderingContext2D,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

const lead = (overrides: Partial<LeadSummary> = {}): LeadSummary => ({
  id: 'l1',
  placeId: 'p1',
  domainKey: 'example.com',
  name: 'Sharma Plumbing',
  category: 'Plumber',
  address: 'MP Nagar, Bhopal',
  lat: 23.24,
  lng: 77.41,
  phone: null,
  phoneE164: null,
  phoneIsMobile: null,
  websiteUrl: 'https://example.com',
  contactEmail: null,
  rating: null,
  reviewCount: null,
  status: 'audited',
  notes: null,
  createdAt: new Date(0).toISOString(),
  opportunityScore: 82,
  auditStatus: 'ok',
  canWhatsApp: false,
  draftCount: 0,
  ...overrides,
});

function renderScreen(entry = '/leads'): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <LeadsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeadsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubCanvas();
    vi.mocked(api.leads).mockResolvedValue({ leads: [lead()], total: 1 });
  });

  it('lists the leads with a way to start another search', async () => {
    renderScreen();

    expect(await screen.findByText('Sharma Plumbing')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Run another search/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Lead map' })).not.toBeInTheDocument();
  });

  it('keeps the same list under the map, including the new-search card', async () => {
    renderScreen('/leads?view=map');

    expect(await screen.findByRole('region', { name: 'Lead map' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sharma Plumbing, opportunity 82' }),
    ).toBeInTheDocument();
    // The card was only in the list branch of the toggle, so switching to the map
    // left no way to start another search without going back to the top.
    expect(screen.getByRole('link', { name: /Run another search/ })).toBeInTheDocument();
  });

  it('says no leads yet when nothing has been found at all', async () => {
    vi.mocked(api.leads).mockResolvedValue({ leads: [], total: 0 });
    renderScreen();

    expect(await screen.findByText('No leads yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear the filters' })).not.toBeInTheDocument();
  });

  it('tells an empty result apart from an empty database', async () => {
    vi.mocked(api.leads).mockResolvedValue({ leads: [], total: 0 });
    renderScreen('/leads?status=won');

    expect(await screen.findByText('Nothing matches those filters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear the filters' })).toBeInTheDocument();
  });

  it('asks the API for what the URL says', async () => {
    renderScreen('/leads?status=won&min=60&q=plumb&sort=name');

    await screen.findByText('Sharma Plumbing');
    expect(api.leads).toHaveBeenCalledWith({
      status: 'won',
      minScore: 60,
      q: 'plumb',
      sort: 'name',
      limit: 100,
    });
  });

  it('counts the leads it was given', async () => {
    vi.mocked(api.leads).mockResolvedValue({
      leads: [lead(), lead({ id: 'l2', name: 'Gupta' })],
      total: 7,
    });
    renderScreen();

    expect(await screen.findByText('7 leads')).toBeInTheDocument();
  });
});
