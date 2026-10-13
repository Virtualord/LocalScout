import { describe, expect, it } from 'vitest';
import type { Language, StoredFinding } from '../db/schema.js';
import { buildFallbackDraft, type SenderProfile } from './fallback.js';
import { FixtureProvider, GROUNDED_REPLY, UNGROUNDED_REPLY } from './fixture.provider.js';
import { generateDraft, type GenerateDraftInput } from './generate.js';
import { validateGrounding } from './grounding.js';
import { OllamaProvider, OpenAiCompatibleProvider, parseModelJson } from './providers.js';
import { draftOutputSchema, type LlmProvider } from './provider.js';

const sender: SenderProfile = {
  name: 'Aditya',
  portfolioUrl: 'https://aditya.example/',
  services: 'fast, mobile-friendly websites',
};

const slowLcp: StoredFinding = {
  id: 'SLOW_LCP',
  severity: 'high',
  label: 'Slow to show main content',
  weight: 30,
  evidence: { lcp_ms: 6100, threshold_ms: 4000, unit: 'ms' },
};

const baseInput = (over: Partial<GenerateDraftInput> = {}): GenerateDraftInput => ({
  businessName: 'Sharma Plumbing',
  category: 'Plumber',
  language: 'en',
  findings: [slowLcp],
  sender,
  websiteUrl: 'https://sharmaplumbing.in/',
  ...over,
});

