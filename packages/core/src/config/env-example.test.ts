import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

/**
 * The shipped `.env.example` is the first thing a new user copies. If it does
 * not parse, the quickstart in the README is broken.
 */
function parseDotEnv(contents: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    env[key] = value;
  }
  return env;
}

describe('.env.example', () => {
  const examplePath = fileURLToPath(new URL('../../../../.env.example', import.meta.url));
  const env = parseDotEnv(readFileSync(examplePath, 'utf8'));

  it('loads cleanly, so a fresh copy is a working configuration', () => {
    const config = loadConfig(env);
    expect(config.discovery.mode).toBe('fixtures');
    expect(config.llm.provider).toBe('fixture');
  });

  it('leaves every secret empty', () => {
    expect(env['SERPAPI_API_KEY']).toBe('');
    expect(env['LLM_API_KEY']).toBe('');
    expect(env['AUTH_TOKEN']).toBe('');
    expect(env['SENDER_NAME']).toBe('');
    expect(env['SENDER_PORTFOLIO_URL']).toBe('');
  });

  it('documents the keys the app actually reads', () => {
    // Every key named in the schema must be present so users can discover them.
    for (const key of [
      'DISCOVERY_MODE',
      'SERPAPI_API_KEY',
      'SERPAPI_CACHE_DIR',
      'LLM_PROVIDER',
      'LLM_BASE_URL',
      'LLM_MODEL',
      'LLM_API_KEY',
      'LLM_TIMEOUT_MS',
      'CHROME_PATH',
      'AUDIT_CONCURRENCY',
      'AUDIT_TIMEOUT_MS',
      'DEFAULT_COUNTRY',
      'DATA_DIR',
      'API_PORT',
      'PORT',
      'HOST',
      'AUTH_TOKEN',
      'LOG_LEVEL',
      'SENDER_NAME',
      'SENDER_PORTFOLIO_URL',
      'SENDER_SERVICES',
    ]) {
      expect(env, `.env.example is missing ${key}`).toHaveProperty(key);
    }
  });
});
