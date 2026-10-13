import type { Language, StoredFinding } from '../db/schema.js';
import { DRAFT_LIMITS } from './provider.js';

/**
 * Deterministic fallback templates.
 *
 * When the model drifts twice, a Localscout user still gets a message they can
 * send. That message is assembled here from the audit's own numbers, so it is
 * grounded by construction rather than by the validator rescuing it.
 *
 * Two template families exist, because the honest opening is different:
 *
 * - A business with **no website** gets "I could not find a website for you".
 *   Claiming anything about a site that does not exist would be nonsense.
 * - A business with a **website** gets the measured problems, named plainly.
 *
 * Templates never invent a number. Every placeholder is filled from a finding's
 * own evidence, and the caller passes the allowlist that proves it.
 */

export interface SenderProfile {
  name: string;
  portfolioUrl?: string | undefined;
  services: string;
}

export interface FallbackInput {
  businessName: string;
  findings: StoredFinding[];
  language: Language;
  sender: SenderProfile;
}

export interface FallbackDraft {
  whatsapp: string;
  email_subject: string;
  email_body: string;
  used_finding_ids: string[];
}

/** The opt-out line, required in every language. */
const OPT_OUT = {
  en: 'If you would rather not hear from me, reply STOP and I will not message again.',
  hinglish:
    'Agar aap nahi chahte hain ki main message karun, toh STOP reply kar dijiye, main dobara nahi likhunga.',
  hi: 'यदि आप नहीं चाहते कि मैं संदेश भेजूँ, तो कृपया STOP उत्तर दें, मैं दोबारा संदेश नहीं भेजूँगा।',
} as const;

/** The single low-pressure next step, identical in intent across languages. */
const NEXT_STEP = {
  en: 'If it is useful, I can send a free audit report with the full details.',
  hinglish: 'Agar aapko faida ho, toh main poora audit report free bhej sakta hoon.',
  hi: 'यदि आपको उपयोग हो, तो मैं पूरा ऑडिट रिपोर्ट निःशुल्क भेज सकता हूँ।',
} as const;

const NO_SITE_OPENING = {
  en: (name: string) =>
    `Namaste ${name}, I looked for a website for your business and could not find one.`,
  hinglish: (name: string) =>
    `Namaste ${name}, maine aapke business ki website dhundhi aur koi website nahi mili.`,
  hi: (name: string) =>
    `नमस्ते ${name}, मैंने आपके व्यवसाय की वेबसाइट खोजी और कोई वेबसाइट नहीं मिली।`,
} as const;

/**
 * Plain-English phrasing for the finding a message should lead with.
 *
 * A phrasing is either a fixed string, or a function taking the measured values
 * it needs. The function form exists so a number is interpolated from the audit
 * rather than written into the template.
 */
type Phrasing = string | ((...values: string[]) => string);

