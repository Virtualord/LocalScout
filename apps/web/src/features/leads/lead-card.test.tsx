/**
 * @vitest-environment jsdom
 *
 * The lead card and the settings health copy.
 *
 * These are the two places where a wrong string is a wrong promise. The lead
 * card says what is wrong with a site, and the settings page says what is
 * missing — neither may claim something the run did not measure.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { LeadCard, StatusChip, topFindingLine } from './lead-card.js';
import { describeMode } from '../settings/index.js';
import type { LeadSummary } from '../../lib/api.js';

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

/** The card renders a router `Link` in its non-modal form, so it needs a router. */
function renderCard(node: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('topFindingLine', () => {
  it('says not audited when the lead has not been audited', () => {
    expect(topFindingLine(lead({ status: 'discovered', opportunityScore: null }))).toBe(
      'Not audited yet',
    );
  });

  it('says the audit did not complete when it failed', () => {
    expect(topFindingLine(lead({ opportunityScore: null, auditStatus: 'unavailable' }))).toBe(
      'Audit did not complete',
    );
  });

  it('says there is no website when there is not one', () => {
    expect(topFindingLine(lead({ websiteUrl: null }))).toBe('No website of its own');
  });

  it('says no published email when a mobile number exists but no email', () => {
    expect(topFindingLine(lead({ contactEmail: null, phoneE164: '+919800000000' }))).toBe(
      'No published email on the site',
    );
  });

  it('claims nothing when there is nothing verifiable to say', () => {
    // No finding here means no sentence, rather than an invented one.
    expect(topFindingLine(lead({ contactEmail: 'hi@example.com' }))).toBeUndefined();
  });
});

describe('LeadCard', () => {
  it('shows the name, category and address', () => {
    renderCard(<LeadCard lead={lead()} />);
    expect(screen.getByText('Sharma Plumbing')).toBeInTheDocument();
    expect(screen.getByText(/MP Nagar, Bhopal/)).toBeInTheDocument();
  });

  it('shows the score', () => {
    renderCard(<LeadCard lead={lead()} />);
    expect(screen.getByText('82')).toBeInTheDocument();
  });

  it('does not show a score of zero for an unaudited lead', () => {
    renderCard(<LeadCard lead={lead({ opportunityScore: null, auditStatus: null })} />);
    expect(screen.getByText(/not audited/i)).toBeInTheDocument();
  });

  it('shows a WhatsApp chip only when the number is a mobile', () => {
    const { rerender } = renderCard(<LeadCard lead={lead({ canWhatsApp: true })} />);
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <LeadCard lead={lead({ canWhatsApp: false })} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument();
  });

  it('renders a button when it opens a modal instead of navigating', () => {
    renderCard(<LeadCard lead={lead()} onOpen={() => undefined} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders a link when there is no modal handler', () => {
    renderCard(<LeadCard lead={lead()} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/leads?lead=l1');
  });

  it('falls back gracefully when there is no category', () => {
    renderCard(<LeadCard lead={lead({ category: null })} />);
    expect(screen.getByText(/Business/)).toBeInTheDocument();
  });
});

describe('StatusChip', () => {
  it('labels every status in words, not only by colour', () => {
    const statuses = [
      'discovered',
      'audited',
      'drafted',
      'approved',
      'sent',
      'replied',
      'won',
      'lost',
      'skipped',
    ] as const;

    for (const status of statuses) {
      const { unmount } = render(<StatusChip status={status} />);
      // Every chip must carry readable text, so status is legible without
      // distinguishing one colour from another.
      expect(
        screen.getByText(
          status === 'discovered'
            ? 'New'
            : status === 'audited'
              ? 'Audited'
              : status === 'drafted'
                ? 'Draft ready'
                : status === 'approved'
                  ? 'Reviewed'
                  : status === 'sent'
                    ? 'Sent'
                    : status === 'skipped'
                      ? 'Skipped'
                      : status,
        ),
      ).toBeInTheDocument();
      unmount();
    }
  });
});

describe('describeMode', () => {
  it('explains fixtures mode', () => {
    expect(describeMode('fixtures')).toMatch(/fixtures/i);
  });

  it('explains the template provider honestly', () => {
    expect(describeMode('fixture')).toMatch(/template/i);
  });

  it('names Ollama', () => {
    expect(describeMode('ollama')).toMatch(/ollama/i);
  });

  it('falls back to the raw value rather than hiding an unknown mode', () => {
    expect(describeMode('something-new')).toBe('something-new');
  });
});
