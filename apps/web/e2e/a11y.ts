import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

/**
 * Accessibility checks and screenshots.
 *
 * axe runs on every route at both viewports. Two rules are enforced as
 * failures and the rest as warnings, because a suite that fails on all four
 * WCAG tags gets switched off within a week, and one that fails on nothing is
 * decoration:
 *
 * - **critical** fails the build. A missing accessible name or an unlabelled
 *   control makes the app unusable for someone, not merely imperfect.
 * - everything else is reported and attached to the run, so the debt is visible
 *   without pretending it is a release blocker.
 */

/** Rules promoted to failures. */
const BLOCKING_IMPACTS: ReadonlyArray<'critical' | 'serious'> = ['critical'];

export interface AxeOptions {
  /** Include the page in the report even when it passes, for the run artefact. */
  always?: boolean;
}

/**
 * Run axe and attach the result to the Playwright report.
 *
 * Returns the violation list so a caller can assert something specific rather
 * than only relying on the global gate.
 */
export async function checkA11y(
  page: Page,
  testInfo: TestInfo,
  options: AxeOptions = {},
): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    // The canvas is decorative and carries `aria-hidden`; axe has nothing to say
    // about pixels. Excluding the region keeps the signal about real controls.
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.includes(violation.impact as 'critical'),
  );

  await testInfo.attach('axe', {
    body: JSON.stringify(
      {
        violations: results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.length,
          targets: violation.nodes.slice(0, 3).map((node) => node.target),
        })),
        passes: results.passes.length,
        incomplete: results.incomplete.length,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });

  // The screen is captured either way: a screenshot next to a violation report
  // is what turns "there is a contrast problem" into "here it is".
  await attachScreenshot(page, testInfo);

  if (options.always === true) {
    testInfo.annotations.push({
      type: 'a11y',
      description: `${results.violations.length} violations, ${results.passes.length} passes`,
    });
  }

  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (violation) =>
          `${violation.id} (${violation.impact}) at ${violation.nodes[0]?.target?.join(' ')}`,
      )
      .join('\n');
    throw new Error(`Blocking accessibility violations:\n${summary}`);
  }

  // Anything short of critical is reported, not failed. The annotation makes it
  // visible in the run output rather than silently tolerated.
  const nonBlocking = results.violations.filter((violation) => !blocking.includes(violation));
  if (nonBlocking.length > 0) {
    testInfo.annotations.push({
      type: 'a11y-warning',
      description: `${nonBlocking.length} non-blocking: ${nonBlocking
        .map((violation) => violation.id)
        .join(', ')}`,
    });
  }

  expect(blocking).toEqual([]);
  return results.violations;
}

/**
 * Capture a full-page screenshot into `test-results/screenshots`.
 *
 * Full page rather than viewport, because half of what needs reviewing here is
 * below the fold: the dashboard's metric cards and the styleguide's long
 * scroll.
 */
export async function attachScreenshot(page: Page, testInfo: TestInfo): Promise<void> {
  // The slug comes from the project and the test title, which between them are
  // already unique. A caller-supplied name would only invite collisions, since
  // two routes can share a test title.
  const slug = `${testInfo.project.name}-${testInfo.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  /*
   * `join(outputDir, '..')` rather than passing '..' to outputPath. Playwright
   * refuses a path that escapes the test's own output directory, which it
   * cannot distinguish from a genuine traversal, so the common parent is
   * resolved here and the screenshots land one level up in `screenshots/`.
   */
  const screenshotsDir = join(testInfo.config.rootDir, 'test-results', 'screenshots');
  mkdirSync(screenshotsDir, { recursive: true });

  await page.screenshot({
    path: join(screenshotsDir, `${slug}.png`),
    fullPage: true,
  });
}
