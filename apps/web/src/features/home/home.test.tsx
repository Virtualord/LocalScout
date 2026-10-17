/**
 * @vitest-environment jsdom
 *
 * The home screen.
 *
 * It is the only place a search starts, and the rule it has to hold is that the
 * line under the field never claims more than the run reported: the run's own
 * event text, or an honest default. The map is the same map as the leads screen,
 * so a square opens the same modal.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../../lib/api.js';
import { ApiError, api, subscribeToRun, type LeadSummary, type RunEvent } from '../../lib/api.js';
import { Home } from './index.js';

vi.mock('../../lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    api: { ...actual.api, leads: vi.fn(), startRun: vi.fn(), lead: vi.fn() },
    subscribeToRun: vi.fn(),
  };
});

/** jsdom has no canvas; the hero renders the map below the fold. */
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

/** The stream handler the screen handed to `subscribeToRun`. */
let emit: ((event: RunEvent) => void) | undefined;
const unsubscribe = vi.fn();

function event(type: RunEvent['type'], message: string, leadId?: string): RunEvent {
  return {
    type,
    runId: 'r1',
    at: new Date(0).toISOString(),
    message,
    ...(leadId ? { leadId } : {}),
  };
}

function renderHome(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function search(text: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('Business type and city'), text);
  await userEvent.click(screen.getByRole('button', { name: 'Find leads' }));
}

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emit = undefined;
    stubCanvas();
    vi.mocked(api.leads).mockResolvedValue({ leads: [], total: 0 });
    vi.mocked(api.startRun).mockResolvedValue({ runId: 'r1' });
    vi.mocked(subscribeToRun).mockImplementation((_runId, handler) => {
      emit = handler;
      return unsubscribe;
    });
  });

  it('says there are no leads before anything has been searched for', async () => {
    renderHome();

    expect(
      await screen.findByText('No leads yet. Search for a business type and a city.'),
    ).toBeInTheDocument();
  });

  it('asks for a city with an example rather than guessing one', async () => {
    renderHome();
    await search('plumbers');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Write it like "plumbers in Bhopal".',
    );
    expect(api.startRun).not.toHaveBeenCalled();
  });

  it('starts the search it parsed and follows the run it started', async () => {
    renderHome();
    await search('plumbers in Bhopal');

    expect(api.startRun).toHaveBeenCalledWith({
      query: 'plumbers',
      location: 'Bhopal',
      limit: 20,
      language: 'en',
    });
    await waitFor(() => {
      expect(subscribeToRun).toHaveBeenCalledWith('r1', expect.any(Function));
    });

    // The line is the run's own words, not a summary this screen invented.
    act(() => emit?.(event('run.started', 'Searching Bhopal for plumbers')));
    expect(await screen.findByText('Searching Bhopal for plumbers')).toBeInTheDocument();

    act(() => emit?.(event('lead.discovered', 'Found Sharma Plumbing', 'l1')));
    expect(await screen.findByText('Found Sharma Plumbing')).toBeInTheDocument();
  });

  it('stops saying it is searching when the run finishes', async () => {
    renderHome();
    await search('plumbers in Bhopal');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Searching' })).toBeDisabled();
    });

    act(() => emit?.(event('run.finished', 'Done. 12 leads, 9 drafts.')));

    expect(await screen.findByRole('button', { name: 'Find leads' })).toBeEnabled();
    expect(screen.getByText('Done. 12 leads, 9 drafts.')).toBeInTheDocument();
  });

  it('shows the API’s refusal when a search is already running', async () => {
    vi.mocked(api.startRun).mockRejectedValue(
      new ApiError(
        'A search is already running. Wait for it to finish, or stop it from the Runs screen.',
        409,
      ),
    );
    renderHome();
    await search('plumbers in Bhopal');

    expect(await screen.findByRole('alert')).toHaveTextContent('stop it from the Runs screen');
    expect(screen.getByRole('button', { name: 'Find leads' })).toBeEnabled();
  });

  it('opens the same lead modal from a map square', async () => {
    vi.mocked(api.leads).mockResolvedValue({ leads: [lead()], total: 1 });
    vi.mocked(api.lead).mockResolvedValue({
      lead: lead(),
      audit: null,
      drafts: {},
      contactLog: [],
    });
    renderHome();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Sharma Plumbing, opportunity 82' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Sharma Plumbing');
    expect(dialog).toHaveTextContent('MP Nagar, Bhopal');
  });
});