const FINDING_PHRASES: Record<string, { en: Phrasing; hinglish: Phrasing; hi: Phrasing }> = {
  SITE_UNREACHABLE: {
    en: 'your website did not load when I tried to open it',
    hinglish: 'aapki website mere kholne par load nahi hui',
    hi: 'मैंने आपकी वेबसाइट खोलने की कोशिश की, लेकिन वह लोड नहीं हुई।',
  },
  NO_HTTPS: {
    en: 'your website is not using a secure https connection',
    hinglish: 'aapki website secure https connection use nahi kar rahi hai',
    hi: 'आपकी वेबसाइट सुरक्षित https कनेक्शन का उपयोग नहीं कर रही है।',
  },
  NOT_MOBILE_READY: {
    en: 'your website is not set up for phones, so it is hard to use on mobile',
    hinglish: 'aapki website phone ke liye set up nahi hai, mobile par use karna mushkil hai',
    hi: 'आपकी वेबसाइट फ़ोन के लिए सेट नहीं है, इसलिए मोबाइल पर उपयोग करना कठिन है।',
  },
  SLOW_LCP: {
    en: (lcp: string) =>
      `in a mobile speed test I ran, the page took ${lcp} seconds to show its main content`,
    hinglish: (lcp: string) =>
      `mobile speed test mein, page ko main content dikhane mein ${lcp} seconds lage`,
    hi: (lcp: string) =>
      `मैंने मोबाइल स्पीड टेस्ट में मापा कि पेज को अपना मुख्य कंटेंट दिखाने में ${lcp} सेकंड लगे।`,
  },
  HIGH_TBT: {
    en: (tbt: string) => `the page blocked for ${tbt} ms waiting for code to run`,
    hinglish: (tbt: string) => `code chalne ka wait karte hue page ${tbt} ms block hua`,
    hi: (tbt: string) => `कोड चलने की प्रतीक्षा में पेज ${tbt} ms तक अवरुद्ध रहा।`,
  },
  LAYOUT_SHIFT: {
    en: (cls: string) => `the page content jumped around while loading (a shift score of ${cls})`,
    hinglish: (cls: string) => `loading ke dauran page ka content hilta raha (shift score ${cls})`,
    hi: (cls: string) => `लोड होते समय पेज का कंटेंट इधर-उधर हिलता रहा (शिफ़्ट स्कोर ${cls})।`,
  },
  LOW_PERF_SCORE: {
    en: (score: string) =>
      `Lighthouse gave the page a speed score of ${score} out of 100 on mobile`,
    hinglish: (score: string) =>
      `Lighthouse ne mobile par page ko 100 mein se ${score} speed score diya`,
    hi: (score: string) => `Lighthouse ने मोबाइल पर पेज को 100 में से ${score} स्पीड स्कोर दिया।`,
  },
  MISSING_META_DESCRIPTION: {
    en: 'your page has no description text for search results',
    hinglish: 'aapke page par search results ke liye description text nahi hai',
    hi: 'आपके पेज पर सर्च परिणामों के लिए विवरण टेक्स्ट नहीं है।',
  },
  MISSING_TITLE: {
    en: 'your page title is a generic word with no business name',
    hinglish: 'aapke page ka title ek aam shabd hai, business ka naam nahi hai',
    hi: 'आपके पेज का टाइटल एक सामान्य शब्द है, व्यवसाय का नाम नहीं है।',
  },
  NO_TAP_TO_CALL: {
    en: 'there is no tap-to-call button on the site, so calling from a phone takes extra steps',
    hinglish:
      'site par tap-to-call button nahi hai, phone par call karne ke liye extra steps lagte hain',
    hi: 'साइट पर टैप-टू-कॉल बटन नहीं है, फ़ोन से कॉल करने के लिए अतिरिक्त कदम लगते हैं।',
  },
  NO_WHATSAPP_LINK: {
    en: 'there is no WhatsApp button on the site',
    hinglish: 'site par WhatsApp button nahi hai',
    hi: 'साइट पर WhatsApp बटन नहीं है।',
  },
};

/**
 * The order a message should lead with.
 *
 * A concrete measured problem leads, because "the page took 6.1 seconds" is
 * something a business owner recognises immediately, while "not mobile ready"
 * is a category they may not know the name of.
 */
const PRIORITY = [
  'SITE_UNREACHABLE',
  'SLOW_LCP',
  'NOT_MOBILE_READY',
  'LOW_PERF_SCORE',
  'NO_HTTPS',
  'HIGH_TBT',
  'NO_TAP_TO_CALL',
  'LAYOUT_SHIFT',
  'MISSING_META_DESCRIPTION',
  'MISSING_TITLE',
  'NO_WHATSAPP_LINK',
];

const MAX_CITATIONS = 3;

/** Format a measured value the way a person would say it. */
function evidenceNumber(finding: StoredFinding, key: string): string | undefined {
  const value = finding.evidence[key];
  if (typeof value !== 'number') return undefined;
  // Milliseconds are more readable in seconds when stating a load time.
  if (key === 'lcp_ms') return (value / 1000).toFixed(1);
  return String(value);
}

