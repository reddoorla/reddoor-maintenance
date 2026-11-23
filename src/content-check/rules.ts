// What counts as hard-coded visitor-facing content (P1-120 phase 2).
//
// The kinds are the phase-1 census's (workspace
// `audits/2026-11-21-p1-120-hardcoded-content-census/report.md`), so a row here
// and a row there mean the same thing. The census's `other` kind is folded into
// `copy`: the check has no way to tell "a listing" from prose, and both warn.
//
// Everything here is a pure function of a string or a name, so the scanner
// (`scan.ts`) holds the AST walking and this file holds the judgement.

export const KINDS = [
  "copy",
  "heading",
  "button",
  "image",
  "alt",
  "video",
  "link",
  "phone",
  "address",
  "email",
  "hours",
  "testimonial",
  "team",
  "seo",
  "social",
] as const;
export type Kind = (typeof KINDS)[number];

/** Kinds whose literal is words a visitor reads, so "decorative" and
 *  "identifier-shaped" filters apply. A video ID or a phone number is never
 *  decorative, whatever its letter count. */
const PROSE_KINDS: ReadonlySet<Kind> = new Set([
  "copy",
  "heading",
  "button",
  "alt",
  "testimonial",
  "team",
  "seo",
]);
export const isProseKind = (kind: Kind): boolean => PROSE_KINDS.has(kind);

const norm = (name: string): string => name.toLowerCase().replace(/[_-]/g, "");

// A prop, object key or variable name, normalised (lower case, no `_`/`-`), and
// the kind a literal under it is. Only names listed here make a literal in
// script or a component prop count; anything else needs a strong value pattern
// (`strongKind`). That is the line between content and the hundreds of strings
// a component passes around that no visitor reads.
const KEY_KINDS: Record<string, Kind> = {};
const addKeys = (kind: Kind, names: string[]): void => {
  for (const n of names) KEY_KINDS[norm(n)] = kind;
};
addKeys("video", [
  "vimeoId",
  "youtubeId",
  "videoId",
  "vimeo",
  "youtube",
  "video",
  "videoUrl",
  "videoSrc",
  "vimeoUrl",
  "youtubeUrl",
  "poster",
  "videoPoster",
]);
addKeys("image", [
  "src",
  "image",
  "images",
  "img",
  "imageUrl",
  "imageSrc",
  "thumbnail",
  "thumb",
  "background",
  "backgroundImage",
  "bg",
  "bgImage",
  "photo",
  "photos",
  "picture",
  "logo",
  "gallery",
  "slides",
  "heroImage",
]);
addKeys("alt", ["alt", "altText", "imageAlt"]);
addKeys("link", [
  "href",
  "link",
  "url",
  "to",
  "linkUrl",
  "ctaHref",
  "ctaUrl",
  "ctaLink",
  "buttonHref",
  "buttonLink",
]);
addKeys("heading", [
  "heading",
  "headline",
  "title",
  "subtitle",
  "subheading",
  "subhead",
  "eyebrow",
  "kicker",
  "pretitle",
  "overline",
]);
addKeys("button", ["cta", "ctaText", "ctaLabel", "buttonText", "buttonLabel", "button"]);
addKeys("seo", [
  "metaTitle",
  "metaDescription",
  "seoTitle",
  "seoDescription",
  "ogTitle",
  "ogDescription",
  "pageTitle",
]);
addKeys("testimonial", ["quote", "testimonial", "testimonials", "review", "attribution"]);
addKeys("team", ["bio", "position", "jobTitle", "role", "team", "teamMembers"]);
addKeys("phone", ["phone", "phoneNumber", "tel", "telephone"]);
addKeys("email", ["email", "emailAddress"]);
addKeys("address", ["address", "street", "streetAddress"]);
addKeys("hours", ["hours", "openingHours", "businessHours"]);
addKeys("social", [
  "facebook",
  "instagram",
  "linkedin",
  "twitter",
  "tiktok",
  "pinterest",
  "social",
  "socials",
  "socialLinks",
]);
addKeys("copy", [
  "text",
  "body",
  "copy",
  "description",
  "caption",
  "label",
  "content",
  "paragraph",
  "paragraphs",
  "intro",
  "blurb",
  "summary",
  "tagline",
  "name",
  "subtext",
  "message",
  "details",
  "excerpt",
  "bullets",
  "features",
  "points",
  "highlights",
  "benefits",
  "lines",
  "question",
  "questions",
  "answer",
  "answers",
  "faq",
  "faqs",
  "stat",
  "stats",
  "price",
  "prices",
]);

