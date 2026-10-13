import type { Language, StoredFinding } from '../db/schema.js';
import { buildFallbackDraft, type FallbackDraft, type SenderProfile } from './fallback.js';
import { validateGrounding, type GroundingContext } from './grounding.js';
import { buildRetryPrompt, buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import { draftOutputSchema, type DraftOutput, type LlmProvider } from './provider.js';

/**
 * Draft orchestration: generate, validate, retry once, then fall back.
 *
 * The order matters and is not negotiable:
 *
 * 1. Ask the model.
 * 2. Validate the reply against the recorded audit. Prompt instructions are a
 *    request, not a guarantee.
 * 3. On failure, retry exactly once with the validation errors appended, so the
 *    model gets one chance to fix the specific problem it made.
 * 4. On a second failure, use the deterministic template.
 *
 * A fallback is never a silent failure. `grounded` and `validationErrors` are
 * both recorded so the UI can show "this used a template because the model
 * drifted" rather than presenting it as model output.
 */

export interface GenerateDraftInput {
  businessName: string;
  category?: string | undefined;
  language: Language;
  findings: StoredFinding[];
  sender: SenderProfile;
  websiteUrl?: string | undefined;
  phoneE164?: string | undefined;
  /** Extra numbers the message may state, such as a listing rating. */
  allowedNumbers?: readonly string[];
}

export interface DraftOutcome {
  whatsapp: string;
  email_subject: string;
  email_body: string;
  used_finding_ids: string[];
  /** Whether a model produced this and it passed validation. */
  generated_by: 'llm' | 'fallback';
  grounded: boolean;
  validation_errors: string[];
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  /** How many model calls were made: 0, 1 or 2. */
  attempts: number;
}

export interface OrchestratorOptions {
  provider: LlmProvider;
  /** Injected for tests, so a signal can be passed without a timer. */
  signal?: AbortSignal;
}

export async function generateDraft(
  input: GenerateDraftInput,
  options: OrchestratorOptions,
): Promise<DraftOutcome> {
  const started = Date.now();

  const groundingContext: GroundingContext = {
    findings: input.findings,
    ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}),
    ...(input.sender.portfolioUrl !== undefined ? { portfolioUrl: input.sender.portfolioUrl } : {}),
    ...(input.phoneE164 !== undefined ? { phoneE164: input.phoneE164 } : {}),
    ...(input.allowedNumbers !== undefined ? { allowedNumbers: input.allowedNumbers } : {}),
  };

  const userPrompt = buildUserPrompt({
    businessName: input.businessName,
    ...(input.category !== undefined ? { category: input.category } : {}),
    language: input.language,
    findings: input.findings,
    sender: input.sender,
  });

  let tokensIn = 0;
  let tokensOut = 0;
  const validationErrors: string[] = [];
  let attempts = 0;

  // Local, not module state: two concurrent drafts must not see each other's
  // validation failures in their retry prompt.
  let lastErrors: { code: string; message: string }[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    attempts += 1;

    const prompt = attempt === 0 ? userPrompt : buildRetryPrompt(userPrompt, lastErrors);

    let candidate: DraftOutput;
    try {
      const result = await options.provider.generateJson({
        system: SYSTEM_PROMPT,
        user: prompt,
        schema: draftOutputSchema,
        maxTokens: 600,
        temperature: 0.3,
        signal: options.signal ?? new AbortController().signal,
      });

      tokensIn += result.tokensIn;
      tokensOut += result.tokensOut;
      candidate = result.value;
    } catch (error) {
      // A provider that throws is a failed attempt, not a crash: the template
      // path still produces something sendable.
      validationErrors.push(
        `provider_error: ${error instanceof Error ? error.message : String(error)}`,
      );
      lastErrors = [
        {
          code: 'provider_error',
          message:
            'The model call failed. Return valid JSON matching the schema, with no commentary.',
        },
      ];
      continue;
    }

    const validation = validateGrounding(candidate, groundingContext);

    if (validation.grounded) {
      return {
        ...candidate,
        generated_by: 'llm',
        grounded: true,
        validation_errors: [],
        model: options.provider.model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        latency_ms: Date.now() - started,
        attempts,
      };
    }

    validationErrors.push(...validation.errors.map((error) => `${error.code}: ${error.message}`));
    lastErrors = validation.errors;
  }

  const fallback: FallbackDraft = buildFallbackDraft({
    businessName: input.businessName,
    findings: input.findings,
    language: input.language,
    sender: input.sender,
  });

  // The template is assembled from the audit itself, so it is grounded by
  // construction. It is validated anyway: a template bug must not be able to
  // ship an ungrounded message.
  const fallbackValidation = validateGrounding(fallback, groundingContext);

  return {
    ...fallback,
    generated_by: 'fallback',
    grounded: fallbackValidation.grounded,
    validation_errors: validationErrors,
    model: options.provider.model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    latency_ms: Date.now() - started,
    attempts,
  };
}
