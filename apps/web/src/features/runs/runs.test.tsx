/**
 * @vitest-environment jsdom
 *
 * The runs screen.
 *
 * Two facts matter here. A run that is still going can be stopped — which is the
 * only way out of the "a search is already running" refusal, and the only way to
 * recover from a run whose process died — and a run that was stopped says so
 * rather than reading as a search that found nothing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsScreen } from './index.js';
import type * as ApiModule from '../../lib/api.js';
import { ApiError, api, type RunSummary } from '../../lib/api.js';

vi.mock('../../lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: { ...actual.api, runs: vi.fn(), cancelRun: vi.fn() } };
});

const run = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  id: 'r1',
  query: 'plumbers',
  location: 'Bhopal',
  limit: 20,
  language: 'en',
  status: 'running',
  startedAt: new Date(0).toISOString(),
  finishedAt: null,
  serpapiCalls: 1,
  leadsFound: 12,
  leadsNew: 9,
  auditsOk: 2,
  auditsFailed: 1,
  draftsLlm: 1,
  draftsFallback: 0,
  tokensIn: 400,
  tokensOut: 300,
  error: null,
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

function renderScreen(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RunsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RunsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.runs).mockResolvedValue({ runs: [run()] });
    vi.mocked(api.cancelRun).mockResolvedValue({ run: run({ status: 'cancelled' }) });
  });

  it('offers to stop a run that is still going', async () => {
    renderScreen();

    const stop = await screen.findByRole('button', { name: 'Stop this search' });
    await userEvent.click(stop);

    expect(api.cancelRun).toHaveBeenCalledWith('r1');
  });

  it('offers no stop for a run that already ended', async () => {
    vi.mocked(api.runs).mockResolvedValue({ runs: [run({ status: 'completed' })] });
    renderScreen();

    await screen.findByText(/plumbers/);
    expect(screen.queryByRole('button', { name: 'Stop this search' })).not.toBeInTheDocument();
  });

  it('offers no stop for a run that was already stopped', async () => {
    vi.mocked(api.runs).mockResolvedValue({ runs: [run({ status: 'cancelled' })] });
    renderScreen();

    await screen.findByText(/plumbers/);
    expect(screen.queryByRole('button', { name: 'Stop this search' })).not.toBeInTheDocument();
  });

  it('says why a stopped run has small numbers', async () => {
    vi.mocked(api.runs).mockResolvedValue({ runs: [run({ status: 'cancelled' })] });
    renderScreen();

    expect(await screen.findByText(/Stopped before it finished/)).toBeInTheDocument();
  });

  it('shows the API’s reason when a stop is refused', async () => {
    // What the API answers when the run ended between the click and the request.
    vi.mocked(api.cancelRun).mockRejectedValue(
      new ApiError('That search already ended as "failed".', 409),
    );
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Stop this search' }));

    await waitFor(() => {
      expect(screen.getByText(/already ended as "failed"/)).toBeInTheDocument();
    });
  });

  it('reloads the list after a stop, so the status is the recorded one', async () => {
    // The first read shows a run in progress; the refetch after the stop shows
    // what the database actually recorded.
    vi.mocked(api.runs)
      .mockResolvedValueOnce({ runs: [run()] })
      .mockResolvedValue({ runs: [run({ status: 'cancelled' })] });
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Stop this search' }));

    await waitFor(() => {
      // The refetch is what turns the button into the explanation.
      expect(screen.getByText(/Stopped before it finished/)).toBeInTheDocument();
    });
    expect(vi.mocked(api.runs).mock.calls.length).toBeGreaterThan(1);
  });
});
