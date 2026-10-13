import { describe, expect, it } from 'vitest';
import { parseSearch } from './index.js';

/**
 * `parseSearch` is the one piece of logic on the home screen, and a bad parse
 * means a search for the wrong city, which costs a SerpApi credit.
 */
describe('parseSearch', () => {
  it('splits on " in "', () => {
    expect(parseSearch('plumbers in Bhopal')).toEqual({ query: 'plumbers', location: 'Bhopal' });
  });

  it('accepts a multi-word query', () => {
    expect(parseSearch('emergency plumbers in New Delhi')).toEqual({
      query: 'emergency plumbers',
      location: 'New Delhi',
    });
  });

  it('accepts a multi-word location', () => {
    expect(parseSearch('dentists in New Delhi')).toEqual({
      query: 'dentists',
      location: 'New Delhi',
    });
  });

  it('is case insensitive on the separator', () => {
    expect(parseSearch('Plumbers IN Bhopal')).toEqual({ query: 'Plumbers', location: 'Bhopal' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseSearch('  plumbers   in   Bhopal  ')).toEqual({
      query: 'plumbers',
      location: 'Bhopal',
    });
  });

  it('splits on the first separator only', () => {
    expect(parseSearch('plumbing in Bhopal in India')).toEqual({
      query: 'plumbing',
      location: 'Bhopal in India',
    });
  });

  it('collapses multiple spaces around the separator', () => {
    expect(parseSearch('plumbers  in   Bhopal')).toEqual({
      query: 'plumbers',
      location: 'Bhopal',
    });
  });

  describe('rejects input that cannot be split', () => {
    it('an empty string', () => {
      expect(parseSearch('')).toBeUndefined();
    });

    it('whitespace only', () => {
      expect(parseSearch('    ')).toBeUndefined();
    });

    it('a query with no city', () => {
      expect(parseSearch('plumbers')).toBeUndefined();
    });

    it('a city with no query', () => {
      expect(parseSearch('in Bhopal')).toBeUndefined();
    });

    it('a separator with nothing after it', () => {
      expect(parseSearch('plumbers in')).toBeUndefined();
    });

    it('a separator with nothing before it', () => {
      expect(parseSearch('in')).toBeUndefined();
    });

    it('the word "in" as part of a word, not as a separator', () => {
      // "indium" contains "in" but is not the separator.
      expect(parseSearch('indium')).toBeUndefined();
    });
  });
});
