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
 * below actually bite. No single signal buckets alone (each needs corroboration),
 * with ONE deliberate exception: lorem-ipsum filler (+60) is machine-generated
 * content with zero genuine use. `spam_auto` is recoverable, so a false positive
 * is a nuisance the operator can undo, not a lost lead.
 */
export const SPAM_THRESHOLD = 60;

export type SpamVerdict = { score: number; reasons: string[] };

/**
 * Maintained SELLER-VOICE spam-keyword list (case-insensitive substring match on
 * hyphen-normalized text — see countKeywordHits). Tunable from the `spam_score` /
 * `spam_reason` data the pipeline records. Keep entries specific enough to avoid
 * false positives: where a term is also legitimate business vocabulary (casino
 * resorts, weight-loss studios, transport escorts, payday lenders), list only the
 * clearly-promotional phrasing, never the bare term.
 *
 * SEO/marketing-topic policy (operator decision 2026-07-15): the fleet's sites are
 * niche and specific — they rank top for their own names — and clients who want
 * SEO/marketing help ask the agency DIRECTLY, so SEO-topic content arriving through
 * a public contact form is near-always solicitation. SEO-topic phrases therefore
 * live HERE at full weight (an SEO-help ask through the form is deliberately
 * filtered; `spam_auto` is recoverable and the operator prefers hand-delivering the
 * rare real one over receiving the flood). Each entry is +30, so TWO seller phrases
 * bucket; no single phrase can (max single non-lorem signal is turnstile-fail's 50).
 *
 * NOTE: entries must not be substrings of each other ("page one" + "page one of
 * google" would double-count one occurrence) and must be written hyphen-free (the
 * matcher folds `-–—` to spaces, so "link-building" in a message matches
 * "link building" here).
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
  "cheap seo",
  "forex signals",
  "escort girls",
  "replica watches",
  "weight loss pills",
  // Cold-outreach / SEO-pitch vertical (2026-07-15, expanded from the live miss
  // corpus the same day). Multi-word and solicitation-shaped: a real lead describing
  // their OWN site/needs occasionally grazes one of these, but never two.
  "guest post",
  "guest article",
  "article for your website",
  "link building",
  "backlinks",
  "page one", // "You're not on page one. Your competitors are." (covers "page one of google" too)
  "first page", // covers "first page of google"
  "1st page", // "The Wiki links show up on the 1st page of Google 97% of the time"
  "google ranking",
  "rank higher",
  "drive traffic",
  "increase your traffic",
  "top of search results",
  "people already searching",
  "seo problem",
  "seo process", // "no long SEO process, no delay"
  "leads and sales",
  "position your brand",
  "above competitors",
  "businesses like yours",
  "no obligation",
  "would you be interested",
  "would you be open",
  "tried emailing you", // the "I tried emailing you, but it seems it didn't go through" opener
  // Virtual-assistant flood (MAVIS et al. — rotating sender names/domains with
  // reworded bodies, so the exact-duplicate velocity signal can't see it; these are
  // the template's invariants).
  "virtual assistant",
  "virtual intelligent system", // "MAVIS (My Advanced Virtual Intelligent System)" — in every copy
  "mavis",
  "overtake and handle",
  "custom built ai", // matches "custom-built AI" via hyphen folding
  // Wikipedia-page-creation vertical.
  "wikipedia page",
  "wiki links",
  // Product-blast ad copy (the dog-harness family).
  "get yours today",
  "free shipping",
];

/**
 * BUYER-COMPATIBLE outreach phrases: common in cold pitches but also plausible in a
 * genuine prospect's own words ("do you offer a free consultation?", "we need it
 * within 24 hours"). Alone they score a weak +10 (capped at 2 hits / +20) so they
 * can never carry a message toward the threshold — but when at least one
 * seller-voice phrase is present the message is demonstrably a pitch, and these
 * PROMOTE to full keyword weight as corroboration.
 */
export const BUYER_KEYWORDS: readonly string[] = ["within 24 hours", "free consultation"];

