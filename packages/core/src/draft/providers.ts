import type { z } from 'zod';
import type { LlmGenerateArgs, LlmProvider, LlmResult } from './provider.js';

/**
 * Ollama provider.
 *
 * Uses the `/api/chat` endpoint with a JSON schema in `format`, which Ollama
 * constrains the model's output against. That is belt and braces with the
 * post-return zod parse: the schema keeps a small local model on the rails, and
 * the parse means a model that ignores it still cannot reach the caller.
 *
 * Token counts come from Ollama's own counters rather than an estimate, so the
 * metrics endpoint reports measured usage.
 */

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';

  constructor(private readonly options: OllamaProviderOptions) {}

  get model(): string {
    return this.options.model;
  }

  async generateJson<T>(args: LlmGenerateArgs<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    const doFetch = this.options.fetchImpl ?? fetch;

    const response = await doFetch(`${trimSlash(this.options.baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: args.signal,
      body: JSON.stringify({
        model: this.options.model,
        stream: false,
        format: zodToJsonSchema(args.schema),
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
        options: {
          temperature: args.temperature,
          num_predict: args.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const body = await safeText(response);
      throw new Error(
        `Ollama returned ${response.status}. Check that "ollama serve" is running and "${this.options.model}" is pulled (ollama list).${body ? ` Response: ${body.slice(0, 200)}` : ''}`,
      );
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const content = payload.message?.content ?? '';
    const parsed = parseModelJson<T>(content, args.schema);

    return {
      value: parsed,
      tokensIn: payload.prompt_eval_count ?? 0,
      tokensOut: payload.eval_count ?? 0,
      latencyMs: Date.now() - started,
    };
  }

  /** Whether the endpoint answers and whether the configured model is present. */
  async health(): Promise<{ reachable: boolean; modelPresent: boolean; message: string }> {
    const doFetch = this.options.fetchImpl ?? fetch;
    try {
      const response = await doFetch(`${trimSlash(this.options.baseUrl)}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) {
        return {
          reachable: false,
          modelPresent: false,
          message: `Ollama answered ${response.status} at ${this.options.baseUrl}.`,
        };
      }
      const payload = (await response.json()) as { models?: { name?: string }[] };
      const names = (payload.models ?? []).map((entry) => entry.name ?? '');
      const modelPresent = names.some(
        (name) => name === this.options.model || name.startsWith(`${this.options.model}:`),
      );

      return {
        reachable: true,
        modelPresent,
        message: modelPresent
          ? `${this.options.model} is available.`
          : `${this.options.model} is not pulled. Run: ollama pull ${this.options.model}`,
      };
    } catch {
      return {
        reachable: false,
        modelPresent: false,
        message: `Ollama is not reachable at ${this.options.baseUrl}. Start it with "ollama serve", then retry.`,
      };
    }
  }
}

/**
 * OpenAI-compatible provider.
 *
 * Any endpoint speaking `/v1/chat/completions` works, which is how the app
 * stays provider-agnostic while defaulting to a local open-weight model.
 * Uses `response_format: json_schema` when the endpoint supports it.
 */

export interface OpenAiCompatibleProviderOptions {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';

  constructor(private readonly options: OpenAiCompatibleProviderOptions) {}

  get model(): string {
    return this.options.model;
  }

  async generateJson<T>(args: LlmGenerateArgs<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    const doFetch = this.options.fetchImpl ?? fetch;

    const response = await doFetch(`${trimSlash(this.options.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
      },
      signal: args.signal,
      body: JSON.stringify({
        model: this.options.model,
        temperature: args.temperature,
        max_tokens: args.maxTokens,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'draft',
            strict: true,
            schema: zodToJsonSchema(args.schema),
          },
        },
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
      }),
    });

    if (!response.ok) {
      const body = await safeText(response);
      throw new Error(
        `The model endpoint returned ${response.status}.${body ? ` Response: ${body.slice(0, 200)}` : ''}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = payload.choices?.[0]?.message?.content ?? '';
    const parsed = parseModelJson<T>(content, args.schema);

    return {
      value: parsed,
      tokensIn: payload.usage?.prompt_tokens ?? 0,
      tokensOut: payload.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Parse a model's JSON reply against the expected schema.
 *
 * Small models routinely wrap JSON in a fenced code block or add a sentence of
 * prose around it, so a strict `JSON.parse` is not enough. A model that still
 * cannot produce the shape raises, and the orchestrator falls back.
 */
export function parseModelJson<T>(content: string, schema: z.ZodType<T>): T {
  const candidates = jsonCandidates(content);

  for (const candidate of candidates) {
    try {
      const parsed = schema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Try the next candidate.
    }
  }

  const preview = content.slice(0, 200);
  throw new Error(`Model output did not match the draft schema. Received: ${preview}`);
}

/** Every substring of `content` that could plausibly be the JSON object. */
function jsonCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates: string[] = [trimmed];

  // A fenced block: ```json { ... } ```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // The outermost braces of a reply with surrounding prose.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  return candidates;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Convert a zod schema to the JSON Schema both endpoints expect.
 *
 * A full zod-to-json-schema conversion is overkill here: the draft schema is
 * fixed and known, so its shape is described directly. Zod 4 exposes its schema
 * as a JSON Schema value, which is used when available.
 */
export function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  // Zod 4 schemas carry a JSON Schema representation under this symbol.
  const candidate = schema as unknown as { toJSONSchema?: () => Record<string, unknown> };
  if (typeof candidate.toJSONSchema === 'function') {
    return candidate.toJSONSchema();
  }
  return DRAFT_JSON_SCHEMA;
}

/**
 * The draft schema in JSON Schema form.
 *
 * Used as a fallback when a zod version does not expose a converter, and it
 * documents the exact contract the model must satisfy.
 */
export const DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['whatsapp', 'email_subject', 'email_body', 'used_finding_ids'],
  properties: {
    whatsapp: { type: 'string' },
    email_subject: { type: 'string' },
    email_body: { type: 'string' },
    used_finding_ids: { type: 'array', items: { type: 'string' } },
  },
};