describe('generateDraft', () => {
  it('returns the model draft when it validates', async () => {
    const provider = new FixtureProvider();
    const result = await generateDraft(baseInput(), { provider });

    expect(result.generated_by).toBe('llm');
    expect(result.grounded).toBe(true);
    expect(result.validation_errors).toEqual([]);
    expect(result.attempts).toBe(1);
    expect(provider.calls).toBe(1);
  });

  it('records token usage and latency for the metrics endpoint', async () => {
    const provider = new FixtureProvider({ tokensIn: 500, tokensOut: 120 });
    const result = await generateDraft(baseInput(), { provider });

    expect(result.tokens_in).toBe(500);
    expect(result.tokens_out).toBe(120);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('records the model name', async () => {
    const result = await generateDraft(baseInput(), { provider: new FixtureProvider() });
    expect(result.model).toBe('fixture-draft-v1');
  });

  describe('retry', () => {
    it('retries once when the first draft is ungrounded', async () => {
      // First call ungrounded, second grounded: proves the retry happened and
      // that a corrected draft is accepted.
      const provider = new FixtureProvider({ replies: [UNGROUNDED_REPLY, GROUNDED_REPLY] });
      const result = await generateDraft(baseInput(), { provider });

      expect(provider.calls).toBe(2);
      expect(result.attempts).toBe(2);
      expect(result.generated_by).toBe('llm');
      expect(result.grounded).toBe(true);
    });

    it('records no errors when the retry succeeded', async () => {
      const provider = new FixtureProvider({ replies: [UNGROUNDED_REPLY, GROUNDED_REPLY] });
      const result = await generateDraft(baseInput(), { provider });

      // A recovered draft is trustworthy, so it carries no outstanding errors.
      // `attempts` is what tells the metrics endpoint the retry was needed.
      expect(result.validation_errors).toEqual([]);
      expect(result.attempts).toBe(2);
      expect(result.grounded).toBe(true);
    });

    it('falls back after two ungrounded attempts', async () => {
      const provider = new FixtureProvider({ replies: [UNGROUNDED_REPLY] });
      const result = await generateDraft(baseInput(), { provider });

      expect(provider.calls).toBe(2);
      expect(result.attempts).toBe(2);
      expect(result.generated_by).toBe('fallback');
    });

    it('gives up after exactly two attempts, never three', async () => {
      const provider = new FixtureProvider({ replies: [UNGROUNDED_REPLY] });
      await generateDraft(baseInput(), { provider });
      expect(provider.calls).toBe(2);
    });
  });

  describe('fallback quality', () => {
    it('produces a grounded message from the deterministic template', async () => {
      const provider = new FixtureProvider({ replies: [UNGROUNDED_REPLY] });
      const result = await generateDraft(baseInput(), { provider });

      // The template is assembled from the audit, so it must pass the same
      // validator a model draft has to pass.
      expect(result.grounded).toBe(true);
    });

    it('keeps the validation errors so the failure is visible', async () => {
      const provider = new FixtureProvider({ replies: [UNGROUNDED_REPLY] });
      const result = await generateDraft(baseInput(), { provider });
      expect(result.validation_errors.length).toBeGreaterThan(0);
    });

    it('matches the standalone template output', async () => {
      const provider = new FixtureProvider({ replies: [UNGROUNDED_REPLY] });
      const result = await generateDraft(baseInput(), { provider });
      const expected = buildFallbackDraft({
        businessName: 'Sharma Plumbing',
        findings: [slowLcp],
        language: 'en',
        sender,
      });

      expect(result.whatsapp).toBe(expected.whatsapp);
      expect(result.email_body).toBe(expected.email_body);
    });

    it('falls back when the provider throws, without crashing', async () => {
      const provider = new FixtureProvider({ error: new Error('connection refused') });
      const result = await generateDraft(baseInput(), { provider });

      expect(result.generated_by).toBe('fallback');
      expect(result.grounded).toBe(true);
      expect(result.validation_errors.join(' ')).toContain('connection refused');
    });

    it('falls back when the provider returns invalid schema data', async () => {
      const provider = new FixtureProvider({
        replies: [{ ...GROUNDED_REPLY, used_finding_ids: 'not-an-array' as never }],
      });
      const result = await generateDraft(baseInput(), { provider });
      expect(result.generated_by).toBe('fallback');
    });
  });

  describe('languages', () => {
    const languages: Language[] = ['en', 'hinglish', 'hi'];

    it.each(languages)('produces a grounded draft in %s', async (language) => {
      const provider = new FixtureProvider({ replies: [UNGROUNDED_REPLY] });
      const result = await generateDraft(baseInput({ language }), { provider });

      expect(result.grounded).toBe(true);
      expect(result.generated_by).toBe('fallback');
    });

    it.each(languages)('falls back in %s when the model drifts', async (language) => {
      const provider = new FixtureProvider({ replies: [UNGROUNDED_REPLY] });
      const result = await generateDraft(baseInput({ language }), { provider });
      expect(result.whatsapp.length).toBeGreaterThan(0);
    });
  });

  it('handles a lead with no website', async () => {
    const noWebsite: StoredFinding = {
      id: 'NO_WEBSITE',
      severity: 'high',
      label: 'No website of its own',
      weight: 70,
      evidence: { website: 'none' },
    };

    const provider = new FixtureProvider({ replies: [UNGROUNDED_REPLY] });
    const result = await generateDraft(
      baseInput({ findings: [noWebsite], websiteUrl: undefined }),
      { provider },
    );

    expect(result.generated_by).toBe('fallback');
    expect(result.whatsapp).toContain('Sharma Plumbing');
    expect(result.grounded).toBe(true);
  });

  it('keeps retry state per call, not shared across drafts', async () => {
    // Each provider fails its first call and succeeds on its second. If the
    // retry state were module-level, the second draft would start with the
    // first draft's errors already satisfied and never retry.
    const makeProvider = (businessName: string) => {
      let calls = 0;
      const provider: LlmProvider = {
        name: 'test',
        model: 'test-model',
        generateJson: async ({ schema }) => {
          calls += 1;
          const reply =
            calls === 1
              ? { ...UNGROUNDED_REPLY, used_finding_ids: [`WRONG_FOR_${businessName}`] }
              : {
                  whatsapp: `Hello ${businessName}, I measured 6.1 seconds. Free audit report? Reply STOP to opt out.`,
                  email_subject: `${businessName} audit`,
                  email_body: `Hello ${businessName}, I measured 6.1 seconds on mobile. Reply STOP to opt out.`,
                  used_finding_ids: ['SLOW_LCP'],
                };
          return {
            value: parseModelJson(JSON.stringify(reply), schema),
            tokensIn: 1,
            tokensOut: 1,
            latencyMs: 0,
          };
        },
      };
      return { provider, callCount: () => calls };
    };

    const first = makeProvider('A Plumbing');
    const second = makeProvider('B Electricals');

    const [a, b] = await Promise.all([
      generateDraft(baseInput({ businessName: 'A Plumbing' }), { provider: first.provider }),
      generateDraft(baseInput({ businessName: 'B Electricals' }), { provider: second.provider }),
    ]);

    // Both retried once and recovered on their own.
    expect(first.callCount()).toBe(2);
    expect(second.callCount()).toBe(2);
    expect(a.generated_by).toBe('llm');
    expect(b.generated_by).toBe('llm');
    expect(a.whatsapp).toContain('A Plumbing');
    expect(b.whatsapp).toContain('B Electricals');
    expect(a.whatsapp).not.toContain('B Electricals');
  });
});

describe('parseModelJson', () => {
  // The schema requires all four fields, so a valid reply is a whole draft.
  const minimal = {
    whatsapp: 'hi',
    email_subject: 'subject',
    email_body: 'body',
    used_finding_ids: [],
  };

  it('parses plain json', () => {
    const value = parseModelJson(JSON.stringify(minimal), draftOutputSchema);
    expect(value.whatsapp).toBe('hi');
    expect(value.used_finding_ids).toEqual([]);
  });

  it('parses a fenced code block', () => {
    const value = parseModelJson(
      '```json\n' + JSON.stringify(minimal) + '\n```',
      draftOutputSchema,
    );
    expect(value.whatsapp).toBe('hi');
  });

  it('parses json wrapped in prose', () => {
    const value = parseModelJson(
      `Here is the draft:\n${JSON.stringify(minimal)}\nHope that helps!`,
      draftOutputSchema,
    );
    expect(value.whatsapp).toBe('hi');
  });

  it('rejects output missing a required field', () => {
    expect(() => parseModelJson('{"whatsapp":"hi"}', draftOutputSchema)).toThrow(/did not match/);
  });

  it('rejects output with a wrongly typed field', () => {
    expect(() =>
      parseModelJson(JSON.stringify({ ...minimal, whatsapp: 123 }), draftOutputSchema),
    ).toThrow(/did not match/);
  });

  it('rejects prose with no json at all', () => {
    expect(() => parseModelJson('I cannot help with that.', draftOutputSchema)).toThrow();
  });
});

describe('ollama provider', () => {
  const options = { baseUrl: 'http://127.0.0.1:11434', model: 'gemma3:4b', timeoutMs: 5000 };

  it('sends the schema as a format and returns parsed output', async () => {
    let capturedBody = '';
    const fetchImpl: typeof fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          message: { content: JSON.stringify(GROUNDED_REPLY) },
          prompt_eval_count: 400,
          eval_count: 90,
        }),
        { status: 200 },
      );
    };

    const provider = new OllamaProvider({ ...options, fetchImpl });
    const result = await provider.generateJson({
      system: 'sys',
      user: 'user',
      schema: draftOutputSchema,
      maxTokens: 500,
      temperature: 0.3,
      signal: new AbortController().signal,
    });

    expect(result.value.whatsapp).toContain('6.1');
    expect(result.tokensIn).toBe(400);
    expect(result.tokensOut).toBe(90);

    const body = JSON.parse(capturedBody) as Record<string, unknown>;
    expect(body['stream']).toBe(false);
    expect(body['format']).toBeDefined();
    expect(body['model']).toBe('gemma3:4b');
  });

  it('reports a helpful message when the endpoint errors', async () => {
    const fetchImpl: typeof fetch = async () => new Response('model not found', { status: 404 });
    const provider = new OllamaProvider({ ...options, fetchImpl });

    await expect(
      provider.generateJson({
        system: 's',
        user: 'u',
        schema: draftOutputSchema,
        maxTokens: 100,
        temperature: 0,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/ollama serve|ollama list/);
  });

  it('trims a trailing slash from the base url', async () => {
    let capturedUrl = '';
    const fetchImpl: typeof fetch = async (url) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({ message: { content: JSON.stringify(GROUNDED_REPLY) } }),
        {
          status: 200,
        },
      );
    };

    const provider = new OllamaProvider({
      ...options,
      baseUrl: 'http://127.0.0.1:11434/',
      fetchImpl,
    });
    await provider.generateJson({
      system: 's',
      user: 'u',
      schema: draftOutputSchema,
      maxTokens: 100,
      temperature: 0,
      signal: new AbortController().signal,
    });

    expect(capturedUrl).toBe('http://127.0.0.1:11434/api/chat');
  });
});

