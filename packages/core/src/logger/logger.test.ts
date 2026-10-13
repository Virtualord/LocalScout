import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, forLead, forRun, redactSecrets } from './logger.js';

/**
 * Capture pino output by writing JSON to an in-memory stream, so assertions
 * read the same lines an operator would see in a log file.
 */
function captureLogger(level: 'debug' | 'info' | 'error' = 'debug') {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim() === '') continue;
        lines.push(JSON.parse(line));
      }
      callback();
    },
  });

  // Passing the stream explicitly keeps log output out of the test report.
  const logger = createLogger({ level, destination: stream });
  return { logger, lines };
}

describe('createLogger', () => {
  it('emits structured JSON with the app binding', () => {
    const { logger, lines } = captureLogger('info');
    // pino merges fields from the object argument: info(obj, msg) keeps them,
    // info(msg, obj) silently drops the object.
    logger.info({ query: 'plumbers', location: 'Bhopal' }, 'discovery.start');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 30,
      msg: 'discovery.start',
      app: 'localscout',
      query: 'plumbers',
      location: 'Bhopal',
    });
    expect(typeof lines[0]?.['time']).toBe('number');
  });

  it('honours the configured level', () => {
    const { logger, lines } = captureLogger('error');
    logger.debug('not.emitted');
    logger.error('emitted');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.['msg']).toBe('emitted');
  });

  it('supports silent', () => {
    const logger = createLogger({ level: 'silent' });
    expect(() => logger.info('anything')).not.toThrow();
  });

  it('merges context fields only when the object comes first', () => {
    // pino treats info(msg, obj) as an interpolation pair and drops the object,
    // which loses fields silently. Call sites in this app always pass (obj, msg).
    // The cast is deliberate: pino's own types reject the losing form, so this
    // test asserts on runtime behaviour the types try to prevent.
    const { logger, lines } = captureLogger('info');
    (logger.info as (msg: string, obj: Record<string, unknown>) => void)('draft.start', {
      leadId: 'lead_1',
    });
    logger.info({ leadId: 'lead_2' }, 'draft.start');

    expect(lines[0]?.['leadId']).toBeUndefined();
    expect(lines[1]?.['leadId']).toBe('lead_2');
  });
});

describe('forRun', () => {
  it('binds runId onto every line, including nested children', () => {
    const { logger, lines } = captureLogger('info');
    const runLogger = forRun(logger, 'run_123');
    runLogger.info('run.end');
    runLogger.child({ step: 'audit' }).info('audit.end');

    expect(lines).toHaveLength(2);
    expect(lines[0]?.['runId']).toBe('run_123');
    expect(lines[1]?.['runId']).toBe('run_123');
    expect(lines[1]?.['step']).toBe('audit');
  });
});

describe('forLead', () => {
  it('binds leadId and preserves the run binding already present', () => {
    const { logger, lines } = captureLogger('info');
    const leadLogger = forLead(forRun(logger, 'run_9'), 'lead_7');
    leadLogger.info({ grounded: true }, 'draft.end');

    expect(lines[0]).toMatchObject({
      runId: 'run_9',
      leadId: 'lead_7',
      grounded: true,
    });
  });
});

describe('redactSecrets', () => {
  it('shows only whether a secret-looking key is set', () => {
    const redacted = redactSecrets({
      DISCOVERY_MODE: 'live',
      SERPAPI_API_KEY: 'real-key-value',
      LLM_API_KEY: '',
      SOME_TOKEN: undefined,
      nested: { password: 'hunter2' },
    });

    expect(redacted).toEqual({
      DISCOVERY_MODE: 'live',
      SERPAPI_API_KEY: 'set',
      LLM_API_KEY: 'unset',
      SOME_TOKEN: 'unset',
      nested: { password: 'hunter2' },
    });
  });

  it('never leaves the original secret value in the output', () => {
    const redacted = redactSecrets({ SERPAPI_API_KEY: 'abc123def456' });
    expect(JSON.stringify(redacted)).not.toContain('abc123def456');
  });
});