/**
 * Render the plain-language sentence for one finding.
 *
 * Falls back to the catalog label when a finding has no recorded number, so a
 * sentence never appears with an empty placeholder. The arity of the phrasing
 * function decides how many values it receives; passing an object instead
 * stringifies to "[object Object]" in the message.
 */
function phraseFor(finding: StoredFinding, language: Language): string {
  const template = FINDING_PHRASES[finding.id];
  if (!template) return finding.label;

  const phrasing = template[language];
  if (typeof phrasing === 'string') return phrasing;

  const values = [
    evidenceNumber(finding, 'lcp_ms') ?? '',
    evidenceNumber(finding, 'tbt_ms') ?? '',
    evidenceNumber(finding, 'cls') ?? '',
    evidenceNumber(finding, 'perf_score') ?? '',
  ];

  // A phrasing that asks for more values than were measured must not print an
  // empty gap, so it falls back to the plain label.
  const needed = phrasing.length;
  if (values.slice(0, needed).some((value) => value === '')) {
    return finding.label;
  }

  return phrasing(...values.slice(0, needed));
}

/**
 * Used when the audit found nothing.
 *
 * There is no problem to report, so the message says so plainly and offers the
 * report without claiming anything is wrong.
 */
const NO_FINDINGS = {
  en: {
    opening: (name: string) => `Hello ${name}, I ran a quick check of your website.`,
    body: 'I did not find anything broken, so there is no problem to report.',
    next: 'If you would like the full report anyway, I can send it.',
    subject: 'Your website check',
  },
  hinglish: {
    opening: (name: string) => `Namaste ${name}, maine aapki website ka ek quick check kiya.`,
    body: 'Koi kuch kharab nahi mila, isliye koi problem report karne ko nahi hai.',
    next: 'Phir bhi agar pura report chahiye toh main bhej sakta hoon.',
    subject: 'Aapki website check',
  },
  hi: {
    opening: (name: string) => `नमस्ते ${name}, मैंने आपकी वेबसाइट का एक त्वरित जाँच किया।`,
    body: 'मुझे कुछ भी खराब नहीं मिला, इसलिए रिपोर्ट करने को कोई समस्या नहीं है।',
    next: 'फिर भी यदि आपको पूरी रिपोर्ट चाहिए तो मैं भेज सकता हूँ।',
    subject: 'आपकी वेबसाइट जाँच',
  },
} as const;

const SENDER_INTRO = {
  en: (sender: SenderProfile) => `I am ${sender.name}, I build ${sender.services}.`,
  hinglish: (sender: SenderProfile) =>
    `Main ${sender.name} hoon, main ${sender.services} banata hoon.`,
  hi: (sender: SenderProfile) => `मैं ${sender.name} हूँ, मैं ${sender.services} बनाता हूँ।`,
} as const;

/**
 * The portfolio line.
 *
 * Returned without a trailing period on purpose: appending punctuation to a URL
 * produces "https://aditya.example/." which is a different string, and the
 * grounding validator correctly rejects it as a foreign URL.
 */
const PORTFOLIO_LINE = {
  en: (url: string) => ` My work: ${url}`,
  hinglish: (url: string) => ` Mera kaam: ${url}`,
  hi: (url: string) => ` मेरा काम: ${url}`,
} as const;

/** Numbered list of findings, punctuated per language. */
function buildList(problems: string[], language: Language): string {
  const joiner = language === 'hi' ? ' ' : '. ';
  const terminator = language === 'hi' ? '।' : '';
  return problems
    .map((problem, index) => `${index + 1}. ${problem}${terminator}`)
    .join(joiner)
    .replace(/।\s*।/g, '।')
    .trim();
}

function buildOpeningWithWebsite(businessName: string, language: Language): string {
  if (language === 'hi') {
    return `${businessName} के लिए नमस्ते, मैंने आपकी वेबसाइट ऑडिट की और कुछ बातें मिलीं:`;
  }
  if (language === 'hinglish') {
    return `${businessName} ke liye namaste, maine aapki website audit ki aur kuch baatein mili:`;
  }
  return `Hello ${businessName}, I audited your website and found a few things:`;
}

