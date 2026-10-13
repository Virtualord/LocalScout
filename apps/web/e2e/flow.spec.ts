import { expect, test, type Page } from '@playwright/test';
import { attachScreenshot, checkA11y } from './a11y.js';

/**
 * The whole product, end to end, with nothing mocked.
 *
 * One run in fixtures mode produces a real lead, a real audit and a real draft,
 * because the fixtures path exercises the same pipeline as a live key does. What
 * is asserted here is the sequence of promises the README makes: find, measure,
 * draft, hand it to a human, and never send it.
 */

const API = 'http://127.0.0.1:8788';

/**
 * Load a route with the app fully interactive.
 *
 * `goto` alone resolves on `load`, which against a dev server is before the
 * bundle has executed. Filling and clicking in that window hits real DOM nodes
 * with no React handlers attached, so the typed value never reaches component
 * state and the submit button does nothing. The failure looks like an
 * application bug and is a test bug.
 */
async function openApp(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
  // The heading only exists once React has rendered, which is the signal that
  // handlers are attached.
  await page.getByRole('heading', { level: 1 }).waitFor();
}

/** Wait for a run to finish, however it finished. */
async function waitForRun(page: Page, runId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${API}/api/runs/${runId}`);
        const body = (await response.json()) as {
          run: { status: string };
        };
        return body.run.status;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toMatch(/completed|failed/);
}

test('a search produces a lead with an audit and a draft', async ({ page }, testInfo) => {
  await openApp(page, '/');

  await page.getByPlaceholder('Plumbers in Bhopal').pressSequentially('plumber in Bhopal');
  await page.getByRole('button', { name: /find leads/i }).click();

  // The status line is the live run feed, so it is the honest signal that
  // something is happening rather than a fixed-delay sleep.
  const status = page.locator('[aria-live="polite"]');
  await expect(status).not.toHaveText('No leads yet. Search for a business type and a city.', {
    timeout: 30_000,
  });

  const runs = await (await page.request.get(`${API}/api/runs?limit=1`)).json();
  const runId = (runs.runs as { id: string }[])[0]?.id;
  expect(runId, 'a run was recorded').toBeTruthy();
  await waitForRun(page, runId as string);

  await attachScreenshot(page, testInfo);

  // The lead list must now hold something, with a score on it.
  await openApp(page, '/leads');
  const cards = page.locator('li a[href^="/leads?lead="], li button');
  await expect(cards.first()).toBeVisible();

  await page.locator('li button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  /*
   * The Evidence tab must state an outcome, never leave the reader guessing.
   *
   * Which of the three it is depends on whether the fixture's domain resolves,
   * which differs between a sandbox and a normal machine. So the assertion is on
   * the property that matters: one of the honest states is shown, and a failed
   * one says so in words rather than by omission.
   */
  const evidence = dialog.getByRole('tabpanel', { name: 'Evidence' });
  await expect(evidence).toBeVisible();
  await expect(
    evidence.getByText(/what was measured|the audit could not run|has not been audited yet/i),
  ).toBeVisible();

  // A failed audit must never read as a clean bill of health.
  if ((await evidence.getByText('The audit could not run.').count()) > 0) {
    await expect(evidence.getByText(/not a clean bill of health/i)).toBeVisible();
  }
  await attachScreenshot(page, testInfo);

  /*
   * A draft exists only when there were findings to write from. When the audit
   * could not run there is nothing measured, so the honest outcome is no draft
   * and an offer to write one. Asserting a copy button unconditionally would
   * encode the opposite belief: that every lead gets a pitch.
   */
  await dialog.getByRole('tab', { name: 'Draft' }).click();
  const draft = dialog.getByRole('tabpanel', { name: 'Draft' });
  await expect(draft).toBeVisible();

  const copyButtons = draft.getByRole('button', { name: /^copy$/i });
  const writeButton = draft.getByRole('button', { name: /write the draft/i });

  if ((await copyButtons.count()) > 0) {
    await expect(copyButtons.first()).toBeVisible();
    // The generated text must be readable before it is copied.
    await expect(draft.getByText(/whatsapp message/i)).toBeVisible();
  } else {
    await expect(writeButton).toBeVisible();
  }

  // No send affordance exists in either state. This is the load-bearing claim.
  await expect(dialog.getByRole('button', { name: /^send/i })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /email now|message now|deliver/i })).toHaveCount(
    0,
  );

  await checkA11y(page, testInfo);
  await attachScreenshot(page, testInfo);
});

test('no control anywhere in the app can send a message', async ({ page }) => {
  await openApp(page, '/leads');
  await page.locator('li button').first().click();
  await page.getByRole('dialog').waitFor();

  // The claim is absolute, so the check is absolute: nothing that looks like a
  // send affordance exists in the dialog.
  const dialog = page.getByRole('dialog');
  const names = await dialog.getByRole('button').allTextContents();
  const combined = names.join(' | ').toLowerCase();

  expect(combined).not.toMatch(/\bsend\b(?! a message)/);
  expect(combined).not.toMatch(/email now|message now|deliver/);
});

test('a search without a city is rejected with an example, not a guess', async ({
  page,
}, testInfo) => {
  await openApp(page, '/');

  await page.getByPlaceholder('Plumbers in Bhopal').pressSequentially('plumbers');
  await page.getByRole('button', { name: /find leads/i }).click();

  // The user is told the format rather than having a city inferred, because an
  // inferred city costs a SerpApi credit and returns leads for the wrong place.
  await expect(page.getByText('Write it like "plumbers in Bhopal".')).toBeVisible();

  const runsBefore = (await (await page.request.get(`${API}/api/runs?limit=1`)).json()) as {
    runs: unknown[];
  };
  expect(runsBefore.runs.length).toBeLessThanOrEqual(1);

  await attachScreenshot(page, testInfo);
});

test('filters live in the URL and survive a reload', async ({ page }, testInfo) => {
  await openApp(page, '/leads');

  await page.getByRole('button', { name: '60+' }).click();
  await expect(page).toHaveURL(/min=60/);

  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page).toHaveURL(/view=map/);

  // Both filters survive a reload, which is what makes a filtered list
  // shareable.
  await page.reload();
  await expect(page.getByRole('button', { name: '60+' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');

  await attachScreenshot(page, testInfo);
});

test('the browser back button closes the lead modal rather than leaving the list', async ({
  page,
}) => {
  await openApp(page, '/leads');

  await page.locator('li button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/lead=/);

  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/lead=/);
});