addKeys("copy", ["siteName", "businessName", "companyName", "brandName", "ariaLabel"]);
// Round 4 on #2231: espada's `desc`, a testimonial's `author`, reddoor-website's
// `aria:`. Not `status`, which is as often a code value ("sold", "pending"),
// nor `note`, which on reddoor-website is the CRM record's note.
addKeys("copy", ["desc", "author", "aria", "info"]);

// The last word of a longer name, for `DEFAULT_TITLE`, `heroHeading`,
// `ROUTE_TITLES`. Only words that are content whatever comes before them: not
// `name` (fileName, eventName), `url` (apiUrl) or `link`.
const LAST_WORD = new Set([
  "title",
  "subtitle",
  "description",
  "heading",
  "headline",
  "text",
  "label",
  "image",
  "alt",
  "phone",
  "email",
  "address",
  "quote",
  "caption",
  "tagline",
  "copy",
  "bio",
  "cta",
  "question",
  "answer",
]);

export function kindForKey(name: string): Kind | undefined {
  const whole = KEY_KINDS[norm(name)];
  if (whole) return whole;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_.-]+/)
    .filter(Boolean);
  if (words.length < 2) return undefined;
  let last = words.at(-1)!.toLowerCase();
  if (!LAST_WORD.has(last) && last.endsWith("s")) last = last.slice(0, -1);
  if (last.endsWith("e") && !LAST_WORD.has(last)) return undefined;
  return LAST_WORD.has(last) ? KEY_KINDS[last] : undefined;
}

