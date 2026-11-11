# Design system — Local Business Exploration

The visual identity of Localscout. This document supersedes the earlier
reconstruction notes: the interface no longer samples colours, type or
proportions from any external visual reference. Everything below was developed
for this product and is recorded here so the system stays coherent as it grows.

## The direction

**Local Business Exploration.**

Localscout is a field instrument for a city: it finds businesses, measures their
websites, and hands a person one honest message at a time. The interface is
built to feel like a **surveyor's field atlas** — warm paper, deep petrol ink,
plotted coordinates, measured bars, a location pin in the margin — rather than a
generic SaaS dashboard or a re-skin of someone else's event page.

It should read as:

- **Exploratory** — maps, pins, plot marks, a city reduced to a grid.
- **Analytical** — mono readouts, ruled tables, measurable bars.
- **Editorial** — large two-tone headlines and colour-blocked bands.
- **Human** — every claim about automation stops where a person picks up.

The product never sends anything. The design says so in words, not only in
colour, and no illustration ever implies a send button exists.

## What was preserved

The **language** of the previous design was kept deliberately: band rhythm,
two-tone display headings, hard shadows, the press-in interaction, pixel-derived
decorations, mono labels, and an editorial rather than dashboard-like home page.
What changed is the **identity**: pigments, typeface, compositions, motifs and
component shapes.

## Colour

Colours are roles, not hex values sprinkled through components. The raw palette
lives at the top of `apps/web/src/design/tokens.css`; components reference the
role tokens beneath it.

### Palette

| Raw pigment    | Hex                   | Used as                                 |
| -------------- | --------------------- | --------------------------------------- |
| Petrol 950     | `#07211C`             | Darkest band, shadow pigment, footer    |
| Petrol 900     | `#0B2E27`             | Recessed surface behind the map         |
| Petrol 800     | `#113B34`             | Header and hero ground                  |
| Petrol 700/600 | `#1B4B42` / `#2A5F54` | Interactive darks and borders           |
| Cream 50       | `#FCF7EC`             | Primary paper surface                   |
| Cream 100/200  | `#F8F1E1` / `#F0E5CE` | Alternating paper bands                 |
| Cream 300      | `#E6D8BB`             | Raised paper tint                       |
| Ink 900        | `#161D19`             | Text, borders, hard shadows             |
| Coral 500      | `#E0836B`             | Display accent, hot leads, attention    |
| Coral 700      | `#6E2A1D`             | Coral's shadow pigment                  |
| Gold 500       | `#F2B33D`             | Primary action, focus, survey marks     |
| Violet 400     | `#8E8BEE`             | Secondary accent (interior-page titles) |
| Brick 600      | `#B8402C`             | Danger and destructive accents          |
| Peach 300      | `#F6CDB9`             | HOT chip, cold-lead map cell            |
| Sage 300       | `#D9E3C5`             | Neutral status chip, low severity       |

### Role tokens

```css
--color-bg            /* header and hero ground          */
--color-bg-deep       /* recessed dark surface           */
--color-band-dark     /* darkest band and shadow pigment */
--color-paper         /* primary light surface           */
--color-paper-band    /* first tint of paper             */
--color-paper-band-2  /* second tint of paper            */
--color-ink           /* text and structure              */
--color-coral         /* display accent / attention      */
--color-amber         /* primary action / focus / survey */
--color-blue          /* secondary accent                */
--color-red           /* danger                          */
--color-success       /* completed / grounded / OK       */
--color-sage / pink   /* quiet status families           */
```

### Contrast pairs

| Pair                 | Ratio  | Use                         |
| -------------------- | ------ | --------------------------- |
| cream on petrol 800  | 11.4:1 | Body text on dark bands     |
| cream on petrol 900  | 13.9:1 | Body text on the map band   |
| ink on cream         | 15.1:1 | Body text on paper          |
| ink on gold          | 9.2:1  | Primary button labels       |
| ink on coral         | 6.2:1  | Coral chips and buttons     |
| ink on sage          | 12.6:1 | Neutral chips               |
| gold on petrol 800   | 6.6:1  | Emphasis on dark bands      |
| brick on cream       | 5.2:1  | Danger words on paper       |
| paper on success     | 4.7:1  | Won / grounded / completed  |
| coral on petrol 800  | 4.5:1  | Display accents only, 48px+ |
| violet on petrol 800 | 4.2:1  | Display accents only, 48px+ |

Coral and violet text are restricted to display sizes. Small metadata is never
rendered below ~65% opacity, which is the point at which it clears 4.5:1 on both
paper and petrol.

Semantics are never colour-only. Every chip carries a word; the map square's
accessible name states the score; a dashed square means "could not be reached",
not "low score".

## Typography

| Role       | Face               | Weights | Treatment                                          |
| ---------- | ------------------ | ------- | -------------------------------------------------- |
| Display    | **Space Grotesk**  | 700     | Sentence case, `-0.035em` tracking, `0.94` leading |
| Card title | Space Grotesk      | 500     | `-0.02em` tracking                                 |
| Body       | **Inter**          | 400–600 | Relaxed leading, `65ch` measure                    |
| Technical  | **JetBrains Mono** | 400–700 | Uppercase labels, nav, chips, numbers, readouts    |

