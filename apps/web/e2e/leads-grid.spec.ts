import { expect, test, type Page } from '@playwright/test';
import { attachScreenshot } from './a11y.js';

/**
 * The leads grid.
 *
 * Cards in one grid are read as a set, so they have to be the same size. They
 * were not, for four separate reasons that a glance at the markup would not
 * catch: chips whose height depended on whether their variant happened to carry a
 * border, an address line free to wrap, a finding line present on some cards and
 * absent on others, and a call-to-action card 60px shorter than the rest.
 *
 * Grid rows are independent, so none of those differences averaged out. Measured
 * before the fix, in a single 12-lead grid: rows of 166px, 148px and 164px.
 */

const API = 'http://127.0.0.1:8788';

/**
 * A run wide enough to contain leads of every shape.
 *
 * Twelve is the whole Bhopal fixture set, which between them has an address long
 * enough to wrap, leads with a website and no email, leads with no website at
 * all, and one with nothing to report — which is the spread the bug lived in.
 */
async function seedEveryShapeOfLead(page: Page): Promise<void> {
  const started = await page.request.post(`${API}/api/runs`, {
    data: { query: 'businesses', location: 'Bhopal', limit: 12, language: 'en' },
  });
  const body = (await started.json()) as { runId: string };
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${API}/api/runs/${body.runId}`);
        const result = (await response.json()) as { run: { status: string } };
        return result.run.status;
      },
      { timeout: 180_000, intervals: [500, 1000, 2000] },
    )
    .toMatch(/completed|failed/);

  await page.goto('/leads', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1 }).waitFor();

  /*
   * Give the leads different statuses, because that is what changes the chip
   * variant. A fresh run leaves every lead as "Draft ready", so all twelve cards
   * carry the same chip and a bug that only shows when two variants sit side by
   * side would go unnoticed. "Won" paints a chip with no border and "Draft ready"
   * with one.
   */
  const leads = await page.evaluate(async () => {
    const response = await fetch('/api/leads?limit=50');
    const body = (await response.json()) as { leads: { id: string }[] };
    return body.leads.map((lead) => lead.id);
  });

  for (const [index, id] of leads.entries()) {
    const status = index % 3 === 0 ? 'won' : index % 3 === 1 ? 'drafted' : 'audited';
    const patched = await page.request.patch(`${API}/api/leads/${id}`, { data: { status } });
    expect(patched.ok(), `could not set ${id} to ${status}`).toBe(true);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1 }).waitFor();
}

test('every card in the leads grid is the same height', async ({ page }, testInfo) => {
  await seedEveryShapeOfLead(page);
  await page.waitForTimeout(500);

  /*
   * Measured on the grid item rather than the card inside it. The `li` is what the
   * grid sizes and lines up, and it is the same element for a lead card and for
   * the dashed call-to-action, which are different elements underneath.
   */
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('ul li')].map((item) => {
      const box = item.getBoundingClientRect();
      return {
        name: (item.querySelector('h3')?.textContent ?? '(cta)').trim().slice(0, 24),
        height: Math.round(box.height),
        width: Math.round(box.width),
      };
    }),
  );

  expect(cards.length).toBeGreaterThan(6);

  const heights = [...new Set(cards.map((card) => card.height))];
  expect(
    heights,
    `cards are ${heights.length} different heights: ${JSON.stringify(cards)}`,
  ).toHaveLength(1);

  // Widths too: the call-to-action card used to be a different footprint as well.
  expect([...new Set(cards.map((card) => card.width))]).toHaveLength(1);

  await page.locator('ul li').first().scrollIntoViewIfNeeded();
  await attachScreenshot(page, testInfo);
});

test('the chips on a card are all the same height', async ({ page }) => {
  await seedEveryShapeOfLead(page);
  await page.waitForTimeout(500);

  /*
   * A chip whose variant carries a border used to be 2px taller than one that did
   * not, because the border came from the variant rather than the base. One lead's
   * chip row was 25px and the next lead's was 23px.
   *
   * The statuses are seeded to a mix first, because with twelve identical chips
   * this cannot fail and would therefore prove nothing. Asserted below, so a
   * seeding that quietly stops working fails here rather than making the test
   * vacuous.
   */
  const chips = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('ul li')].map((item) => {
      const row = item.querySelector('div.flex.flex-wrap');
      if (row === null) return null;
      return {
        height: Math.round(row.getBoundingClientRect().height),
        labels: [...row.children].map((chip) => (chip.textContent ?? '').trim()).join(','),
      };
    });
    return rows.filter((row): row is { height: number; labels: string } => row !== null);
  });

  expect(chips.length).toBeGreaterThan(6);
  expect(
    new Set(chips.map((chip) => chip.labels)).size,
    `the leads all show the same chips, so this test cannot fail: ${JSON.stringify(
      chips.map((c) => c.labels),
    )}`,
  ).toBeGreaterThan(1);

  expect([...new Set(chips.map((chip) => chip.height))]).toHaveLength(1);
});

test('a card says the same thing at the same height on every card', async ({ page }) => {
  await seedEveryShapeOfLead(page);
  await page.waitForTimeout(500);

  /*
   * Uniform boxes are the easy half. The lines inside them have to land on common
   * baselines too, or the cards match in size and still look untidy: the title,
   * the address and the finding each sit at their own y depending on what the
   * lead happens to know.
   */
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('ul li')]
      .map((item) => {
        // The dashed call-to-action has no title, so it has no baselines to
        // compare and is not part of this claim.
        const title = item.querySelector('h3');
        if (title === null) return null;
        const top = item.getBoundingClientRect().top;
        const at = (selector: string): number | null => {
          const node = item.querySelector(selector);
          return node === null ? null : Math.round(node.getBoundingClientRect().top - top);
        };
        return {
          name: Math.round(title.getBoundingClientRect().top - top),
          category: at('p.mono'),
          /*
           * The line's own height, not just where it starts. A long address
           * wrapping to a second line leaves the line where it was and makes the
           * card taller, which is exactly what truncation prevents — so this is
           * the assertion that catches it.
           */
          categoryHeight: (() => {
            const node = item.querySelector('p.mono');
            return node === null ? null : Math.round(node.getBoundingClientRect().height);
          })(),
        };
      })
      .filter(
        (
          row,
        ): row is {
          name: number;
          category: number | null;
          categoryHeight: number | null;
        } => row !== null,
      ),
  );

  expect(rows.length).toBeGreaterThan(6);

  // The title's offset from the card top depends only on the chip row above it.
  expect([...new Set(rows.map((r) => r.name))]).toHaveLength(1);

  // And the category line depends only on the title above it.
  expect([...new Set(rows.map((r) => r.category))]).toHaveLength(1);

  // One line each, whatever the address says. This is the one that catches a
  // wrapping address, which no amount of measuring a card's top edge would.
  expect([...new Set(rows.map((r) => r.categoryHeight))]).toHaveLength(1);
});
