import { expect, test, type Page } from '@playwright/test';
import { attachScreenshot } from './a11y.js';

/**
 * The lead modal.
 *
 * Every claim here is a computed style or a bounding box, because both bugs this
 * file guards were invisible to jsdom: one lived in the cascade (a keyframe
 * animating a property the positioning did not use) and one in the resolved
 * colours. A unit test on the class names would have passed with both still
 * broken.
 */

const API = 'http://127.0.0.1:8788';

async function openApp(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1 }).waitFor();
}

/** Seed one lead, so there is a card to open. */
async function seedLead(page: Page): Promise<void> {
  const started = await page.request.post(`${API}/api/runs`, {
    data: { query: 'plumber', location: 'Bhopal', limit: 2, language: 'en' },
  });
  const body = (await started.json()) as { runId: string };
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${API}/api/runs/${body.runId}`);
        const result = (await response.json()) as { run: { status: string } };
        return result.run.status;
      },
      { timeout: 120_000, intervals: [500, 1000, 2000] },
    )
    .toMatch(/completed|failed/);
}

/** Open the modal with its entry animation frozen at frame zero. */
async function openModalAtFirstFrame(page: Page): Promise<void> {
  await openApp(page, '/leads');
  const card = page.locator('li button').first();
  await expect(card).toBeVisible();

  // Paused rather than shortened: the point is to measure frame zero, and a
  // negative delay would land somewhere in the middle of the animation.
  await page.addStyleTag({
    content: '.dialog-panel { animation-play-state: paused !important; }',
  });
  await card.click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('the modal starts centred rather than sliding in from the left', async ({ page }) => {
  await seedLead(page);
  await openModalAtFirstFrame(page);

  const first = await page.evaluate(() => {
    const panel = document.querySelector('.dialog-panel');
    if (panel === null) throw new Error('no panel');
    const style = getComputedStyle(panel);
    const box = panel.getBoundingClientRect();
    return {
      translate: style.translate,
      boxX: box.x,
      boxWidth: box.width,
      viewportWidth: window.innerWidth,
    };
  });

  // The panel is centred with `translate`, which is the property Tailwind v4
  // emits for `-translate-x-1/2`. The keyframe animated `transform` instead,
  // which did not replace the centring but added a second -50% to it, so frame
  // zero sat at x = -280 and the modal flew in from off the left edge.
  expect(first.boxX).toBeGreaterThanOrEqual(0);
  expect(first.boxX).toBeCloseTo((first.viewportWidth - first.boxWidth) / 2, 0);

  // And the centring is still the `translate` property, not a transform.
  expect(first.translate).not.toBe('none');
});

test('every action in the modal footer is readable and reachable', async ({ page }, testInfo) => {
  await seedLead(page);
  await openApp(page, '/leads');
  await page.locator('li button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const footer = await page.evaluate(() => {
    const element = document.querySelector('.dialog-panel footer');
    if (element === null) throw new Error('no footer');
    return [...element.children].map((child) => {
      const style = getComputedStyle(child);
      const box = child.getBoundingClientRect();
      return {
        text: (child.textContent ?? '').trim(),
        color: style.color,
        background: style.backgroundColor,
        box,
        viewportHeight: window.innerHeight,
      };
    });
  });

  expect(footer.length).toBeGreaterThanOrEqual(4);

  for (const button of footer) {
    /*
     * The ghost buttons were white text on the cream panel — `color: var(--color-paper)`
     * was written for a dark band and the only two buttons using it were here.
     * They were in the DOM and in the tab order, and could not be read.
     */
    expect(button.color, `"${button.text}" has no contrast on paper`).not.toBe(
      'rgb(247, 247, 242)',
    );

    /*
     * And inside the viewport without scrolling. The panel was one scrolling box,
     * so on a phone the actions for dismissing a lead were below the fold.
     */
    expect(button.box.bottom, `"${button.text}" is below the fold`).toBeLessThanOrEqual(
      button.viewportHeight,
    );
  }

  await attachScreenshot(page, testInfo);
});
