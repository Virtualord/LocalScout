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
 * Keyboard and accessibility behaviour that axe cannot check.
 *
 * axe verifies the static ARIA contract. It cannot press a key. Everything
 * below is a claim the project makes that only a real keyboard run can confirm.
 */

test('the skip link is the first tab stop and moves focus to the content', async ({ page }) => {
  await openApp(page, '/');

  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();

  await page.keyboard.press('Enter');
  // The link targets #main, which is focusable via tabIndex -1. Without that,
  // following the link scrolls but leaves focus on the link itself.
  await expect(page.locator('#main')).toBeFocused();
});

test('every map square is reachable and labelled by keyboard', async ({ page }) => {
  await openApp(page, '/');

  const squares = page.locator('[data-map-lead]');
  const count = await squares.count();
  test.skip(count === 0, 'no leads yet, nothing to navigate');

  const first = squares.first();
  await first.focus();

  // The accessible name carries the business name, which is the only thing a
  // screen reader user has to go on for a square of pixels.
  const name = await first.getAttribute('aria-label');
  expect(name).toBeTruthy();
  expect(name).not.toMatch(/^[\s\d]+$/);
});

test('arrow keys move between map squares', async ({ page }, testInfo) => {
  await openApp(page, '/');

  const squares = page.locator('[data-map-lead]');
  test.skip((await squares.count()) < 2, 'needs at least two leads to move between');

  await squares.first().focus();
  const before = await page.evaluate(() => document.activeElement?.getAttribute('data-map-lead'));

  // Try all four directions; with two or more squares one of them always has a
  // neighbour, and which one depends on the layout.
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.press(key);
    const moved = await page.evaluate(() => document.activeElement?.getAttribute('data-map-lead'));
    if (moved !== before) {
      await expect(page.locator(`[data-map-lead="${moved}"]`)).toBeFocused();
      await attachScreenshot(page, testInfo);
      return;
    }
  }

  throw new Error('no arrow key moved focus between map squares');
});

test('the lead modal traps focus and returns it on Escape', async ({ page }, testInfo) => {
  await openApp(page, '/leads');

  const openCard = page.locator('li button').first();
  test.skip((await openCard.count()) === 0, 'no leads to open');

  await openCard.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await checkA11y(page, testInfo);

  // Tab from the last control must wrap inside the dialog, never onto the page
  // behind it.
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const active = document.activeElement;
      const panel = document.querySelector('[role="dialog"]');
      return panel !== null && active !== null && panel.contains(active);
    });
    expect(inside, `tab ${i + 1} escaped the dialog`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the tabs move with the arrow keys', async ({ page }) => {
  await openApp(page, '/styleguide');

  const tabs = page.getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  await tabs.first().focus();

  await page.keyboard.press('ArrowRight');
  const second = tabs.nth(1);
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-selected', 'true');
});

test('every image and canvas is either labelled or hidden', async ({ page }) => {
  await openApp(page, '/');

  const unlabelled = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('img, canvas, svg'));
    return nodes
      .filter((node) => {
        if (node.getAttribute('aria-hidden') === 'true') return false;
        if (node.getAttribute('role') === 'presentation') return false;
        const labelled =
          node.getAttribute('aria-label') !== null ||
          node.getAttribute('title') !== null ||
          node.getAttribute('aria-labelledby') !== null;
        return !labelled;
      })
      .map((node) => `${node.tagName.toLowerCase()}.${node.className}`);
  });

  expect(unlabelled, 'graphics without a label or aria-hidden').toEqual([]);
});
