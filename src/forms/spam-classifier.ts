import type { FormType } from "./types.js";
import type { TurnstileOutcome } from "./turnstile.js";

/**
 * A submission at or above this score is classified auto-spam by ingest.
 *
 * Lowered 100 → 60 (2026-07-15): live data showed the classifier auto-bucketed
 * essentially nothing while ~1-in-4 delivered messages were spam. The dominant
 * bypass — human-plausible Latin-script cold outreach (SEO / virtual-assistant
 * pitches) with 0-1 links — sums only 25-55 from content signals. 60 lets the
 * high-precision multi-word keyword phrases + the gibberish/bare-domain signals
 * below actually bite, while every individual new signal stays low enough that
 * none buckets alone (each needs corroboration). `spam_auto` is recoverable, so
 * a false positive is a nuisance the operator can undo, not a lost lead.
 */
export const SPAM_THRESHOLD = 60;

export type SpamVerdict = { score: number; reasons: string[] };

/**
 * Maintained spam-keyword list (case-insensitive substring match). Tunable from
 * the `spam_score` / `spam_reason` data the pipeline now records — a defensible
 * v1, not final. Keep entries specific enough to avoid false positives: where a
 * term is also legitimate business vocabulary (casino resorts, weight-loss
 * studios, transport escorts, payday lenders, backlink audits), list only the
 * clearly-promotional phrasing, never the bare term.
 */
export const SPAM_KEYWORDS: readonly string[] = [
  "viagra",
  "cialis",
  "online casino",
  "casino bonus",
  "porn",
  "payday loans online",
  "buy crypto",
  "crypto wallet",
  "bitcoin investment",
  "buy backlinks",
  "cheap seo",
  "forex signals",
  "escort girls",
  "replica watches",
  "weight loss pills",
  // Cold-outreach / SEO-pitch vertical (added 2026-07-15). Kept MULTI-WORD so they
  // stay high-precision — each is a phrase a solicitor writes, not a bare word a real
  // lead trips. Individually only +25, so a single ambiguous match ("free consultation"
  // from a genuine lead) can never reach the threshold without corroboration.
  "guest post",
  "guest article",
  "link building",
  "first page of google",
  "page one of google",
  "google ranking",
  "rank higher",
  "increase your traffic",
  "drive traffic",
  "position your brand",
  "above competitors",
  "within 24 hours",
  "virtual assistant",
  "free consultation",
  "no obligation",
  "would you be interested",
  "seo problem",
];

/** Maintained disposable / throwaway email domains. */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "trashmail.com",
  "yopmail.com",
  "sharklasers.com",
  "getnada.com",
  "throwawaymail.com",
  "maildrop.cc",
];

// A URL candidate ends at whitespace, `,` or `;` so comma/semicolon-glued
// URLs ("a.com,b.com") count individually instead of matching as one.
const URL_RE = /https?:\/\/[^\s,;]+|www\.[^\s,;]+/gi;
const LINK_MARKUP_RE = /<a\s[^>]*href|\[url[=\]]/i;
const ONLY_URL_RE = /^(https?:\/\/\S+|www\.\S+)$/i;

/** Count of bare http(s)/www URLs in a string. */
function countUrls(text: string): number {
  return (text.match(URL_RE) ?? []).length;
}

/** How many maintained keywords appear (each counted once). */
function countKeywordHits(text: string): number {
  const lower = text.toLowerCase();
  return SPAM_KEYWORDS.filter((kw) => lower.includes(kw)).length;
}

/** Fraction of letters that are outside the Latin script (0..1). */
function nonLatinRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  return nonLatin / letters.length;
}

/** Domain part of an email, lowercased; "" when unparseable. */
function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1
    ? ""
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/** len > 20 and > 70% of its letters uppercase. */
function isAllCaps(text: string): boolean {
  if (text.length <= 20) return false;
  const letters = text.match(/[a-zA-Z]/g) ?? [];
  if (letters.length === 0) return false;
  const upper = letters.filter((c) => c >= "A" && c <= "Z").length;
  return upper / letters.length > 0.7;
}

/**
 * True when `text` has a run of >= `minLen` ASCII letters containing >= 5 CONSECUTIVE
 * consonants — the signature of a random keyboard-mash token (`zddDVjhArCJ`, `OsDMQohNGefh`).
 * Consecutive-consonant count is the discriminator, NOT a vowel ratio: real English words
 * (even long consonant-clustered ones like "investment"/"strengthens") stay at or below 4
 * consecutive consonants, so normal prose never trips this, while a mashed token blows past
 * 5. LATIN a-z ONLY: a native-script name (王小明, Владимир) has no a-z letters here and is
 * never flagged — that is the non-latin signal's job, deliberately de-weighted so a real
 * foreign name isn't spam. (`y` is treated as a consonant here — conservative for detection,
 * and it only ever adds a name-path +35 that cannot bucket on its own.)
 */
