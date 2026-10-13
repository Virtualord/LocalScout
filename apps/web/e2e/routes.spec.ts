import { expect, test, type Page } from '@playwright/test';
import { attachScreenshot, checkA11y } from './a11y.js';

/**
 * Load a route with the app interactive.
 *
 * `goto` resolves on `load`, which against the dev server is before the bundle
 * has executed. Assertions on a heading pass on server-rendered markup, but a
 * click or a Tab press in that window hits nodes with no handlers attached.
 */
async function openApp(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
}

/**
 * Every route renders, is navigable, and passes axe.
 *
 * A loop rather than six near-identical test bodies: the per-route assertion
 * differs only in the heading, and writing it six times guarantees five of them
 * drift.
 */

interface Route {
  path: string;
  /** The `h1`, which is the one heading a screen must have exactly one of. */
  heading: string;
  /** A selector for something the screen renders in every state. */
  selector: string;
}

/**
 * One entry per route.
 *
 * `selector` must match something present whether or not the database has data,
 * because the suite shares one throwaway database: `flow.spec.ts` runs first
 * and leaves a run behind, so an assertion written against an empty state would
 * fail for a reason that has nothing to do with the route.
 */
const ROUTES: Route[] = [
  {
    path: '/',
    heading: 'Local sites, audited.',
    // The footer strip names the tools, and renders regardless of lead count.
    selector: 'text=Gemma and Ollama',
  },
  {
    path: '/leads',
    heading: 'Every lead,',
    // An aria-label on a group, so it is found by role rather than by text.
    selector: '[aria-label="Filter by status"]',
  },
  {
    path: '/dashboard',
    heading: 'Where the work',
    selector: 'text=Outreach milestones',
  },
  {
    path: '/runs',
    heading: 'Every run,',
    selector: 'text=What was searched, what it cost',
  },
  {
    path: '/settings',
    heading: 'What this machine',
    selector: 'text=Configuration',
  },
  {
    path: '/styleguide',
    heading: 'Everything on one page.',
    selector: 'text=Display hero',
  },
];

for (const route of ROUTES) {
  test.describe(route.path, () => {
    test('renders with one heading and passes axe', async ({ page }, testInfo) => {
      await openApp(page, route.path);

      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toHaveCount(1);
      await expect(heading).toContainText(route.heading);

      // Confirms the body actually rendered rather than only the shell, and
      // that the route did not fall through to another screen.
      await expect(page.locator(route.selector).first()).toBeVisible();

      await checkA11y(page, testInfo);
      await attachScreenshot(page, testInfo);
    });

    test('has no console errors', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(String(error)));

      await openApp(page, route.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await page.waitForTimeout(500);

      expect(errors, `console errors on ${route.path}`).toEqual([]);
      await attachScreenshot(page, testInfo);
    });
  });
}

test('unknown routes render the not-found screen', async ({ page }, testInfo) => {
  await openApp(page, '/does-not-exist');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await checkA11y(page, testInfo);
});
