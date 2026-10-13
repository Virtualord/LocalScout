import { useState } from 'react';
import { Button } from '../../design/button.js';
import {
  Card,
  ComparisonCard,
  ComparisonRow,
  DashedCtaCard,
  DashedCtaLink,
  ScoreBlock,
} from '../../design/card.js';
import { Chip, TierChip, tierForScore } from '../../design/chip.js';
import {
  Accordion,
  AccordionItem,
  Timeline,
  TimelineStep,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../design/primitives.js';
import { Input, SearchField } from '../../design/input.js';
import { Dialog, DialogContent, DialogTrigger } from '../../design/dialog.js';
import {
  buildSkyline,
  buildStairs,
  MiniStrip,
  PixelBars,
  PixelSkyline,
  PixelStairs,
  RouteLoader,
} from '../../design/decorations.js';
import { LeadCard, NewSearchCard, StatusChip } from '../leads/lead-card.js';
import { PixelMap } from '../map/index.js';
import type { LeadSummary } from '../../lib/api.js';

/**
 * The styleguide.
 *
 * Every component in the design system, on one page, with the real props rather
 * than idealised ones. It exists so the next person changing a colour can see
 * what that colour is used on, and so a contrast regression is visible in a
 * screenshot rather than in a bug report.
 */

export function Styleguide() {
  const [search, setSearch] = useState('');

  return (
    <div className="container py-16">
      <p className="eyebrow text-ink/55">Design system</p>
      <h1 className="display display-section mt-3 text-ink">Everything on one page.</h1>
      <p className="prose-measure mt-4 text-[15px] leading-relaxed text-ink/70">
        The components below are the ones the screens use. If something is not on this page, it is
        probably styled inline, which is worth fixing.
      </p>

      <Section title="Type" id="type">
        <div className="space-y-5">
          <div>
            <p className="eyebrow text-ink/50">Display hero</p>
            <p className="display display-hero text-ink">Barlow Condensed</p>
          </div>
          <div>
            <p className="eyebrow text-ink/50">Display section</p>
            <p className="display display-section text-ink">The measured version</p>
          </div>
          <div>
            <p className="eyebrow text-ink/50">Display card</p>
            <p className="display-card text-ink">Card title</p>
          </div>
          <div>
            <p className="eyebrow text-ink/50">Mono label</p>
            <p className="mono text-[12px] text-ink">JetBrains Mono · 12px · tracking</p>
          </div>
          <div>
            <p className="eyebrow text-ink/50">Body</p>
            <p className="prose-measure text-[15px] leading-relaxed text-ink/75">
              Inter at 15px, capped at a 68-character measure so a line of text does not stretch the
              full width of a wide screen.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Colour" id="colour">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {SWATCHES.map((swatch) => (
            <div key={swatch.token}>
              <div
                className="flex h-20 items-end border border-ink p-2"
                style={{ backgroundColor: `var(${swatch.token})` }}
              >
                <span className="mono text-[10px]" style={{ color: swatch.on }}>
                  {swatch.token.replace('--color-', '')}
                </span>
              </div>
              <p className="mono mt-2 text-[11px] text-ink/60">{swatch.contrast}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons" id="buttons">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
          <Button variant="primary" busy>
            Working
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </div>
      </Section>

      <Section title="Chips" id="chips">
        <div className="flex flex-wrap items-center gap-3">
          {(
            [
              'hot',
              'neutral',
              'finding',
              'status-sent',
              'status-replied',
              'status-won',
              'status-lost',
              'severity-high',
              'severity-medium',
              'severity-low',
            ] as const
          ).map((variant) => (
            <Chip key={variant} variant={variant}>
              {variant}
            </Chip>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {[95, 70, 40, 20, null].map((score) => (
            <TierChip key={String(score)} score={score} />
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {(
            [
              'discovered',
              'audited',
              'drafted',
              'approved',
              'sent',
              'replied',
              'won',
              'lost',
              'skipped',
            ] as const
          ).map((status) => (
            <StatusChip key={status} status={status} />
          ))}
        </div>
        <p className="mono mt-5 text-[11px] text-ink/55">
          Tiers: hot at {tierForScore(80)}, otherwise normal.
        </p>
      </Section>

      <Section title="Inputs" id="inputs">
        <div className="grid max-w-xl gap-5">
          <label className="block">
            <span className="mono mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink/55">
              Plain input
            </span>
            <Input placeholder="Business name" />
          </label>
          <label className="block">
            <span className="mono mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink/55">
              With a value
            </span>
            <Input defaultValue="Sharma Plumbing" />
          </label>
          <SearchField
            value={search}
            onChange={setSearch}
            onSubmit={() => undefined}
            placeholder="Plumbers in Bhopal"
          />
          <SearchField
            value="plumbers"
            onChange={() => undefined}
            onSubmit={() => undefined}
            error={'Write it like "plumbers in Bhopal".'}
          />
        </div>
      </Section>

      <Section title="Cards" id="cards">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card className="p-5">
            <p className="display-card text-ink">Normal card</p>
            <p className="mt-2 text-[14px] text-ink/70">Dark hard shadow, 4px offset.</p>
          </Card>
          <Card tier="hot" className="p-5">
            <p className="display-card text-ink">Hot card</p>
            <p className="mt-2 text-[14px] text-ink/70">Coral shadow, for the top leads.</p>
          </Card>
          <DashedCtaCard>
            <span className="display-card block">Dashed button</span>
            <span className="mt-2 block text-[14px] text-ink/70">For an in-page action.</span>
          </DashedCtaCard>
          <DashedCtaLink href="#cards">
            <span className="display-card block">Dashed link</span>
            <span className="mt-2 block text-[14px] text-ink/70">For navigation.</span>
          </DashedCtaLink>
          <div className="flex">
            <ScoreBlock score={82} />
          </div>
          <ComparisonCard
            title="Measured"
            rows={[
              { label: 'Largest paint', value: '2,410 ms' },
              { label: 'Layout shift', value: '0.18' },
              { label: 'Blocking time', value: '320 ms' },
            ]}
          />
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <LeadCard lead={SAMPLE_LEAD} />
          <NewSearchCard />
        </div>
      </Section>

      <Section title="Comparison rows" id="rows">
        <Card className="max-w-lg p-0">
          <ComparisonRow label="Largest contentful paint" value="2,410 ms" />
          <ComparisonRow label="Cumulative layout shift" value="0.18" />
          <ComparisonRow label="Total blocking time" value="not measured" />
        </Card>
      </Section>

      <Section title="Tabs" id="tabs">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">Evidence</TabsTrigger>
            <TabsTrigger value="two">Draft</TabsTrigger>
            <TabsTrigger value="three">Contact log</TabsTrigger>
          </TabsList>
          <TabsContent value="one">
            <p className="text-[15px] text-ink/75">
              Arrow keys move between tabs, Home and End jump to the ends.
            </p>
          </TabsContent>
          <TabsContent value="two">
            <p className="text-[15px] text-ink/75">Only one panel is mounted at a time.</p>
          </TabsContent>
          <TabsContent value="three">
            <p className="text-[15px] text-ink/75">Panels are labelled by their trigger.</p>
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Accordion" id="accordion">
        <Accordion type="single" collapsible className="border-t border-ink/15">
          <AccordionItem value="a" question="What is the opportunity score?">
            A weighted sum of the audit findings, from 0 to 100. It measures how much room a site
            has to improve, not how bad the site is.
          </AccordionItem>
          <AccordionItem value="b" question="Why is my audit labelled stale?">
            Chrome was not available, so the timing metrics were never collected. The structural
            checks are real; the numbers are absent rather than zero.
          </AccordionItem>
          <AccordionItem value="c" question="Can this send an email?">
            No. There is no send path in the codebase. Drafts are copied to the clipboard and the
            message goes out from your own client.
          </AccordionItem>
        </Accordion>
      </Section>

      <Section title="Dialog" id="dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open the modal</Button>
          </DialogTrigger>
          <DialogContent
            title="Focus is trapped here"
            description="Escape closes it and focus returns to the trigger."
          >
            <p className="text-[15px] leading-relaxed text-ink/80">
              Radix supplies the focus trap, the Escape handler and the scroll lock. The backdrop
              darkens and the panel rises 8px, both disabled under reduced motion.
            </p>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Timeline" id="timeline">
        <div className="bg-bg p-8">
          <Timeline>
            <TimelineStep index={1} title="Find">
              Search one business type in one city and deduplicate against every domain already
              contacted.
            </TimelineStep>
            <TimelineStep index={2} title="Audit">
              Fetch each site once, behind an SSRF guard, and measure it with Lighthouse where
              Chrome is available.
            </TimelineStep>
            <TimelineStep index={3} title="Draft">
              Turn the findings into a message, validate every claim against them, and fall back to
              a template when the model invents anything.
            </TimelineStep>
            <TimelineStep index={4} title="You send it">
              Read the draft, edit it in your words, and send it from your own client.
            </TimelineStep>
          </Timeline>
        </div>
      </Section>

      <Section title="Pixel decorations" id="decorations">
        <div className="space-y-6">
          <div>
            <p className="mono mb-2 text-[11px] uppercase tracking-wider text-ink/55">
              MiniStrip · four colours
            </p>
            <MiniStrip />
          </div>
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <p className="mono mb-2 text-[11px] uppercase tracking-wider text-ink/55">
                PixelStairs
              </p>
              <PixelStairs steps={6} cell={20} />
            </div>
            <div>
              <p className="mono mb-2 text-[11px] uppercase tracking-wider text-ink/55">
                PixelBars
              </p>
              <PixelBars cell={24} />
            </div>
            <div>
              <p className="mono mb-2 text-[11px] uppercase tracking-wider text-ink/55">
                PixelSkyline
              </p>
              <PixelSkyline columns={9} cell={20} />
            </div>
            <div>
              <p className="mono mb-2 text-[11px] uppercase tracking-wider text-ink/55">
                RouteLoader
              </p>
              <RouteLoader size={40} />
            </div>
          </div>
          <p className="mono text-[11px] text-ink/55">
            Stairs: {buildStairs(4).length} points · Skyline heights:{' '}
            {buildSkyline(6, 1).join(', ')}
          </p>
        </div>
      </Section>

      <Section title="Pixel map" id="map">
        <PixelMap leads={SAMPLE_MAP_LEADS} onSelect={() => undefined} />
        <p className="mono mt-4 text-[12px] text-ink/60">
          Squares are real buttons with accessible names. Arrow keys move between them, and the
          spotlight only runs on a hover-capable pointer.
        </p>
      </Section>
    </div>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-16 scroll-mt-28 border-t border-ink/15 pt-10">
      <h2 className="display display-section text-ink">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** Swatches with their documented contrast pair, so a regression is visible. */
const SWATCHES = [
  { token: '--color-paper', on: 'var(--color-ink)', contrast: 'paper on ink 15.8:1' },
  { token: '--color-ink', on: 'var(--color-paper)', contrast: 'ink on paper 15.8:1' },
  { token: '--color-bg', on: 'var(--color-paper)', contrast: 'paper on teal 6.1:1' },
  { token: '--color-bg-deep', on: 'var(--color-paper)', contrast: 'paper on deep teal 7.4:1' },
  { token: '--color-band-dark', on: 'var(--color-paper)', contrast: 'paper on dark band 9.2:1' },
  { token: '--color-coral', on: 'var(--color-ink)', contrast: 'ink on coral 6.4:1' },
  { token: '--color-amber', on: 'var(--color-ink)', contrast: 'ink on amber 9.1:1' },
  { token: '--color-blue', on: 'var(--color-ink)', contrast: 'ink on blue 8.7:1' },
  { token: '--color-pink', on: 'var(--color-ink)', contrast: 'ink on pink 12.1:1' },
  { token: '--color-sage', on: 'var(--color-ink)', contrast: 'ink on sage 13.0:1' },
  { token: '--color-red', on: 'var(--color-paper)', contrast: 'paper on red 4.6:1' },
  {
    token: '--color-land',
    on: 'var(--color-paper)',
    contrast: 'paper on land 4.1:1, decorative only',
  },
] as const;

const SAMPLE_LEAD: LeadSummary = {
  id: 'sample',
  placeId: 'sample-place',
  domainKey: 'example.com',
  name: 'Sharma Plumbing Works',
  category: 'Plumber',
  address: 'Zone 1, MP Nagar, Bhopal',
  lat: 23.24,
  lng: 77.41,
  phone: '+91 98XX XXX XXX',
  phoneE164: '+919800000000',
  phoneIsMobile: true,
  websiteUrl: 'https://example.com',
  contactEmail: null,
  rating: 4.2,
  reviewCount: 37,
  status: 'drafted',
  notes: null,
  createdAt: new Date().toISOString(),
  opportunityScore: 82,
  auditStatus: 'ok',
  canWhatsApp: true,
  draftCount: 1,
};

const SAMPLE_MAP_LEADS = [
  {
    id: 'a',
    name: 'Sharma Plumbing',
    lat: 23.24,
    lng: 77.41,
    score: 82,
    auditStatus: 'ok' as const,
  },
  {
    id: 'b',
    name: 'Verma Electricals',
    lat: 23.26,
    lng: 77.42,
    score: 55,
    auditStatus: 'ok' as const,
  },
  { id: 'c', name: 'Gupta Interiors', lat: 23.28, lng: 77.44, score: null },
  {
    id: 'd',
    name: 'Patel Hardware',
    lat: 23.22,
    lng: 77.45,
    score: 30,
    auditStatus: 'ok' as const,
  },
  {
    id: 'e',
    name: 'Sunrise Tiles',
    lat: 23.27,
    lng: 77.39,
    score: null,
    auditStatus: 'unavailable' as const,
  },
  { id: 'f', name: 'Modern Dental', lat: 23.25, lng: 77.43, score: 91, auditStatus: 'ok' as const },
  { id: 'g', name: 'Khan Carpets', lat: 23.23, lng: 77.42, score: 66, auditStatus: 'ok' as const },
  { id: 'h', name: 'Grace Salon', lat: 23.26, lng: 77.4, score: 44, auditStatus: 'ok' as const },
];
