import { z } from 'zod';

/**
 * The provider interface and the shared output schema.
 *
 * Drafting is the only part of Localscout that asks a language model to write
 * anything, and the only part where a wrong word becomes a wrong claim sent to a
 * real business. Three rules follow from that, and they are enforced by the
 * types and the validator rather than by prompt wording:
 *
 * - The provider returns a value that already passed a schema. No raw string
 *   from a model is ever handed onward.
 * - The schema declares which findings were used, so the validator can reject a
 *   draft citing a finding the audit never produced.
 * - Token counts and latency come back with every call, so the write-up can
 *   quote measured numbers instead of estimates.
 */

export interface LlmGenerateArgs<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}

/** What a provider returns: the parsed value plus what it cost. */
export interface LlmResult<T> {
  value: T;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface LlmProvider {
  /** Stable identifier recorded on the draft row. */
  readonly name: string;
  /** Model identifier, recorded for the eval harness. */
  readonly model: string;
  generateJson<T>(args: LlmGenerateArgs<T>): Promise<LlmResult<T>>;
}

export const DRAFT_LIMITS = {
  whatsappMaxChars: 450,
  emailMaxWords: 120,
} as const;

/**
 * The draft shape.
 *
 * `used_finding_ids` is the contract between the model and the validator: a
 * draft may only cite findings the audit actually produced.
 */
export const draftOutputSchema = z.object({
  whatsapp: z.string(),
  email_subject: z.string(),
  email_body: z.string(),
  used_finding_ids: z.array(z.string()),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;

/**
 * Phrases a draft may never contain.
 *
 * Configurable because the list is a product judgement rather than a technical
 * fact. Each entry blocks a claim that is either unverifiable or a promise the
 * sender cannot keep.
 */
export const DEFAULT_BANNED_PHRASES: readonly string[] = [
  '#1 on google',
  'number one on google',
  'best in the city',
  'no one does this',
  'double your customers',
  'triple your customers',
  'guaranteed',
  'guarantee',
  'risk-free',
  'act now',
  'limited time',
  'urgent',
  'exclusive offer',
  'special offer just for you',
  'we guarantee',
  '100%',
];

export interface GroundingOptions {
  bannedPhrases?: readonly string[];
  whatsappMaxChars?: number;
  emailMaxWords?: number;
}

export type ValidationFailureCode =
  | 'schema_invalid'
  | 'unknown_finding_id'
  | 'invented_number'
  | 'foreign_url'
  | 'banned_phrase'
  | 'whatsapp_too_long'
  | 'email_too_long'
  | 'empty_message';

export interface ValidationError {
  code: ValidationFailureCode;
  /** Human-readable, appended to a retry prompt so the model can self-correct. */
  message: string;
}

export interface ValidationResult {
  grounded: boolean;
  errors: ValidationError[];
}