All three are self-hosted through `@fontsource`, so the app keeps its no-network
promise. Display type is sentence-cased now rather than condensed uppercase: the
character comes from the geometric letterforms and the two-tone block rhythm,
not from shouting. Two-tone headings place the first line in paper/ink and the
second in coral (dark bands) or gold (interior titles), with the accent line as
a separate block rather than an inline colour change.

## Decoration

Original motifs, all deterministic and free of image assets:

- **Neighbourhood grid** — an abstract street plan: outlined lots, a few filled
  in gold/coral/violet, through-streets left empty. Seeded, so it redraws
  identically. Used inside the field-note plates and the footer.
- **Location pin** — a square survey head over a two-cell stem, drawn as inline
  SVG. Used on the wordmark, section labels, plates and the map caption.
- **Measure scale** — three vertical bars of different heights, the shape of a
  Lighthouse report before the numbers are drawn.
- **Plot stamp** — the 2x2 mark above interior headlines and the favicon: four
  survey cells, one per pigment.
- **Survey rule** — a ruler of ticks where two colour bands meet.
- **Compass mark** — a crosshair and diagonal, quietly behind hero headings.
- **City blocks** — paired gold/coral columns that re-seed on a timer, frozen
  under reduced motion.
- **Pixel stairs** — a plotted route of alternating survey cells.

The old four-in-a-row colour strip, staircase and skyline rhythms survive as
geometries but are re-pigmented and re-composed into this vocabulary.

## Layout

- **Hero**: an asymmetric two-column composition. The promise and the search sit
  on the left; a tilted "field note" plate on the right diagrams the workflow
  (Discover → Measure → Draft). It is a diagram, never a fabricated audit.
- **Interior heroes**: the same split, with a survey plate and a neighbourhood
  plan bleeding off the right edge, closed by a tick rule.
- **Bands**: alternating paper/paper-tint/petrol/dark surfaces separated by tick
  rulers. The home page adds four explanatory bands — how it works, what it is,
  what the score means, and built-with — plus a FAQ.
- **Plates**: cards and plates use 2px ink borders, a 5px down-right hard shadow,
  and the press-in interaction. Nothing is rounded.
- **Dashboard**: readings strip first (counted numbers), then milestones,
  pipeline tables, provenance and definitions. Editorial headings, but every
  number stays in a mono readout with its denominator stated.
- **Audit**: findings carry a severity-coloured left rail; 0–100 scores get a
  gauge as well as a number; absent measurements draw no bar and say
  "not measured".
- **Outreach**: the draft tab is a writing surface — coral-spined copy blocks on
  paper with a tooled header, and the "read it, edit it, send it yourself"
  note in place.
- **Footer**: dark, closing the page the way the header opens it.

## Components

- **Buttons**: three tiers. Primary is gold with an ink border and ink hard
  shadow; secondary is paper with an ink shadow; ghost is an ink outline. All
  press into their shadow rather than lifting.
- **Cards**: paper face, 2px ink border, coloured hard shadow. HOT leads use the
  coral shadow; everything else uses the dark petrol shadow.
- **Chips**: mono, uppercase, bordered printed labels. Status is always spelled
  out. Success uses the success pigment.
- **Inputs**: paper faces, ink borders, and a focus ring on the joined field
  (gold outer ring, ink inner ring), never on the inner input.
- **Dialog**: paper panel with a gold top rail and a hard shadow; the panel rises
  8px while the curtain fades to petrol.
- **Navigation**: petrol header with a gold survey rule along its top edge; mono
  links, gold active underline, paper dropdown panel.

## Motion

| Effect                  | Timing                | Notes                               |
| ----------------------- | --------------------- | ----------------------------------- |
| Button press            | 120ms                 | Translate 2px hover, 5px active     |
| Card press-in           | 120ms                 | Translate 5px, shadow to zero       |
| Plate settle            | 420ms                 | 10px rise and fade on first paint   |
| Pin drop                | 480ms                 | Used on the map and plates          |
| Dialog backdrop / panel | 160ms                 | Backdrop fade, 8px panel rise       |
| Route loader            | 1000ms, 100ms stagger | Four survey cells bobbing           |
| City-block re-seed      | 1200ms                | Stepped change; frozen when reduced |
| Map spotlight           | lerp 0.25, 300ms fade | Pointer-only, disabled on touch     |
| Accordion               | 200ms                 | `grid-template-rows` 0fr → 1fr      |

`prefers-reduced-motion` disables the spotlight easing, the skyline re-seed,
the loader wave, the drop-in and recolor flashes, the plate settle and the pin
drop. State changes still happen, instantly.

## Accessibility

- Focus is a 3px gold outline with a 2px offset; fields add an ink inner ring, so
  focus is visible on both paper and petrol.
- The modal traps focus, closes on Escape and restores focus to the map square
  that opened it.
- The map is a roving-tabindex grid of real `<button>` elements whose accessible
  names carry the business name, score and unreachable state.
- Score is always a number as well as a colour; a missing score is words, not a
  dash.
- Run progress and search status are `aria-live="polite"` regions.
- Decorative SVG and canvas layers are `aria-hidden`.
- Small text stays at or above the contrast threshold at its rendered size;
  display-only accents are noted above.

## What this is not

- Not a reproduction of any external event site, screenshot, logo, artwork or
  composition.
- Not a generic SaaS dashboard: the editorial bands, printed plates, oversized
  two-tone headings and survey motifs are load-bearing.
- Not a claim of measurement. Illustrations are diagrams; every number in the
  application comes from the API and every absent number says so.