/**
 * Build a fallback draft.
 *
 * Deterministic: the same audit and profile always produce the same text, which
 * is what makes it safe to use when the model has already failed twice.
 */
export function buildFallbackDraft(input: FallbackInput): FallbackDraft {
  const { businessName, findings, language, sender } = input;

  const hasWebsite = !findings.some((finding) => finding.id === 'NO_WEBSITE');

  const ordered = [...findings].sort((a, b) => {
    const rankA = PRIORITY.indexOf(a.id);
    const rankB = PRIORITY.indexOf(b.id);
    return (rankA === -1 ? 99 : rankA) - (rankB === -1 ? 99 : rankB);
  });

  const cited = ordered.slice(0, MAX_CITATIONS);
  const usedFindingIds = cited.map((finding) => finding.id);

  const problems = cited.map((finding) => phraseFor(finding, language));
  const intro = SENDER_INTRO[language](sender);

  const portfolioLink = sender.portfolioUrl;
  const listText = buildList(problems, language);
  const openingText = hasWebsite
    ? buildOpeningWithWebsite(businessName, language)
    : NO_SITE_OPENING[language](businessName);

  let whatsapp: string;
  let emailSubject: string;
  let emailBody: string;

  if (findings.length === 0) {
    // Nothing was measured, so there is nothing to pitch. Producing a message
    // that says "I found a few things:" and then lists none would be dishonest
    // and would read as broken to the recipient.
    const line = NO_FINDINGS[language];
    whatsapp = `${line.opening(businessName)} ${line.body} ${line.next} ${OPT_OUT[language]}`;
    emailSubject = line.subject;
    emailBody = `${line.opening(businessName)}\n\n${line.body}\n\n${line.next}${
      portfolioLink ? PORTFOLIO_LINE[language](portfolioLink) : ''
    }\n\n${OPT_OUT[language]}`;
  } else if (!hasWebsite) {
    whatsapp = `${openingText} ${intro}${NEXT_STEP[language]} ${OPT_OUT[language]}`;
    emailSubject =
      language === 'hi'
        ? 'आपकी वेबसाइट के बारे में'
        : language === 'hinglish'
          ? 'Aapni website ke baare mein'
          : 'About your business online';

    emailBody = `${openingText}\n\n${intro}\n${NEXT_STEP[language]}${
      portfolioLink ? PORTFOLIO_LINE[language](portfolioLink) : ''
    }\n\n${OPT_OUT[language]}`;
  } else {
    const withoutLink = `${openingText} ${listText}. ${NEXT_STEP[language]} ${OPT_OUT[language]}`;
    const withLink = portfolioLink
      ? `${withoutLink.slice(0, -OPT_OUT[language].length - 1)}${PORTFOLIO_LINE[language](
          portfolioLink,
        )} ${OPT_OUT[language]}`
      : withoutLink;

    // The opt-out line and the measured finding matter more than a portfolio
    // link, so the link is dropped from WhatsApp when it would push the message
    // past the limit. The email always carries it.
    whatsapp = withLink.length <= DRAFT_LIMITS.whatsappMaxChars ? withLink : withoutLink;

    emailSubject =
      language === 'hi'
        ? `आपकी वेबसाइट ऑडिट में ${cited.length} बातें`
        : language === 'hinglish'
          ? `Aapni website audit mein ${cited.length} baatein`
          : `${cited.length} things I found on your website`;

    emailBody = `${openingText}\n\n${listText}.\n\n${NEXT_STEP[language]}${
      portfolioLink ? PORTFOLIO_LINE[language](portfolioLink) : ''
    }\n\n${OPT_OUT[language]}`;
  }

  return {
    whatsapp: whatsapp.replace(/\s+/g, ' ').trim(),
    email_subject: emailSubject.trim(),
    email_body: emailBody.trim(),
    used_finding_ids: usedFindingIds,
  };
}
