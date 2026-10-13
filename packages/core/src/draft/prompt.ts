import type { Language, StoredFinding } from '../db/schema.js';
import type { SenderProfile } from './fallback.js';
import { DRAFT_LIMITS } from './provider.js';

/**
 * Prompt construction.
 *
 * The prompt is the first line of defence, and the grounding validator is the
 * second. What goes into the prompt is deliberately narrow: the business name,
 * its category, the language, the top findings by weight with their evidence,
 * and the sender profile. Nothing else.
 *
 * In particular **no raw page text is ever forwarded**. A scraped page is
 * untrusted content, and pasting it into a prompt is how instruction injection
 * gets a model to write something a business owner did not ask for. The model
 * sees only these structured, tool-produced numbers.
 */

export interface PromptInput {
  businessName: string;
  category?: string | undefined;
  language: Language;
  /** Findings already ordered by importance. */
  findings: StoredFinding[];
  sender: SenderProfile;
  /** Maximum findings to include. The spec caps citations at three. */
  maxFindings?: number;
}

/** The system prompt, shared across languages and providers. */
export const SYSTEM_PROMPT = `You write short outreach messages to local business owners on behalf of a freelance web developer.

You will receive JSON containing the business name, its category, the language to write in, a small number of measured findings about its website, and the sender's profile.

Rules you must follow:
- Use only the facts provided. Never invent a number, ranking, competitor, price, or deadline.
- Cite at most three findings, and only ones whose id appears in the input.
- These are laboratory numbers from one simulated mobile device. Describe them as what you measured, never as what the visitor experiences.
- No hype, no fake urgency, no guarantees. Banned: "#1 on Google", "double your customers", "guaranteed", "act now", "limited time", "best in the city".
- Say what was measured and how, for example: "in a mobile speed test I ran, the page took 6.1 seconds to show its main content".
- Offer exactly one low-pressure next step: a short free audit report.
- The WhatsApp message is at most 450 characters. Use no emoji, or at most one.
- The email body is at most 120 words and has a clear subject line.
- Include a polite opt-out line in every message.
- If the input says the business has no website, say you could not find one. Do not describe a site that does not exist.

Return only the JSON object described in the response format. No commentary.`;

const LANGUAGE_RULES: Record<Language, string> = {
  en: 'Write in plain, simple English. Short sentences.',
  hinglish:
    'Write in natural romanized Hindi mixed with English (Hinglish). Simple words, respectful tone. Roman script only, no Devanagari.',
  hi: 'Write in Hindi using Devanagari script. Keep it natural and respectful.',
};

/**
 * The exact finding shape handed to the model.
 *
 * Only the fields a message could legitimately quote. In particular `weight` is
 * excluded: it is an internal scoring number, and a draft citing "weight 30"
 * would read as gibberish to a business owner.
 */
function toModelFinding(finding: StoredFinding) {
  return {
    id: finding.id,
    label: finding.label,
    severity: finding.severity,
    evidence: finding.evidence,
  };
}

/** Build the user message: JSON, and nothing else. */
export function buildUserPrompt(input: PromptInput): string {
  const maxFindings = input.maxFindings ?? 3;
  const top = [...input.findings]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxFindings)
    .map(toModelFinding);

  const payload = {
    business: {
      name: input.businessName,
      ...(input.category ? { category: input.category } : {}),
    },
    language: input.language,
    language_rule: LANGUAGE_RULES[input.language],
    findings: top,
    sender: {
      name: input.sender.name,
      services: input.sender.services,
      ...(input.sender.portfolioUrl ? { portfolio_url: input.sender.portfolioUrl } : {}),
    },
    limits: {
      whatsapp_max_chars: DRAFT_LIMITS.whatsappMaxChars,
      email_max_words: DRAFT_LIMITS.emailMaxWords,
    },
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * The retry prompt.
 *
 * The validation errors are appended verbatim. Telling a model precisely which
 * number was invented gives it a concrete thing to fix; a generic "try again"
 * usually produces the same failure.
 */
export function buildRetryPrompt(
  basePrompt: string,
  errors: { code: string; message: string }[],
): string {
  const listed = errors.map((error) => `- ${error.message}`).join('\n');
  return `${basePrompt}

Your previous draft was rejected. Fix every problem below and return the full JSON object again.

${listed}

Return only the corrected JSON object.`;
}

/**
 * Numbers the model is allowed to state, provided as a convenience list.
 *
 * The validator checks against these anyway. Showing them is what stops the
 * model from rounding 6100 ms into "6 seconds" and being rejected.
 */
export function buildAllowedNumberHint(findings: StoredFinding[]): string {
  const values = new Set<string>();
  for (const finding of findings) {
    for (const value of Object.values(finding.evidence)) {
      if (typeof value === 'number') values.add(String(value));
    }
  }
  return [...values].join(', ');
}