/**
 * Sender domains where EVERY submission the fleet has ever received was spam.
 *
 * A second, stricter tier than DISPOSABLE_EMAIL_DOMAINS. The disposable list says
 * "a throwaway provider — be suspicious", so it scores a corroborating +45 and
 * cannot bucket alone. This list says "we have looked at the traffic from this
 * domain and there is no legitimate traffic", so it buckets on its own.
 *
 * Why the weaker tier was not enough (the case that created this list): 17
 * submissions arrived from `jmailservice.com` between 2026-06-17 and 2026-08-25
 * across FOUR unrelated client sites, none legitimate — and 10 of them were
 * emailed to the operator. They dodged every existing signal in turn:
 *
 * - the content scorer, because the bodies vary and most sum under 60 (the last
 *   two scored 30 and 0);
 * - the cross-site `repeat-sender` signal, because the sender rotates a plausible
 *   `firstname.lastname@` local part — 11 distinct addresses across 17 sends, so
 *   the email-exact lookup almost never saw a repeat;
 * - and the disposable list's +45, which even if the domain were listed there
 *   would have bucketed only the 5 sends that already carried a corroborating
 *   signal, and none of the ones that reached the inbox.
 *
 * The rotation is the point: the identity changes every time, the DOMAIN does not.
 *
 * ENTRY BAR — this list is deliberately hard to add to, because it is the only
 * signal with no corroboration requirement:
 *
 * 1. Query the live traffic for the domain and read EVERY row. Not a sample.
 * 2. Every one must be spam. One genuine lead disqualifies the domain — put it on
 *    the disposable list instead, where it needs corroboration.
 * 3. Never list a shared mailbox provider (gmail.com, outlook.com, a webmail host,
 *    an ISP domain). Those carry real leads by definition, and a single entry here
 *    would silently bucket every genuine lead using it.
 *
 * Matching is by registrable domain OR any subdomain of it, so a move to
 * `mail.<domain>` does not reopen the hole. Entries must be bare lowercase
 * domains; `spam-classifier.test.ts` enforces the shape and that no domain
 * appears on both lists.
 */