function hasGibberishToken(text: string, minLen: number): boolean {
  for (const run of text.match(/[A-Za-z]+/g) ?? []) {
    if (run.length >= minLen && /[^aeiouAEIOU]{5,}/.test(run)) return true;
  }
  return false;
}

// A domain-like token with a known TLD but NO scheme/`www` (those are already caught by
// URL_RE). The leading `(?<![@\w.])` excludes an email's domain (`a@foo.com`), a
// sub-label continuation, and file-ish `name.ext` runs. Curated TLD set keeps it from
// firing on `node.js` / `index.html`. Used only when no real URL was found.
const BARE_DOMAIN_RE =
  /(?<![@\w.])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|io|co|biz|info|online|site|shop|store|xyz|agency|digital|marketing|dev|app)\b/i;

/**
 * Pure content spam scorer. Folds message/name/email content signals plus the
 * Turnstile verdict into a numeric score with human-readable reason strings.
 * Never throws; `formType` is accepted for future per-type tuning.
 */
export function classifySpam(input: {
  name: string;
  email: string;
  message?: string;
  formType: FormType;
  extraFields: Record<string, unknown>;
  turnstile: TurnstileOutcome;
}): SpamVerdict {
  const name = input.name ?? "";
  const email = input.email ?? "";
  const message = input.message ?? "";
  const reasons: string[] = [];
  let score = 0;

  // Site-specific free-text fields (e.g. extra.comments) carry the same spam
  // signals as message — fold every STRING extraFields value into the scanned
  // body so a site with a custom "comments"/"details" field isn't a blind spot.
  // Non-string values (numbers, booleans, nested objects) are ignored.
  const extraText = Object.values(input.extraFields ?? {})
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  const body = extraText ? `${message} ${extraText}` : message;

  // 50: post-#400 a "fail" is a FORGED token (invalid-input-response), near-certainly a
  // bot — but kept below the 60 threshold so a forged token alone still needs one
  // corroborating content signal before auto-bucketing (fail-open caution). A benign
  // human never reaches here: expired/duplicate tokens are "unverifiable", not "fail".
  if (input.turnstile === "fail") {
    score += 50;
    reasons.push("turnstile-fail");
  }

  const urls = countUrls(body);
  if (urls > 0) {
    // Capped at 2 (max +50) so a genuine lead pasting two links (site + portfolio) stays
    // under 60 on URLs alone; a third adds nothing. 25/link keeps one link well shy of a
    // solo bucket.
    score += Math.min(urls, 2) * 25;
    reasons.push(`links:${urls}`);
  } else if (BARE_DOMAIN_RE.test(body)) {
    // No real http/www URL, but a bare "brand.com" is pasted — the exact dodge spammers
    // use to slip past URL_RE. +20, needs corroboration to bucket.
    score += 20;
    reasons.push("bare-domain");
  }

  if (LINK_MARKUP_RE.test(body)) {
    score += 40;
    reasons.push("link-markup");
  }

  const keywords = countKeywordHits(body);
  if (keywords > 0) {
    score += Math.min(keywords, 3) * 25;
    reasons.push(`keywords:${keywords}`);
  }

  // Body only — a native-script NAME (王小明, Владимир) is not a spam signal.
  // 25 (not 50): non-Latin alone must need corroboration from other signals
  // before it can reach SPAM_THRESHOLD.
  if (nonLatinRatio(body) > 0.3) {
    score += 25;
    reasons.push("non-latin");
  }

  // Random keyboard-mash tokens (form-filler bots): body is the strong tell (+35); the
  // NAME corroborates only under a stricter rule (single token, >=12 chars) so a real
  // consonant-heavy surname (Krzysztofowicz) adds at most 35 — never enough to bucket on
  // its own. A bot with both name and body mashed sums 70 and is caught.
  if (hasGibberishToken(body, 10)) {
    score += 35;
    reasons.push("gibberish-body");
  }
  if (!name.trim().includes(" ") && hasGibberishToken(name, 12)) {
    score += 35;
    reasons.push("gibberish-name");
  }

  if (DISPOSABLE_EMAIL_DOMAINS.includes(emailDomain(email))) {
    score += 45;
    reasons.push("disposable-email");
  }

  if (countUrls(name) > 0) {
    score += 45;
    reasons.push("url-in-name");
  }

  const trimmedMsg = body.trim();
  const degenerate =
    (trimmedMsg.length > 0 && trimmedMsg === name.trim()) || ONLY_URL_RE.test(trimmedMsg);
  if (degenerate) {
    score += 40;
    reasons.push("degenerate");
  }

  if (isAllCaps(body)) {
    score += 15;
    reasons.push("all-caps");
  }

  return { score, reasons };
}