const IMAGE_EXT = /\.(?:jpe?g|png|webp|avif|gif|svg)$/i;
const VIDEO_EXT = /\.(?:mp4|webm|mov|m4v)$/i;
const stripQuery = (s: string): string => s.replace(/[?#].*$/, "");

/** An import specifier or a path that names an image or video file. */
export function assetKind(spec: string): "image" | "video" | undefined {
  const bare = stripQuery(spec.trim());
  if (IMAGE_EXT.test(bare)) return "image";
  if (VIDEO_EXT.test(bare)) return "video";
  return undefined;
}

const SOCIAL_HOST =
  /^(?:https?:)?\/\/(?:[a-z0-9-]+\.)*(?:facebook\.com|fb\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|tiktok\.com|pinterest\.com|yelp\.com|threads\.net|youtube\.com\/(?:@|c\/|channel\/|user\/))/i;
// A URL that names one video: a bare `https://player.vimeo.com` is an origin a
// component posts messages to, not something a visitor watches.
const VIDEO_URL =
  /^(?:https?:)?\/\/(?:(?:player\.)?vimeo\.com\/(?:video\/)?\d+|(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:embed\/[\w-]+|watch\?(?:.*&)?v=[\w-]+|shorts\/[\w-]+)|youtu\.be\/[\w-]+)/i;
const EMAIL = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const HOURS =
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)(?![a-z])|\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?\s?[-–—]\s?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?\b/i;
const ADDRESS =
  /\b\d{2,6}\s+(?:[A-Z0-9][\w.'-]*\s+){1,4}(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|pkwy|parkway|hwy|highway|pl|place|suite|ste)\b\.?/i;

/**
 * The kind a value is by its shape alone, whatever name it sits under: a
 * `tel:` or `mailto:` link, an email address, a phone number, a social or
 * video URL, or a path to an image or video file. Anything that returns
 * `undefined` here needs a content name or a place in the template to count.
 */
export function strongKind(value: string): Kind | undefined {
  const v = value.trim();
  if (/^tel:/i.test(v)) return "phone";
  if (/^mailto:/i.test(v)) return "email";
  if (EMAIL.test(v)) return "email";
  if (SOCIAL_HOST.test(v)) return "social";
  if (VIDEO_URL.test(v)) return "video";
  if (/^(?:https?:)?\/\/|^\/|^\.\.?\/|^\$lib\//.test(v) || !/\s/.test(v)) {
    const a = assetKind(v);
    if (a) return a;
  }
  if (PHONE.test(v) && v.replace(/[^\d]/g, "").length <= 11 && v.length <= 24) return "phone";
  return undefined;
}

/** Narrow a prose kind by what the words say: a phone number, an address,
 *  opening hours, an email. "copy" that is a phone number is a phone row. */
export function refineProse(kind: Kind, text: string): Kind {
  if (kind !== "copy") return kind;
  const t = text.trim();
  if (EMAIL.test(t)) return "email";
  if (PHONE.test(t) && t.replace(/[^\d]/g, "").length <= 11) return "phone";
  if (HOURS.test(t)) return "hours";
  if (ADDRESS.test(t)) return "address";
  return kind;
}

/**
 * Link-shaped values: what an `href`-like name must hold to count as a link.
 * An in-page anchor (`#top`), `javascript:` and the empty string are behaviour,
 * not content.
 */
export function linkKind(value: string): Kind | undefined {
  const v = value.trim();
  if (v === "" || v.startsWith("#") || /^javascript:/i.test(v)) return undefined;
  const strong = strongKind(v);
  if (strong === "phone" || strong === "email" || strong === "social" || strong === "video") {
    return strong;
  }
  if (/^(?:https?:)?\/\//i.test(v) || v.startsWith("/") || v.startsWith("?")) return "link";
  return undefined;
}

/**
 * Decorative labels the operator exempted (decision 2026-11-21-1841, fork 2):
 * "01", "V", "•", "3/5". Fewer than two letters, or a roman numeral alone.
 */
export function isDecorative(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  // A stat, a price or hours (`1,000+`, `$1,250`, `98%`, `9:00 – 5:00`) is
  // words a client writes, though it has no letters (review round 5).
  if (letters < 2) return !/\d[$%+,:]|[$%+,:]\d/.test(text);
  // Only the numerals a list or a step counts with, II to XXXIX: a wider
  // grammar reads ID, MIX, MD, DC, MI and LLC as numbers (review round 1).
  return /^X{0,3}(?:IX|IV|V?I{0,3})\.?$/.test(text.trim());
}

/** An iCalendar or vCard property line (`BEGIN:VCALENDAR`, `SUMMARY:${…}`,
 *  `DTSTART;TZID=…:…`): a file format a calendar reads, never copy. A value
 *  after a space (`FAQ: Ask us`) is words (review round 5). A parameter
 *  value stops at `;`, so the repeat cannot backtrack (CodeQL on #2231). */
export const isPropertyLine = (text: string): boolean =>
  /^[A-Z][A-Z0-9-]*(?:;[A-Z][A-Z0-9-]*=[^:;\s]*)*:(?=\S)/.test(text.trim());

/** A lower-case code word (`"email"`, `"contact-form"`, `"hero_image"`): a key,
 *  a slug or an option value. Applied to script values and component props,
 *  never to template text a visitor reads as written. */
export const isIdentifierLike = (text: string): boolean =>
  /^[a-z0-9]+(?:[_.:/-][a-z0-9]+)*$/.test(text.trim());

/** Names of calls whose literal argument is a fallback for a field:
 *  `vimeoIdOr(field, "123")`, `withFallback(x, "…")`, `orDefault(…)`. */
export const FALLBACK_HELPER =
  /(?:Or|OrDefault|Fallback|WithDefault)$|^(?:or|fallback|withFallback|withDefault|orDefault|defaultTo)$/;

/** Route segments that are legal boilerplate the client does not own
 *  (decision 2026-11-21-1841, fork 2). Normalised like `norm`. */
const LEGAL = new Set(
  [
    "privacy",
    "privacy-policy",
    "privacypolicy",
    "terms",
    "terms-of-service",
    "terms-of-use",
    "terms-and-conditions",
    "terms-conditions",
    "tos",
    "accessibility",
    "accessibility-statement",
    "cookies",
    "cookie-policy",
    "disclaimer",
    "legal",
  ].map(norm),
);

const LEGAL_COMPONENT = new Set(
  [
    "privacy-policy",
    "terms-of-service",
    "terms-of-use",
    "terms-and-conditions",
    "terms-conditions",
    "cookie-policy",
    "accessibility-statement",
  ].map(norm),
);

/**
 * Is this repo-relative file exempt by the operator's rule: a legal page, a
 * `/dev/*` route, or a component named for a legal page?
 *
 * Route groups `(marketing)` and parameter segments `[[preview=preview]]` are
 * skipped when finding a route's segments, so
 * `src/routes/[[preview=preview]]/(legal)/privacy/+page.svelte` is `/privacy`.
 */
export function builtInExemption(file: string): string | undefined {
  const parts = file.split("/");
  if (parts[0] === "src" && parts[1] === "routes") {
    const segs = parts
      .slice(2, -1)
      .filter((s) => !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("["));
    if (segs[0] === "dev") return "dev route";
    // Only the route's first segment: `/privacy` and `/legal/terms` are legal
    // pages; `/services/accessibility` and `/recipes/cookies` are the client's
    // own (review round 2).
    if (segs[0] !== undefined && LEGAL.has(norm(segs[0]))) return "legal page";
  }
  // A component only when its name can mean nothing else: `PrivacyPolicy`,
  // not `Disclaimer` or `Cookies`.
  const base = (parts.at(-1) ?? "").replace(/\.(?:svelte|ts|js)$/, "");
  if (LEGAL_COMPONENT.has(norm(base))) return "legal page";
  return undefined;
}
