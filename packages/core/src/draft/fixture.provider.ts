import type { z } from 'zod';
import { DRAFT_JSON_SCHEMA, parseModelJson } from './providers.js';
import type { LlmGenerateArgs, LlmProvider, LlmResult } from './provider.js';

/**
 * Fixture provider.
 *
 * Returns canned JSON so the whole pipeline runs in CI with no model, no GPU,
 * and no network. It also gives tests a way to simulate a drifting model, which
 * is how the retry-then-fallback path is covered without a real 4B model.
 *
 * The replies are chosen to pass the grounding validator, because the default
 * path should be the happy one; a test asks for an ungrounded reply explicitly
 * when it is testing the fallback.
 */

export interface FixtureReply {
  whatsapp: string;
  email_subject: string;
  email_body: string;
  used_finding_ids: string[];
}

export interface FixtureProviderOptions {
  /** Replies returned in order; the last one repeats. */
  replies?: FixtureReply[];
  /** Thrown instead of replying, to simulate an unreachable endpoint. */
  error?: Error;
  /** Reported token counts, so metrics tests have something to assert on. */
  tokensIn?: number;
  tokensOut?: number;
}

export const GROUNDED_REPLY: FixtureReply = {
  whatsapp:
    'Namaste, I ran a mobile speed test on your site and the page took 6.1 seconds to show its main content. If useful, I can send a free audit report. Reply STOP and I will not message again.',
  email_subject: 'Your site took 6.1 seconds to load on mobile',
  email_body:
    'Namaste,\n\nI ran a mobile speed test on your website and the main content took 6.1 seconds to appear. Slower pages are harder to use on a phone, where most local customers will find you.\n\nIf it is useful, I can send a free audit report with the full details.\n\nIf you would rather not hear from me, reply STOP and I will not message again.',
  used_finding_ids: ['SLOW_LCP'],
};

/** A reply that invents a number, for exercising the retry and fallback paths. */
export const UNGROUNDED_REPLY: FixtureReply = {
  whatsapp: 'Namaste, I can get you 500 more customers in 30 days. Guaranteed results, act now!',
  email_subject: '500 more customers, guaranteed',
  email_body:
    'Namaste,\n\nI can get you 500 more customers in 30 days. Guaranteed results, act now!\n\nVisit https://someone-elses-work.example/ to see.',
  used_finding_ids: ['MADE_UP_FINDING'],
};

export class FixtureProvider implements LlmProvider {
  readonly name = 'fixture';
  readonly model = 'fixture-draft-v1';

  private callCount = 0;

  constructor(private readonly options: FixtureProviderOptions = {}) {}

  /** How many times generateJson has been called, for retry assertions. */
  get calls(): number {
    return this.callCount;
  }

  async generateJson<T>(args: LlmGenerateArgs<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    this.callCount += 1;

    if (this.options.error) {
      throw this.options.error;
    }

    const replies = this.options.replies ?? [GROUNDED_REPLY];
    const reply = replies[Math.min(this.callCount - 1, replies.length - 1)] ?? GROUNDED_REPLY;

    return {
      // Parsed through the real schema and the real parser, so a fixture that
      // drifts from the schema fails here exactly as a model would.
      value: parseModelJson(JSON.stringify(reply), args.schema as z.ZodType<unknown>) as T,
      tokensIn: this.options.tokensIn ?? 412,
      tokensOut: this.options.tokensOut ?? 138,
      latencyMs: Date.now() - started,
    };
  }
}

export { DRAFT_JSON_SCHEMA };
