import { describe, expect, it } from 'vitest';
import {
  describe as describeResult,
  hasValue,
  isOk,
  isStale,
  mapValue,
  ok,
  sourceResult,
  stale,
  unavailable,
  valueOr,
} from './source-result.js';

describe('sourceResult', () => {
  it('builds an ok result with a value and no error', () => {
    const result = ok('discovery', ['a', 'b'], 120);
    expect(result.status).toBe('ok');
    expect(result.value).toEqual(['a', 'b']);
    expect(result.error).toBeUndefined();
    expect(result.meta.durationMs).toBe(120);
    expect(isOk(result)).toBe(true);
  });

  it('records the cache flag only when it is known', () => {
    expect(ok('discovery', 1, 5, true).meta.fromCache).toBe(true);
    expect(ok('discovery', 1, 5, false).meta.fromCache).toBe(false);
    expect(ok('discovery', 1, 5).meta.fromCache).toBeUndefined();
  });

  it('builds a stale result that keeps its partial value', () => {
    const result = stale(
      'audit',
      { checks: 4 },
      { code: 'chrome_missing', message: 'No Chrome.' },
      90,
      ['lighthouse'],
    );
    expect(result.status).toBe('stale');
    expect(result.value).toEqual({ checks: 4 });
    expect(result.error?.code).toBe('chrome_missing');
    expect(result.meta.degradedBy).toEqual(['lighthouse']);
    expect(isStale(result)).toBe(true);
    expect(hasValue(result)).toBe(true);
  });

  it('builds an unavailable result with no value', () => {
    const result = unavailable(
      'llm',
      { code: 'ollama_unreachable', message: 'Start Ollama.' },
      2000,
    );
    expect(result.status).toBe('unavailable');
    expect(result.value).toBeUndefined();
    expect(hasValue(result)).toBe(false);
  });

  it('stamps an ISO timestamp on every result', () => {
    const result = ok('system', null, 1);
    expect(result.meta.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(result.meta.at))).toBe(false);
  });

  describe('rejects impossible combinations', () => {
    it('ok without a value', () => {
      expect(() => sourceResult({ kind: 'audit', status: 'ok', durationMs: 1 })).toThrow(
        /requires a value/,
      );
    });

    it('ok that also carries an error', () => {
      expect(() =>
        sourceResult({
          kind: 'audit',
          status: 'ok',
          value: 1,
          error: { code: 'lighthouse_failed', message: 'Chrome crashed.' },
          durationMs: 1,
        }),
      ).toThrow(/and no error/);
    });

    it('unavailable with a value', () => {
      expect(() =>
        sourceResult({
          kind: 'audit',
          status: 'unavailable',
          value: 'something',
          error: { code: 'x', message: 'y' },
          durationMs: 1,
        }),
      ).toThrow(/requires an error and no value/);
    });

    it('unavailable without an error', () => {
      expect(() => sourceResult({ kind: 'audit', status: 'unavailable', durationMs: 1 })).toThrow();
    });

    it('stale without an error explaining the degradation', () => {
      expect(() =>
        sourceResult({ kind: 'audit', status: 'stale', value: 1, durationMs: 1 }),
      ).toThrow(/plus an error/);
    });

    it('stale without a value', () => {
      expect(() =>
        sourceResult({
          kind: 'audit',
          status: 'stale',
          error: { code: 'x', message: 'y' },
          durationMs: 1,
        }),
      ).toThrow(/requires a value/);
    });
  });
});

describe('valueOr', () => {
  it('returns the value when present, including when stale', () => {
    expect(valueOr(ok('audit', 42, 1), 0)).toBe(42);
    expect(valueOr(stale('audit', 7, { code: 'c', message: 'm' }, 1), 0)).toBe(7);
  });

  it('returns the fallback when unavailable', () => {
    expect(valueOr(unavailable('audit', { code: 'c', message: 'm' }, 1), 99)).toBe(99);
  });
});

describe('mapValue', () => {
  it('maps the payload and preserves status and timing', () => {
    const mapped = mapValue(
      stale('audit', { lcp: 6100 }, { code: 'chrome_missing', message: 'No Chrome.' }, 500, [
        'lighthouse',
      ]),
      (v) => v.lcp,
    );
    expect(mapped.status).toBe('stale');
    expect(mapped.value).toBe(6100);
    expect(mapped.meta.durationMs).toBe(500);
    expect(mapped.meta.degradedBy).toEqual(['lighthouse']);
    expect(mapped.error?.code).toBe('chrome_missing');
  });

  it('keeps an unavailable result unavailable instead of inventing a value', () => {
    const mapped = mapValue(
      unavailable('audit', { code: 'dns', message: 'No DNS.' }, 300),
      (v: string) => v.toUpperCase(),
    );
    expect(mapped.status).toBe('unavailable');
    expect(mapped.value).toBeUndefined();
    expect(mapped.error?.code).toBe('dns');
  });
});

describe('describe', () => {
  it('summarises each status for logs', () => {
    expect(describeResult(ok('audit', 1, 1))).toBe('ok');
    expect(describeResult(stale('audit', 1, { code: 'chrome_missing', message: 'm' }, 1))).toBe(
      'stale: chrome_missing',
    );
    expect(describeResult(unavailable('audit', { code: 'timeout', message: 'm' }, 1))).toBe(
      'unavailable: timeout',
    );
  });
});