describe('openai-compatible provider', () => {
  const options = {
    baseUrl: 'https://api.example.com/v1',
    model: 'local-model',
    apiKey: 'test-key',
    timeoutMs: 5000,
  };

  it('sends chat completions with a json schema and reads usage', async () => {
    let capturedBody = '';
    const fetchImpl: typeof fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(GROUNDED_REPLY) } }],
          usage: { prompt_tokens: 300, completion_tokens: 70 },
        }),
        { status: 200 },
      );
    };

    const provider = new OpenAiCompatibleProvider({ ...options, fetchImpl });
    const result = await provider.generateJson({
      system: 'sys',
      user: 'user',
      schema: draftOutputSchema,
      maxTokens: 500,
      temperature: 0.3,
      signal: new AbortController().signal,
    });

    expect(result.value.whatsapp).toContain('6.1');
    expect(result.tokensIn).toBe(300);
    expect(result.tokensOut).toBe(70);

    const body = JSON.parse(capturedBody) as Record<string, unknown>;
    expect(body['response_format']).toBeDefined();
  });

  it('sends an authorization header when a key is configured', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      headers = (init?.headers ?? {}) as Record<string, string>;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(GROUNDED_REPLY) } }] }),
        { status: 200 },
      );
    };

    const provider = new OpenAiCompatibleProvider({ ...options, fetchImpl });
    await provider.generateJson({
      system: 's',
      user: 'u',
      schema: draftOutputSchema,
      maxTokens: 100,
      temperature: 0,
      signal: new AbortController().signal,
    });

    expect(headers['authorization']).toBe('Bearer test-key');
  });

  it('omits the header when no key is configured', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      headers = (init?.headers ?? {}) as Record<string, string>;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(GROUNDED_REPLY) } }] }),
        { status: 200 },
      );
    };

    const provider = new OpenAiCompatibleProvider({
      ...options,
      apiKey: undefined,
      fetchImpl,
    });
    await provider.generateJson({
      system: 's',
      user: 'u',
      schema: draftOutputSchema,
      maxTokens: 100,
      temperature: 0,
      signal: new AbortController().signal,
    });

    expect(headers['authorization']).toBeUndefined();
  });
});

describe('the fixture reply is itself grounded', () => {
  // If the canned reply ever drifted, every happy-path test would be asserting
  // on something that would be rejected in production.
  it('passes the validator against a matching audit', () => {
    const result = validateGrounding(GROUNDED_REPLY, {
      findings: [slowLcp],
      portfolioUrl: sender.portfolioUrl,
      websiteUrl: 'https://sharmaplumbing.in/',
    });
    expect(result.errors).toEqual([]);
  });

  it('fails the validator, as intended, for the ungrounded reply', () => {
    const result = validateGrounding(UNGROUNDED_REPLY, {
      findings: [slowLcp],
      portfolioUrl: sender.portfolioUrl,
    });
    expect(result.grounded).toBe(false);
    const codes = result.errors.map((error) => error.code);
    expect(codes).toContain('invented_number');
    expect(codes).toContain('banned_phrase');
    expect(codes).toContain('unknown_finding_id');
  });
});
