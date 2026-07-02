import type { FormType } from "./types.js";
import type { TurnstileOutcome } from "./turnstile.js";

/** A submission at or above this score is classified auto-spam by ingest. */
export const SPAM_THRESHOLD = 100;

export type SpamVerdict = { score: number; reasons: string[] };

/**
 * Maintained spam-keyword list (case-insensitive substring match). Tunable from
 * the `spam_score` / `spam_reason` data the pipeline now records — a defensible
 * v1, not final. Keep entries specific enough to avoid false positives.
 */
export const SPAM_KEYWORDS: readonly string[] = [
  "viagra",
  "cialis",
  "casino",
  "porn",
  "payday loan",
  "buy crypto",
  "crypto wallet",
  "bitcoin investment",
  "backlinks",
  "cheap seo",
  "forex signals",
  "escort",
  "replica watches",
  "weight loss",
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

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
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

  if (input.turnstile === "fail") {
    score += 70;
    reasons.push("turnstile-fail");
  }

  const urls = countUrls(body);
  if (urls > 0) {
    score += Math.min(urls, 3) * 30;
    reasons.push(`links:${urls}`);
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

  if (nonLatinRatio(body) > 0.3 || nonLatinRatio(name) > 0.3) {
    score += 50;
    reasons.push("non-latin");
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
