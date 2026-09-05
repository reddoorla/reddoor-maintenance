/**
 * Copy for the submitter's confirmation email, resolved by the SITE from its own
 * CMS and forwarded in the reserved `_reply` envelope.
 *
 * Everything here arrives over an untrusted boundary twice — once off the wire,
 * once back out of the persisted `extraFields` JSON — so `parseReplyCopy` is the
 * single gate both paths go through. It drops field by field rather than
 * rejecting whole: a usable subject should still improve the email when the
 * calendar block is malformed.
 */
export type ReplyCalendar = {
  title: string;
  /** ISO 8601. Validated as parseable, not as any particular shape. */
  start: string;
  end?: string;
  location?: string;
  url?: string;
  description?: string;
};

/** Inline formatting, as an offset range over a block's raw `text`. */
export type ReplySpan = {
  start: number;
  end: number;
  type: "strong" | "em" | "link";
  /** Required for `link`; https: and mailto: only, enforced at render. */
  url?: string;
};

export const REPLY_BLOCK_TYPES = [
  "paragraph",
  "heading2",
  "heading3",
  "list-item",
  "o-list-item",
] as const;
export type ReplyBlockType = (typeof REPLY_BLOCK_TYPES)[number];

/**
 * One block of body copy.
 *
 * Deliberately an AST and NOT an HTML string. The envelope crosses an untrusted
 * boundary twice, so a renderer that can only emit a fixed set of tags is what
 * keeps "no attacker text reaches an outbound email" true by construction
 * rather than by everyone downstream remembering to escape. See rich-text.ts.
 */
export type ReplyBlock = {
  type: ReplyBlockType;
  text: string;
  spans?: ReplySpan[];
};

export type ReplyCopy = {
  subject?: string;
  body?: ReplyBlock[];
  signature?: string;
  calendar?: ReplyCalendar;
};

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function date(v: unknown): string | undefined {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? s : undefined;
}

function parseCalendar(raw: unknown): ReplyCalendar | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const c = raw as Record<string, unknown>;
  const title = str(c.title);
  const start = date(c.start);
  // Both are load-bearing: an event with no name or no start is not an event,
  // and half of one in a calendar client is worse than none.
  if (!title || !start) return undefined;
  const out: ReplyCalendar = { title, start };
  const end = date(c.end);
  if (end) out.end = end;
  const location = str(c.location);
  if (location) out.location = location;
  // https only. This becomes an href in an email we send; a javascript: or
  // data: URL arriving through a CMS field is not a link anyone meant to write.
  const url = str(c.url);
  if (url && /^https:\/\//i.test(url)) out.url = url;
  const description = str(c.description);
  if (description) out.description = description;
  return out;
}

function parseSpans(raw: unknown): ReplySpan[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ReplySpan[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const type = s.type;
    if (type !== "strong" && type !== "em" && type !== "link") continue;
    const start = typeof s.start === "number" ? s.start : NaN;
    const end = typeof s.end === "number" ? s.end : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const span: ReplySpan = { start, end, type };
    const url = str(s.url);
    // A link with no usable url survives as plain text rather than vanishing —
    // the renderer drops the anchor and keeps the words.
    if (url) span.url = url;
    out.push(span);
  }
  return out.length > 0 ? out : undefined;
}

function parseBlocks(raw: unknown): ReplyBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ReplyBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const text = typeof b.text === "string" ? b.text : "";
    if (text.trim() === "") continue;
    // An unrecognized block type degrades to a paragraph rather than being
    // dropped: losing a sentence is worse than losing its styling.
    const declared = b.type;
    const type = (REPLY_BLOCK_TYPES as readonly string[]).includes(declared as string)
      ? (declared as ReplyBlockType)
      : "paragraph";
    const block: ReplyBlock = { type, text };
    const spans = parseSpans(b.spans);
    if (spans) block.spans = spans;
    out.push(block);
  }
  return out.length > 0 ? out : undefined;
}

/** Validate untrusted envelope data. Undefined means "nothing usable" — callers
 *  then fall back to the site's own copy rather than sending a blank email. */
export function parseReplyCopy(raw: unknown): ReplyCopy | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ReplyCopy = {};
  const subject = str(r.subject);
  if (subject) out.subject = subject;
  const signature = str(r.signature);
  if (signature) out.signature = signature;
  const body = parseBlocks(r.body);
  if (body) out.body = body;
  const calendar = parseCalendar(r.calendar);
  if (calendar) out.calendar = calendar;
  return Object.keys(out).length > 0 ? out : undefined;
}