export const BLOCKED_EMAIL_DOMAINS: readonly string[] = [
  // 17/17 spam, 2026-06-17 → 2026-08-25, across four unrelated sites: MSOT (5),
  // Reddoor's own site (5), Vineyard Custom Homes (4), Espada (3). Rotating
  // `firstname.lastname@` sender identities — 11 addresses over those 17 sends.
  "jmailservice.com",

  // The MAVIS virtual-assistant flood, whose body invariants already sit in
  // SPAM_KEYWORDS ("mavis", "virtual intelligent system", "tried emailing you").
  // Seven sender domains, 35 submissions, 2026-06-17 → 2026-08-25, every one a VA
  // pitch and 12 of them emailed to the operator. Each domain rotates first-name
  // identities across unrelated client sites exactly as jmailservice.com does, so
  // the email-exact repeat-sender signal cannot see the pattern. Counts are
  // sends/addresses at the time of listing.
  "trustedvirtualteam.com", // 9 / 5
  "toptalentvas.com", // 7 / 4
  "virtualhandsupport.com", // 5 / 4
  "vas4hire.com", // 4 / 2
  "vettedvas.com", // 4 / 3
  "thevirtualassistanthub.net", // 3 / 2
  "yourvachoice.com", // 3 / 1

  // DELIBERATELY NOT LISTED, checked 2026-08-26 — both would pass a naive
  // "100% of its submissions are spam" query, which is why rule 1 says read the
  // rows rather than trust the ratio:
  //
  // - lemos.com — 10/10 "spam", and all ten are the OPERATOR's own landing-page
  //   test submissions from tucker@lemos.com. Blocking it would bucket his own
  //   testing.
  // - melottogroup.com — 3/3 genuine cold outreach, but one fixed address with no
  //   rotation, which repeat-sender already catches. Nothing to add.
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

/** How many of `keywords` appear in `text` (each counted once). Hyphens/dashes fold
 *  to spaces first so "link-building" / "custom-built AI" match their space-separated
 *  list entries — the hyphenated spelling was a live keyword dodge. */
function countKeywordHits(text: string, keywords: readonly string[]): number {
  const lower = text.toLowerCase().replace(/[-–—]/g, " ");
  return keywords.filter((kw) => lower.includes(kw)).length;
}

/** Distinct lorem-ipsum vocabulary stems. Form-tester bots submit truncated filler
 *  ("Velit ullam reprehen", "Dolore harum volupta") — too short for the velocity
 *  signal and invisible to gibberish (they're real Latin words). Two DISTINCT stems
 *  are required so a lone romance-language cognate (voluptuous, tempora) can never
 *  fire; no human writes two lorem-ipsum words in a genuine inquiry. */
const LOREM_STEMS: readonly RegExp[] = [
  /\blorem\b/i,
  /\bipsum\b/i,
  /\bvelit\b/i,
  /\bullam/i,
  /\bharum\b/i,
  /\breprehen/i,
  /\bvolupt/i,
  /\bnostrud\b/i,
  /\badipisc/i,
  /\beiusmod\b/i,
  /\bincididunt\b/i,
  /\bconsectetur\b/i,
  /\baliqua\b/i,
];

function countLoremStems(text: string): number {
  return LOREM_STEMS.filter((re) => re.test(text)).length;
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

/**
 * True when `domain` is a blocked sender domain or any subdomain of one.
 *
 * Suffix-matched on a label boundary, so `mail.jmailservice.com` is blocked while
 * `notjmailservice.com` (an unrelated registration that merely ends in the same
 * letters) is not. `domain` is already lowercased by emailDomain().
 */
function isBlockedDomain(domain: string): boolean {
  if (domain === "") return false;
  return BLOCKED_EMAIL_DOMAINS.some((b) => domain === b || domain.endsWith(`.${b}`));
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
 * True when `text` has a token of >= `minLen` ASCII letters that looks like random
 * keyboard mash, via EITHER of two discriminators (measured 2026-07-15 against
 * /usr/share/dict/words + the live mash corpus — each alone misses live samples the
 * other catches, and together they flag ZERO dictionary words or common brand names):
 *
 * 1. A run of >= 7 consecutive non-vowels, with `y` counted as a VOWEL
 *    (`OsDMQohNGefhfCqqQCwr` has a 10-run, `zddDVjhArCJ` a 7-run). The original
 *    >=5-with-y-as-consonant rule fired on ordinary English — every psych* word
 *    >= 10 letters (p-s-y-c-h is itself a 5-run), "worthwhile", "nightclubs",
 *    3,138 dictionary words in all — i.e. gibberish(+35) + one pasted link(+25)
 *    silently bucketed whole genuine-lead verticals (a psychology practice!).
 * 2. >= 3 interior lower→upper case flips (`IjIiJuhkojCYrNDFTXe`, `XiwkUDgrboTgMSVX`
 *    — live samples whose longest y-as-vowel run is only 6). Real CamelCase tokens
 *    (JavaScript, SquareSpace, MailChimp) have at most 1-2 humps.
 *
 * LATIN a-z ONLY: a native-script name (王小明, Владимир) has no a-z letters here and
 * is never flagged — that is the non-latin signal's job, deliberately de-weighted so
 * a real foreign name isn't spam.
 */
function hasGibberishToken(text: string, minLen: number): boolean {
  for (const run of text.match(/[A-Za-z]+/g) ?? []) {
    if (run.length < minLen) continue;
    if (/[^aeiouyAEIOUY]{7,}/.test(run)) return true;
    let flips = 0;
    for (let i = 1; i < run.length; i++) {
      const prev = run[i - 1]!;
      const cur = run[i]!;
      if (prev >= "a" && prev <= "z" && cur >= "A" && cur <= "Z") flips++;
    }
    if (flips >= 3) return true;
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

  // Two-tier keywords. Seller-voice phrases are unambiguous pitch language: +30
  // each (capped at 3 hits / +90) — TWO seller phrases bucket outright, per the
  // operator's 2026-07-15 steer (see the SPAM_KEYWORDS docstring): genuine leads on
  // this fleet write zero solicitor phrases, and SEO/marketing-help asks through
  // the public form are deliberately filtered. A seller hit also PROMOTES any
  // buyer-compatible phrases in the same message to full weight — a pitch that says
  // "would you be interested" AND "within 24 hours" is corroborating itself.
  // WITHOUT a seller-voice phrase, buyer-compatible hits alone score a weak +10
  // capped at +20, never enough to carry a message toward the threshold.
  const seller = countKeywordHits(body, SPAM_KEYWORDS);
  const buyer = countKeywordHits(body, BUYER_KEYWORDS);
  if (seller > 0) {
    const hits = seller + buyer;
    score += Math.min(hits, 3) * 30;
    reasons.push(`keywords:${hits}`);
  } else if (buyer > 0) {
    score += Math.min(buyer, 2) * 10;
    reasons.push(`keywords-buyer:${buyer}`);
  }

  // Lorem-ipsum form-tester bots: >=2 distinct filler stems is machine-generated
  // content with zero genuine use, so this is the one signal allowed to bucket
  // alone (+60) — the bodies are too short for the velocity signal and are real
  // Latin words, invisible to the gibberish detector.
  if (countLoremStems(body) >= 2) {
    score += 60;
    reasons.push("lorem-ipsum");
  }

  // Body only — a native-script NAME (王小明, Владимир) is not a spam signal.
  // 25 (not 50): non-Latin alone must need corroboration from other signals
  // before it can reach SPAM_THRESHOLD.
  if (nonLatinRatio(body) > 0.3) {
    score += 25;
    reasons.push("non-latin");
  }

  // Random keyboard-mash tokens (form-filler bots): body is the strong tell (+35); the
  // NAME corroborates only under a stricter rule (single token, >=12 chars). A real
  // consonant-heavy surname (Krzysztofowicz — max 3-run with y as vowel) no longer trips
  // at all under the 7-run rule. A bot with both name and body mashed sums 70 and is caught.
  if (hasGibberishToken(body, 10)) {
    score += 35;
    reasons.push("gibberish-body");
  }
  if (!name.trim().includes(" ") && hasGibberishToken(name, 12)) {
    score += 35;
    reasons.push("gibberish-name");
  }

  const domain = emailDomain(email);

  // A domain proven to send only spam buckets ALONE. Scored as SPAM_THRESHOLD
  // rather than a literal so the property survives a future threshold change:
  // this signal is defined as "enough on its own", not as "worth 60 points".
  // See the BLOCKED_EMAIL_DOMAINS docstring for the (deliberately high) bar an
  // entry has to clear.
  if (isBlockedDomain(domain)) {
    score += SPAM_THRESHOLD;
    reasons.push("blocked-domain");
  }

  if (DISPOSABLE_EMAIL_DOMAINS.includes(domain)) {
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
