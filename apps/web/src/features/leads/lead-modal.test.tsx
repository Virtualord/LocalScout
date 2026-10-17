/**
 * @vitest-environment jsdom
 *
 * The draft tab of the lead modal.
 *
 * The rule it exists to hold: a draft is written in the language the person
 * picked. The switcher used to render only when a draft already existed, so with
 * nothing written the request was fixed to English and there was no way to reach
 * Hindi or Hinglish at all — the case that needed a language choice could not
 * make one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadModal } from './lead-modal.js';
import type * as ApiModule from '../../lib/api.js';
import { api, type DraftSummary, type LeadSummary } from '../../lib/api.js';

vi.mock('../../lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: { ...actual.api, lead: vi.fn(), createDraft: vi.fn() } };
});

const lead: LeadSummary = {
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
};

const draft = (overrides: Partial<DraftSummary> = {}): DraftSummary => ({
  id: 'd1',
  leadId: 'l1',
  language: 'en',
  whatsappText: 'Hello, I had a look at your site.',
  emailSubject: null,
  emailBody: null,
  generatedBy: 'fallback',
  model: null,
  tokensIn: 0,
  tokensOut: 0,
  latencyMs: 4,
  grounded: true,
  validationErrors: [],
  createdAt: new Date(0).toISOString(),
  approvedAt: null,
  ...overrides,
});

function renderModal(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LeadModal leadId="l1" onClose={vi.fn()} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** Open the draft tab, which is not the first one. */
async function openDraftTab(): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name: 'Draft' }));
}

describe('the draft tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.lead).mockResolvedValue({ lead, audit: null, drafts: {}, contactLog: [] });
    vi.mocked(api.createDraft).mockResolvedValue({ draft: draft(), lead });
  });

  it('offers every language when nothing has been written yet', async () => {
    renderModal();
    await openDraftTab();

    expect(screen.getByText('No English draft yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English — no draft yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hinglish — no draft yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'हिन्दी — no draft yet' })).toBeInTheDocument();
  });

  it('asks for the language that was picked', async () => {
    renderModal();
    await openDraftTab();

    await userEvent.click(screen.getByRole('button', { name: 'हिन्दी — no draft yet' }));
    await userEvent.click(screen.getByRole('button', { name: 'Write the हिन्दी draft' }));

    expect(api.createDraft).toHaveBeenCalledWith('l1', 'hi');
  });

  it('marks the languages that have a draft and shows the selected one', async () => {
    const hindi = draft({ language: 'hi', whatsappText: 'नमस्ते, आपकी साइट पर एक नज़र डाली।' });
    vi.mocked(api.lead).mockResolvedValue({
      lead,
      audit: null,
      drafts: { hi: hindi },
      contactLog: [],
    });
    renderModal();
    await openDraftTab();

    // The default is English, which has nothing, and the row says so without a
    // click per language.
    expect(screen.getByText('No English draft yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'हिन्दी — draft ready' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'हिन्दी — draft ready' }));

    expect(screen.getByText('नमस्ते, आपकी साइट पर एक नज़र डाली।')).toBeInTheDocument();
  });

  it('writes English when English is the language selected', async () => {
    const hindi = draft({ language: 'hi' });
    vi.mocked(api.lead).mockResolvedValue({
      lead,
      audit: null,
      drafts: { hi: hindi },
      contactLog: [],
    });
    renderModal();
    await openDraftTab();

    await userEvent.click(screen.getByRole('button', { name: 'English — no draft yet' }));
    await userEvent.click(screen.getByRole('button', { name: 'Write the English draft' }));

    expect(api.createDraft).toHaveBeenCalledWith('l1', 'en');
  });
});
