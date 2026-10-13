import cronModule from 'node-cron';
import type { ScheduledTask } from 'node-cron';

const { schedule } = cronModule;
import type { Language } from '../db/schema.js';
import type { Repositories } from '../db/repositories/index.js';

/**
 * Optional scheduled saved searches.
 *
 * Off by default (SCHEDULER_ENABLED=false). The reason it exists at all is that
 * a freelancer checking for new leads in the same city weekly should not have
 * to remember to. The reason it is opt-in is that it spends SerpApi quota on
 * nobody's behalf.
 *
 * Cron strings are validated before a task is registered, so a malformed entry
 * in the database cannot start a task that fires every second.
 */

export interface SavedSearchSchedule {
  id: string;
  query: string;
  location: string;
  limit: number;
  language: Language;
  /** Null for a manual search, which the scheduler never registers. */
  cron: string | null;
}

export interface SchedulerOptions {
  repos: Repositories;
  /** Starts a run. Injected so the scheduler never owns the workflow. */
  startRun: (input: {
    query: string;
    location: string;
    limit: number;
    language: Language;
  }) => Promise<void>;
  logger: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
}

/**
 * The valid range and step size for each of the five cron fields.
 *
 * Ranges are enforced rather than assumed: a permissive regex accepts "99 99 * *
 * *", which node-cron will happily schedule, and the result is a search that
 * runs far more often than the user intended and spends their quota.
 */
const CRON_FIELDS: { name: string; min: number; max: number }[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 6 },
];

/** One comma-separated element: `*`, a number, a range, optionally with `/step`. */
function isValidFieldPart(part: string, min: number, max: number): boolean {
  const [rangeText, stepText, ...rest] = part.split('/');
  if (rest.length > 0) return false;

  const range = rangeText ?? '';
  if (range === '') return false;

  if (stepText !== undefined) {
    const step = Number(stepText);
    if (!Number.isInteger(step) || step < 1) return false;
  }

  if (range === '*') return true;

  const bounds = range.split('-');
  if (bounds.length > 2) return false;

  for (const bound of bounds) {
    if (!/^\d+$/.test(bound)) return false;
    const value = Number(bound);
    if (!Number.isInteger(value) || value < min || value > max) return false;
  }

  return true;
}

export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== CRON_FIELDS.length) return false;

  return fields.every((field, index) => {
    const spec = CRON_FIELDS[index];
    if (!spec) return false;
    return field.split(',').every((part) => isValidFieldPart(part, spec.min, spec.max));
  });
}

export interface SchedulerHandle {
  stop(): void;
  /** Number of tasks currently registered. */
  readonly taskCount: number;
}

/**
 * Register every valid saved search.
 *
 * An invalid expression is logged and skipped rather than registered, so one
 * bad row cannot stop the others from working.
 */
export async function startScheduler(options: SchedulerOptions): Promise<SchedulerHandle> {
  const tasks: ScheduledTask[] = [];
  const saved = await options.repos.leads.scheduled();

  for (const search of saved) {
    if (search.cron === null || !isValidCron(search.cron)) {
      options.logger.warn(
        { searchId: search.id, cron: search.cron },
        'scheduler.skipped_invalid_cron',
      );
      continue;
    }

    const expression = search.cron;
    const task = schedule(
      expression,
      () => {
        options
          .startRun({
            query: search.query,
            location: search.location,
            limit: search.limit,
            language: search.language,
          })
          .catch((error: unknown) => {
            options.logger.warn(
              { searchId: search.id, error: String(error) },
              'scheduler.run_failed',
            );
          });
      },
      // node-cron starts a task as soon as it is scheduled, which is what an
      // explicitly enabled scheduler should do.
    );

    tasks.push(task);
    options.logger.info(
      { searchId: search.id, query: search.query, location: search.location, cron: expression },
      'scheduler.registered',
    );
  }

  return {
    stop: () => {
      for (const task of tasks) task.stop();
    },
    get taskCount() {
      return tasks.length;
    },
  };
}
