# Design reference

How this interface was reconstructed, and how much of each decision is
evidence rather than inference.

## Sources

- A screenshot of the home hero. Colours were sampled from it directly.
- An 82-second 1920×1080 screen recording covering the home page, the "Find a
  Fest" flow and its event modal, a signed-in dashboard, and the Host page.

Neither the recording nor any frames from it are committed. They show a desktop,
browser tabs, and an account email address, so they live in the git-ignored `ref/`
folder if you want to compare side by side.

## Fidelity and colour

Video compression shifts colour by roughly 3 units per channel. **Where the
screenshot and the video disagree, the screenshot wins.** It is the original
pixels; the video is a lossy encoding of them.

This interface is not a copy. No reference brand name, logo, copy, flag, photo,
or icon appears here. The wordmark, the copy, and the marks are original. What is
reproduced is the _language_: the band rhythm, the two-tone display headings, the
hard shadow, the press-in interaction, and the pixel decorations.

Timings are estimates from sampling the recording at 10–30 fps, so anything
described as inferred is a starting point to tune by eye, not a measurement.

## Observed versus inferred

**Observed** means seen in the recording. **Inferred** means extrapolated from
what was seen, or derived from the design's own logic.

### Colour

| Token                  | Value     | Basis                        |
| ---------------------- | --------- | ---------------------------- |
| `--color-bg`           | `#3D5F58` | Observed (screenshot sample) |
| `--color-bg-deep`      | `#324F49` | Observed (dropdown panel)    |
| `--color-band-dark`    | `#2D4641` | Observed (darkest band)      |
| `--color-paper`        | `#F7F7F2` | Observed                     |
| `--color-paper-band`   | `#F1F1EC` | Observed                     |
| `--color-paper-band-2` | `#E6E3DC` | Observed                     |
| `--color-ink`          | `#10201D` | Observed                     |
| `--color-coral`        | `#E97B77` | Observed                     |
| `--color-coral-shadow` | `#671912` | Observed                     |
| `--color-red`          | `#E53927` | Observed                     |
| `--color-pink`         | `#F6C4C1` | Observed (HOT chip)          |
| `--color-amber`        | `#F5B726` | Observed                     |
| `--color-blue`         | `#8DAFDE` | Observed                     |
| `--color-sage`         | `#DCE8CE` | Observed                     |

Map colours (`--color-land`, `--color-land-dim`, `--color-land-peak`) are
**Inferred**: the map was on screen but its cells are small and low-contrast in
the recording, so they are tuned by eye against the band colours.

### Type

| Choice                                | Basis                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Barlow Condensed 800 for display      | **Inferred**. No font was identifiable from the pixels. Condensed, heavy, tight-tracked is what the recording shows. |
| JetBrains Mono for labels, nav, chips | **Inferred**. Monospaced small caps throughout.                                                                      |
| Inter for body                        | **Inferred**.                                                                                                        |
| Self-hosted via `@fontsource`         | **Inferred**, from the offline requirement. A CDN font would break the no-network promise.                           |

Because the fonts are inferred, line breaks and measures differ from the
reference. The _hierarchy_ is what was reproduced.

### Motion

| Effect                                                   | Timing                         | Basis                                                                   |
| -------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| Card press-in (translate 4px, shadow to 0, opacity 0.92) | 120 ms                         | **Observed** (the state), **Inferred** (the duration)                   |
| Map spotlight follow                                     | lerp 0.25/frame                | **Inferred**                                                            |
| Map spotlight fade-out                                   | 300 ms                         | **Inferred**                                                            |
| Map tooltip follow                                       | 120 ms                         | **Inferred**                                                            |
| Nav dropdown                                             | 120 ms                         | **Observed** (opens on hover), **Inferred** (duration)                  |
| Modal backdrop + panel                                   | 160 ms                         | **Observed** (backdrop scrim, 8px rise), **Inferred** (duration)        |
| Route loader bob                                         | 1000 ms period, 100 ms stagger | **Observed** (the wave), **Inferred** (the numbers)                     |
| Pixel skyline re-seed                                    | 1200 ms, `steps(1)`            | **Observed** (heights change between frames), **Inferred** (interval)   |
| Accordion                                                | 200 ms `grid-template-rows`    | **Inferred**                                                            |
| Lead drop-in, audit recolor, count-up                    | 220–600 ms                     | **Inferred**. Event-driven; these have no counterpart in the recording. |

### Deliberately absent

Scroll reveals, parallax, looping ambient motion, and hover lifts on
non-clickable elements are all **not** in the reference and are not here. Sections
render in place.

`prefers-reduced-motion` disables the spotlight easing, the skyline re-seed, the
loader bobbing, the drop-in, the recolor flash, and the count-up. State changes
still happen, instantly.

### Fonts could not be identified

This is the largest gap between this build and the reference. The type choices are
the closest free matches to what the pixels show, not the actual fonts.

## What to check by eye

These are the places where a side-by-side comparison against `ref/` will show the
biggest difference, in rough order of how much they matter:

1. Type. Different fonts, so different widths and different line breaks.
2. Band vertical rhythm. Padding is set to 96–120 px; the recording suggests a
   similar range but the exact stops are inferred.
3. Hero fold. The first viewport is meant to hold header, hero, map, and the
   paper footer strip. Whether the map height lands exactly at the fold depends
   on the viewport.
4. Map cell density. 64×28 desktop is inferred; the recording's map looks denser.
5. Header nav item spacing.

## Accessibility decisions

Not visible in the recording, because a recording cannot show them:

- Focus is a 3px outline, 2px offset, ink on paper and paper on teal.
- The modal traps focus and closes on Escape (Radix behaviour).
- The map is a roving-tabindex grid of real `<button>`s with `aria-label`s
  carrying the business name and score.
- Score is always shown as a number as well as a colour.
- Run progress is an `aria-live="polite"` region.

## Personal data

The recording contains a desktop, browser tabs, and an account email address.
None of that is in this repository. `ref/` is git-ignored so it can be dropped in
locally for comparison and will not be committed by accident.
