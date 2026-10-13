import { describe, expect, it } from 'vitest';
import { isValidCron } from './scheduler.js';

/**
 * Cron validation is the only guard between a stored string and node-cron's
 * scheduler. A malformed expression that node-cron accepts could fire far more
 * often than intended and spend the user's SerpApi quota in minutes.
 */
describe('isValidCron', () => {
  it('accepts standard five-field expressions', () => {
    for (const expression of [
      '0 9 * * 1', // Mondays at 09:00
      '30 18 * * *', // daily at 18:30
      '0 */6 * * *', // every six hours
      '15 8 * * 1-5', // weekdays at 08:15
      '0 0 1 * *', // the first of the month
    ]) {
      expect(isValidCron(expression), expression).toBe(true);
    }
  });

  it('accepts lists and steps', () => {
    expect(isValidCron('0 9,17 * * *')).toBe(true);
    expect(isValidCron('*/15 * * * *')).toBe(true);
    expect(isValidCron('0 0 * * 1,3,5')).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isValidCron('  0 9 * * 1  ')).toBe(true);
  });

  it('rejects a malformed expression', () => {
    for (const expression of [
      'every monday',
      '0 9 * *', // four fields
      '0 9 * * * *', // six fields
      '',
      '99 99 * * *', // out of range
      '* * * * *; rm -rf /',
    ]) {
      expect(isValidCron(expression), expression).toBe(false);
    }
  });
});
