import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, MIN_AUTH_TOKEN_LENGTH, rawEnvSchema } from './env.js';

/** A clean environment: every optional key absent, every default in place. */
const cleanEnv = {} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('runs fully offline with no environment at all', () => {
    const config = loadConfig(cleanEnv);

    expect(config.discovery.mode).toBe('fixtures');
    expect(config.discovery.serpApiKey).toBeUndefined();
    expect(config.llm.provider).toBe('fixture');
    expect(config.llm.baseUrl).toBe('http://127.0.0.1:11434');
    expect(config.llm.model).toBe('gemma3:4b');
    expect(config.audit.concurrency).toBe(2);
    expect(config.audit.timeoutMs).toBe(120_000);
    expect(config.audit.chromePath).toBeUndefined();
    expect(config.app.apiPort).toBe(8787);
    expect(config.app.host).toBe('127.0.0.1');
    expect(config.app.serveWeb).toBe(false);
    expect(config.app.webDist).toBeUndefined();
    expect(config.auth.token).toBeUndefined();
    expect(config.app.defaultCountry).toBe('IN');
    expect(config.app.logLevel).toBe('info');
    expect(config.scheduler.enabled).toBe(false);
  });

  it('treats an empty string as unset so a blank .env line does not become a value', () => {
    const config = loadConfig({
      SERPAPI_API_KEY: '',
      CHROME_PATH: '   ',
      SENDER_NAME: '',
      DISCOVERY_MODE: 'fixtures',
    } as NodeJS.ProcessEnv);

    expect(config.discovery.serpApiKey).toBeUndefined();
    expect(config.audit.chromePath).toBeUndefined();
    expect(config.sender.name).toBeUndefined();
  });

  it('trims whitespace around values', () => {
    const config = loadConfig({ SERPAPI_API_KEY: '  abc123  ' } as NodeJS.ProcessEnv);
    expect(config.discovery.serpApiKey).toBe('abc123');
  });

  it('coerces numeric strings from the environment', () => {
    const config = loadConfig({
      API_PORT: '9000',
      AUDIT_CONCURRENCY: '4',
      AUDIT_TIMEOUT_MS: '30000',
      LLM_TIMEOUT_MS: '5000',
    } as NodeJS.ProcessEnv);

    expect(config.app.apiPort).toBe(9000);
    expect(config.audit.concurrency).toBe(4);
    expect(config.audit.timeoutMs).toBe(30_000);
    expect(config.llm.timeoutMs).toBe(5000);
  });

  it('uppercases the default country for libphonenumber-js', () => {
    expect(loadConfig({ DEFAULT_COUNTRY: 'in' } as NodeJS.ProcessEnv).app.defaultCountry).toBe(
      'IN',
    );
  });

  it('parses the scheduler flag', () => {
    expect(loadConfig({ SCHEDULER_ENABLED: 'true' } as NodeJS.ProcessEnv).scheduler.enabled).toBe(
      true,
    );
    expect(loadConfig({ SCHEDULER_ENABLED: 'false' } as NodeJS.ProcessEnv).scheduler.enabled).toBe(
      false,
    );
  });

  it('lets the platform port stand in for API_PORT, with API_PORT winning', () => {
    expect(loadConfig({ PORT: '10000' } as NodeJS.ProcessEnv).app.apiPort).toBe(10_000);
    expect(loadConfig({ PORT: '10000', API_PORT: '9000' } as NodeJS.ProcessEnv).app.apiPort).toBe(
      9000,
    );
  });

  it('accepts a non-loopback host once a long-enough token is set', () => {
    const token = 'a'.repeat(MIN_AUTH_TOKEN_LENGTH);
    const config = loadConfig({
      HOST: '0.0.0.0',
      AUTH_TOKEN: token,
    } as NodeJS.ProcessEnv);

    expect(config.app.host).toBe('0.0.0.0');
    expect(config.auth.token).toBe(token);
  });

  it('parses the serve-web flag and an explicit dist path', () => {
    const config = loadConfig({
      SERVE_WEB: 'true',
      WEB_DIST: '/srv/web',
    } as NodeJS.ProcessEnv);

    expect(config.app.serveWeb).toBe(true);
    expect(config.app.webDist).toBe('/srv/web');
  });

  it('carries the sender profile through', () => {
    const config = loadConfig({
      SENDER_NAME: 'Aditya',
      SENDER_PORTFOLIO_URL: 'https://example.com',
      SENDER_SERVICES: 'speed fixes',
    } as NodeJS.ProcessEnv);

    expect(config.sender.name).toBe('Aditya');
    expect(config.sender.portfolioUrl).toBe('https://example.com');
    expect(config.sender.services).toBe('speed fixes');
  });

  describe('fails fast with a readable message', () => {
    it('rejects live discovery without a key and says how to fix it', () => {
      expect(() => loadConfig({ DISCOVERY_MODE: 'live' } as NodeJS.ProcessEnv)).toThrow(
        ConfigError,
      );

      try {
        loadConfig({ DISCOVERY_MODE: 'live' } as NodeJS.ProcessEnv);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        const message = (error as ConfigError).message;
        expect(message).toContain('SERPAPI_API_KEY');
        expect(message).toContain('DISCOVERY_MODE=fixtures');
      }
    });

    it('accepts live discovery with a key', () => {
      const config = loadConfig({
        DISCOVERY_MODE: 'live',
        SERPAPI_API_KEY: 'key123',
      } as NodeJS.ProcessEnv);
      expect(config.discovery.mode).toBe('live');
    });

    it('rejects an openai-compatible provider without a key', () => {
      expect(() => loadConfig({ LLM_PROVIDER: 'openai-compatible' } as NodeJS.ProcessEnv)).toThrow(
        /LLM_API_KEY/,
      );
    });

    it('accepts an unauthenticated openai-compatible endpoint via an explicit key of any form', () => {
      const config = loadConfig({
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: 'https://api.example.com/v1',
        LLM_API_KEY: 'sk-test',
      } as NodeJS.ProcessEnv);
      expect(config.llm.provider).toBe('openai-compatible');
    });

    it('rejects a base url without a scheme', () => {
      expect(() =>
        loadConfig({
          LLM_PROVIDER: 'ollama',
          LLM_BASE_URL: '127.0.0.1:11434',
        } as NodeJS.ProcessEnv),
      ).toThrow(/http:\/\/ or https:\/\//);
    });

    it('rejects a portfolio url without a scheme', () => {
      expect(() =>
        loadConfig({ SENDER_PORTFOLIO_URL: 'example.com' } as NodeJS.ProcessEnv),
      ).toThrow(/SENDER_PORTFOLIO_URL/);
    });

    it('rejects an unknown provider', () => {
      expect(() => loadConfig({ LLM_PROVIDER: 'anthropic' } as NodeJS.ProcessEnv)).toThrow(
        /LLM_PROVIDER/,
      );
    });

    it('rejects an out-of-range port', () => {
      expect(() => loadConfig({ API_PORT: '70000' } as NodeJS.ProcessEnv)).toThrow(/API_PORT/);
    });

    it('refuses a network-reachable host without a token, and says what to set', () => {
      try {
        loadConfig({ HOST: '0.0.0.0' } as NodeJS.ProcessEnv);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        const message = (error as ConfigError).message;
        expect(message).toContain('AUTH_TOKEN');
        expect(message).toContain('127.0.0.1');
      }
    });

    it('refuses a token too short to be a gate', () => {
      expect(() =>
        loadConfig({ HOST: '0.0.0.0', AUTH_TOKEN: 'short' } as NodeJS.ProcessEnv),
      ).toThrow(/at least 16 characters/);
    });

    it('refuses a HOST that looks like a URL', () => {
      expect(() =>
        loadConfig({
          HOST: 'http://0.0.0.0:8787',
          AUTH_TOKEN: 'a'.repeat(MIN_AUTH_TOKEN_LENGTH),
        } as NodeJS.ProcessEnv),
      ).toThrow(/HOST/);
    });

    it('rejects a concurrency above the cap', () => {
      expect(() => loadConfig({ AUDIT_CONCURRENCY: '50' } as NodeJS.ProcessEnv)).toThrow(
        /AUDIT_CONCURRENCY/,
      );
    });

    it('rejects a default country that is not two letters', () => {
      expect(() => loadConfig({ DEFAULT_COUNTRY: 'IND' } as NodeJS.ProcessEnv)).toThrow(
        /DEFAULT_COUNTRY/,
      );
    });
  });

  it('exposes the raw schema, which accepts an empty environment', () => {
    expect(rawEnvSchema.safeParse({}).success).toBe(true);
  });
});
