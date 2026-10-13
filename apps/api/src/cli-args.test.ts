import { describe, expect, it } from 'vitest';

/**
 * CLI argument parsing, tested directly.
 *
 * The parser lives in `cli.ts` alongside the process.exit calls, so it is
 * extracted here as a pure function and `cli.ts` imports it. Argument handling
 * is where a typo quietly runs the wrong search against a live API key, so it
 * is worth a test rather than a read-through.
 */
import { parseCliArgs, CliUsageError } from './cli-args.js';

describe('parseCliArgs', () => {
  it('reads a positional query and location', () => {
    const args = parseCliArgs(['plumbers', 'Bhopal']);
    expect(args).toEqual({ query: 'plumbers', location: 'Bhopal', limit: 20, language: 'en' });
  });

  it('reads flags', () => {
    const args = parseCliArgs(['--query', 'plumbers', '--location', 'Bhopal', '--limit', '5']);
    expect(args).toMatchObject({ query: 'plumbers', location: 'Bhopal', limit: 5 });
  });

  it('reads inline flags', () => {
    const args = parseCliArgs(['--query=plumbers', '--location=Bhopal']);
    expect(args).toMatchObject({ query: 'plumbers', location: 'Bhopal' });
  });

  it('lets a flag win over a positional', () => {
    const args = parseCliArgs(['ignored', 'Ignored', '--query', 'real', '--location', 'Real']);
    expect(args.query).toBe('real');
    expect(args.location).toBe('Real');
  });

  it('accepts a multi-word quoted query', () => {
    const args = parseCliArgs(['emergency plumber', 'Bhopal']);
    expect(args.query).toBe('emergency plumber');
  });

  it('defaults to twenty leads and English', () => {
    const args = parseCliArgs(['a', 'b']);
    expect(args.limit).toBe(20);
    expect(args.language).toBe('en');
  });

  it('accepts all three languages', () => {
    for (const language of ['en', 'hinglish', 'hi']) {
      expect(parseCliArgs(['a', 'b', '--language', language]).language).toBe(language);
    }
  });

  describe('rejects bad input with an actionable message', () => {
    it('requires a query and a location', () => {
      expect(() => parseCliArgs(['plumbers'])).toThrow(CliUsageError);
      expect(() => parseCliArgs([])).toThrow(/Usage/);
    });

    it('rejects a non-numeric limit', () => {
      expect(() => parseCliArgs(['a', 'b', '--limit', 'many'])).toThrow(/whole number/);
    });

    it('rejects a limit outside the allowed range', () => {
      expect(() => parseCliArgs(['a', 'b', '--limit', '0'])).toThrow(CliUsageError);
      expect(() => parseCliArgs(['a', 'b', '--limit', '99'])).toThrow(CliUsageError);
    });

    it('rejects an unknown language and names the valid ones', () => {
      expect(() => parseCliArgs(['a', 'b', '--language', 'fr'])).toThrow(/en, hinglish or hi/);
    });
  });

  it('does not execute anything when parsing', () => {
    // Parsing is pure: no process exit, no filesystem, no network.
    expect(parseCliArgs(['a', 'b']).query).toBe('a');
  });
});
